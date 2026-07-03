#!/usr/bin/env node
import { Command } from 'commander';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryStore, PM_DIR } from './store.js';
import { findRepoRoot } from './git.js';
import { renderMarkdown } from './render.js';
import { buildDigest } from './digest.js';
import { installClaudeHooks, mcpConfigSnippet, runPreToolUseHook, runSessionStartHook } from './hooks.js';
import { Memory, MEMORY_TYPES, MemoryType, SEVERITIES, Severity } from './types.js';
import { VERSION } from './version.js';

const program = new Command();
const root = () => findRepoRoot(process.cwd());

function openStore(): MemoryStore {
  const r = root();
  if (!MemoryStore.exists(r)) {
    console.error(`No ${PM_DIR}/ found in ${r}. Run \`pm init\` first.`);
    process.exit(1);
  }
  return new MemoryStore(r);
}

function printMemory(m: Memory, verbose = false): void {
  const files = m.refs.filter((r) => r.refType === 'file').map((r) => r.refValue);
  const sev = m.severity !== 'info' ? ` [${m.severity.toUpperCase()}]` : '';
  console.log(`${m.id.slice(0, 8)}  ${m.type.padEnd(17)}${sev} ${m.title}${m.status !== 'active' ? ` (${m.status})` : ''}`);
  if (files.length) console.log(`          files: ${files.join(', ')}`);
  if (verbose) console.log(`\n${m.body}\n`);
}

program
  .name('pm')
  .description('memini — project memory and mistake-prevention guardrails for AI coding agents')
  .version(VERSION);

program
  .command('init')
  .description('Initialize .memini/ in this repo and install agent integrations')
  .option('--no-hooks', 'skip installing Claude Code hooks')
  .action((opts: { hooks: boolean }) => {
    const r = root();
    const store = new MemoryStore(r);
    renderMarkdown(store);

    const gitignore = join(r, '.gitignore');
    const ignoreLines = `\n# memini: DB is local; markdown views are committed\n${PM_DIR}/memory.db\n${PM_DIR}/memory.db-*\n`;
    if (!existsSync(gitignore) || !readFileSync(gitignore, 'utf-8').includes(`${PM_DIR}/memory.db`)) {
      appendFileSync(gitignore, ignoreLines);
    }

    console.log(`Initialized ${PM_DIR}/ in ${r}`);
    if (opts.hooks) {
      const { path, changed } = installClaudeHooks(r);
      console.log(changed ? `Installed Claude Code guardrail hooks in ${path}` : `Claude Code hooks already installed (${path})`);
    }
    console.log('\nNext steps:');
    console.log('  pm remember failed_attempt "Editing vercel.json broke the build" --file vercel.json --severity warn');
    console.log('  pm install-mcp        # print MCP config for Cursor/Windsurf/Claude Code');
    store.close();
  });

program
  .command('remember')
  .description('Record a memory')
  .argument('<type>', `one of: ${MEMORY_TYPES.join(', ')}`)
  .argument('<title>', 'one-line summary')
  .option('-b, --body <text>', 'details (markdown). Use "-" to read from stdin')
  .option('-f, --file <path...>', 'file(s) this memory is linked to (enables guardrails)')
  .option('-s, --severity <level>', `one of: ${SEVERITIES.join(', ')}`, 'info')
  .action((type: string, title: string, opts: { body?: string; file?: string[]; severity: string }) => {
    if (!MEMORY_TYPES.includes(type as MemoryType)) {
      console.error(`Invalid type "${type}". Use one of: ${MEMORY_TYPES.join(', ')}`);
      process.exit(1);
    }
    if (!SEVERITIES.includes(opts.severity as Severity)) {
      console.error(`Invalid severity "${opts.severity}". Use one of: ${SEVERITIES.join(', ')}`);
      process.exit(1);
    }
    let body = opts.body ?? title;
    if (body === '-') body = readFileSync(0, 'utf-8');
    const store = openStore();
    const m = store.add({
      type: type as MemoryType,
      title,
      body,
      files: opts.file,
      severity: opts.severity as Severity,
      confidence: 'human_verified',
    });
    renderMarkdown(store);
    console.log(`Recorded ${m.type} ${m.id.slice(0, 8)}: ${m.title}`);
    if (m.severity !== 'info' && (opts.file?.length ?? 0) > 0) {
      console.log(`Guardrail active: agents will be ${m.severity === 'block' ? 'blocked' : 'warned'} before editing ${opts.file!.join(', ')}`);
    }
    store.close();
  });

program
  .command('recall')
  .description('Search memories (also powers agent context injection)')
  .argument('[query]', 'free-text search')
  .option('-t, --type <type>', 'filter by memory type')
  .option('-f, --file <path>', 'memories linked to a file')
  .option('--digest', 'print the token-budgeted digest agents receive')
  .option('--json', 'JSON output')
  .action((query: string | undefined, opts: { type?: string; file?: string; digest?: boolean; json?: boolean }) => {
    const store = openStore();
    if (opts.digest) {
      console.log(buildDigest(store, { query }) || 'No memories yet.');
    } else {
      const results = store.recall({ query, type: opts.type as MemoryType | undefined, file: opts.file, includeStale: true });
      if (opts.json) console.log(JSON.stringify(results, null, 2));
      else if (results.length === 0) console.log('No matching memories.');
      else results.forEach((m) => printMemory(m));
    }
    store.close();
  });

program
  .command('check')
  .description('Guardrail check: exit 1 with warnings if a file has recorded risks')
  .argument('<path>', 'file to check')
  .option('--json', 'JSON output')
  .action((path: string, opts: { json?: boolean }) => {
    const store = openStore();
    const hits = store.check(path);
    if (opts.json) console.log(JSON.stringify(hits, null, 2));
    else if (hits.length === 0) console.log(`No recorded risks for ${path}.`);
    else {
      for (const m of hits) {
        console.error(`[${m.severity.toUpperCase()}] ${m.title} (${m.id.slice(0, 8)}, ${m.createdAt.slice(0, 10)})`);
        console.error(m.body.trim() + '\n');
      }
    }
    store.close();
    process.exit(hits.length > 0 ? 1 : 0);
  });

program
  .command('list')
  .description('List memories')
  .option('-t, --type <type>')
  .option('--all', 'include archived/rejected')
  .action((opts: { type?: string; all?: boolean }) => {
    const store = openStore();
    let ms = store.list({ type: opts.type as MemoryType | undefined });
    if (!opts.all) ms = ms.filter((m) => m.status === 'active' || m.status === 'stale');
    if (ms.length === 0) console.log('No memories.');
    ms.forEach((m) => printMemory(m));
    store.close();
  });

program
  .command('show')
  .description('Show a memory in full')
  .argument('<id>', 'memory id (prefix ok)')
  .action((id: string) => {
    const store = openStore();
    const m = store.get(id);
    if (!m) {
      console.error(`No memory found for id ${id}`);
      process.exit(1);
    }
    printMemory(m, true);
    m.refs.forEach((r) => console.log(`  ref: ${r.refType} ${r.refValue}`));
    store.close();
  });

program
  .command('archive')
  .description('Archive a memory (removes it from guardrails and recall)')
  .argument('<id>')
  .action((id: string) => {
    const store = openStore();
    const m = store.setStatus(id, 'archived');
    if (!m) {
      console.error(`No memory found for id ${id}`);
      process.exit(1);
    }
    renderMarkdown(store);
    console.log(`Archived ${m.id.slice(0, 8)}: ${m.title}`);
    store.close();
  });

program
  .command('approve')
  .description('Mark an agent-claimed memory as human-verified')
  .argument('<id>')
  .action((id: string) => {
    const store = openStore();
    const m = store.setConfidence(id, 'human_verified');
    if (!m) {
      console.error(`No memory found for id ${id}`);
      process.exit(1);
    }
    renderMarkdown(store);
    console.log(`Verified ${m.id.slice(0, 8)}: ${m.title}`);
    store.close();
  });

program
  .command('stale')
  .description('Detect memories whose referenced files have changed since recording')
  .action(() => {
    const store = openStore();
    const results = store.detectStale();
    if (results.length === 0) console.log('All memories are fresh.');
    for (const { memory, changedFiles } of results) {
      console.log(`STALE ${memory.id.slice(0, 8)}: ${memory.title}`);
      console.log(`       changed: ${changedFiles.join(', ')}  (re-verify: pm verify ${memory.id.slice(0, 8)})`);
    }
    renderMarkdown(store);
    store.close();
  });

program
  .command('verify')
  .description('Re-verify a stale memory: mark active again with refreshed file hashes')
  .argument('<id>')
  .action((id: string) => {
    const store = openStore();
    const m = store.reverify(id);
    if (!m) {
      console.error(`No memory found for id ${id}`);
      process.exit(1);
    }
    renderMarkdown(store);
    console.log(`Re-verified ${m.id.slice(0, 8)}: ${m.title}`);
    store.close();
  });

program
  .command('mcp')
  .description('Run the MCP server (stdio) for agent integration')
  .action(async () => {
    const { runMcpServer } = await import('./mcp.js');
    await runMcpServer(process.cwd());
  });

program
  .command('install-hooks')
  .description('Install Claude Code guardrail hooks into .claude/settings.json')
  .action(() => {
    const { path, changed } = installClaudeHooks(root());
    console.log(changed ? `Installed hooks in ${path}` : `Hooks already installed (${path})`);
  });

program
  .command('install-mcp')
  .description('Print MCP server config for Cursor / Windsurf / Claude Code')
  .option('--write <tool>', 'write config file for: cursor')
  .action((opts: { write?: string }) => {
    const snippet = mcpConfigSnippet();
    if (opts.write === 'cursor') {
      const p = join(root(), '.cursor', 'mcp.json');
      const dir = join(root(), '.cursor');
      if (!existsSync(dir)) {
        writeFileSync(p, JSON.stringify(snippet, null, 2) + '\n');
      } else {
        const existing = existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : {};
        existing.mcpServers = { ...(existing.mcpServers ?? {}), ...(snippet as any).mcpServers };
        writeFileSync(p, JSON.stringify(existing, null, 2) + '\n');
      }
      console.log(`Wrote ${p}`);
    } else {
      console.log(JSON.stringify(snippet, null, 2));
      console.log('\nClaude Code:  claude mcp add memini -- npx -y memini mcp');
      console.log('Cursor:       pm install-mcp --write cursor');
    }
  });

program
  .command('hook')
  .description('(internal) hook entrypoints called by agent harnesses')
  .argument('<event>', 'claude-pre-tool-use | claude-session-start')
  .action(async (event: string) => {
    if (event === 'claude-pre-tool-use') await runPreToolUseHook();
    else if (event === 'claude-session-start') await runSessionStartHook();
    // unknown events: exit 0 silently (fail open, forward compatible)
  });

program
  .command('doctor')
  .description('Diagnose setup: store, hooks, MCP config')
  .action(() => {
    const r = root();
    const checks: [string, boolean, string][] = [];
    checks.push(['store', MemoryStore.exists(r), `run \`pm init\``]);
    const claudeSettings = join(r, '.claude', 'settings.json');
    const hooksOk =
      existsSync(claudeSettings) && readFileSync(claudeSettings, 'utf-8').includes('claude-pre-tool-use');
    checks.push(['claude-code hooks', hooksOk, `run \`pm install-hooks\``]);
    const cursorOk = existsSync(join(r, '.cursor', 'mcp.json'));
    checks.push(['cursor mcp config', cursorOk, `run \`pm install-mcp --write cursor\` (optional)`]);
    for (const [name, ok, fix] of checks) {
      console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  → ${fix}`}`);
    }
    if (MemoryStore.exists(r)) {
      const store = new MemoryStore(r);
      const active = store.list().filter((m) => m.status === 'active').length;
      console.log(`\n${active} active memories.`);
      store.close();
    }
  });

program.parseAsync(process.argv);
