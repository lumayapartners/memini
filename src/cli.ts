#!/usr/bin/env node
import { Command } from 'commander';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MemoryStore, PM_DIR, Scope } from './store.js';
import { findRepoRoot } from './git.js';
import { renderMarkdown } from './render.js';
import { buildScopedDigest } from './digest.js';
import { checkAllScopes, openScopedStores, openStoreForScope, resolveScopes } from './scopes.js';
import {
  cursorRule,
  installClaudeHooks,
  installCursorHooks,
  installGitHook,
  mcpConfigSnippet,
  runPreToolUseHook,
  runSessionStartHook,
} from './hooks.js';
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

function printMemory(m: Memory, verbose = false, scope?: Scope): void {
  const files = m.refs.filter((r) => r.refType === 'file').map((r) => r.refValue);
  const sev = m.severity !== 'info' ? ` [${m.severity.toUpperCase()}]` : '';
  const scopeTag = scope && scope !== 'project' ? ` [${scope}]` : '';
  console.log(`${m.id.slice(0, 8)}  ${m.type.padEnd(17)}${sev}${scopeTag} ${m.title}${m.status !== 'active' ? ` (${m.status})` : ''}`);
  if (files.length) console.log(`          files: ${files.join(', ')}`);
  if (verbose) console.log(`\n${m.body}\n`);
}

const SCOPES: Scope[] = ['project', 'workspace', 'user'];
function parseScope(s: string | undefined): Scope {
  const scope = (s ?? 'project') as Scope;
  if (!SCOPES.includes(scope)) {
    console.error(`Invalid scope "${s}". Use one of: ${SCOPES.join(', ')}`);
    process.exit(1);
  }
  return scope;
}

program
  .name('pm')
  .description('memini — project memory and mistake-prevention guardrails for AI coding agents')
  .version(VERSION);

program
  .command('init')
  .description('Initialize .memini/ in this repo and install agent integrations')
  .option('--no-hooks', 'skip installing Claude Code hooks')
  .option('--workspace', 'create a workspace store HERE covering all repos in subdirectories (run in the parent folder, not a repo)')
  .action((opts: { hooks: boolean; workspace?: boolean }) => {
    if (opts.workspace) {
      const wsRoot = process.cwd();
      const store = new MemoryStore(wsRoot, { scope: 'workspace' });
      renderMarkdown(store);
      store.close();
      console.log(`Initialized workspace memory in ${wsRoot}/${PM_DIR}/`);
      console.log('It applies to every repo under this directory. Record shared rules with:');
      console.log('  pm remember deployment "…" --scope workspace   (from inside any repo below)');
      return;
    }
    const r = root();
    const store = new MemoryStore(r);
    renderMarkdown(store);
    const ws = resolveScopes(r).find((s) => s.scope === 'workspace');
    if (ws) console.log(`Workspace memory detected at ${ws.root}/${PM_DIR}/ — its verified rules apply here.`);

    const gitignore = join(r, '.gitignore');
    const ignoreLines = `\n# memini: DB and hook shim are local; markdown views are committed\n${PM_DIR}/memory.db\n${PM_DIR}/memory.db-*\n${PM_DIR}/hooks/\n`;
    if (!existsSync(gitignore) || !readFileSync(gitignore, 'utf-8').includes(`${PM_DIR}/memory.db`)) {
      appendFileSync(gitignore, ignoreLines);
    }

    console.log(`Initialized ${PM_DIR}/ in ${r}`);
    if (opts.hooks) {
      const claude = installClaudeHooks(r);
      console.log(claude.changed ? `Installed Claude Code guardrail hooks in ${claude.path}` : `Claude Code hooks already installed (${claude.path})`);
      // git pre-commit guardrail is tool-agnostic — enforces even for Cursor/VS Code/other agents
      const gitHook = installGitHook(r);
      console.log(gitHook.changed ? `Installed git pre-commit guardrail in ${gitHook.path}` : `Git pre-commit guardrail already installed (${gitHook.path})`);
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
  .option('-f, --file <path...>', 'file(s) this memory is linked to (enables guardrails); glob patterns for workspace/user scope')
  .option('-s, --severity <level>', `one of: ${SEVERITIES.join(', ')}`, 'info')
  .option('--scope <scope>', `where to record it: ${SCOPES.join(', ')} (workspace/user apply across repos)`, 'project')
  .action((type: string, title: string, opts: { body?: string; file?: string[]; severity: string; scope?: string }) => {
    if (!MEMORY_TYPES.includes(type as MemoryType)) {
      console.error(`Invalid type "${type}". Use one of: ${MEMORY_TYPES.join(', ')}`);
      process.exit(1);
    }
    if (!SEVERITIES.includes(opts.severity as Severity)) {
      console.error(`Invalid severity "${opts.severity}". Use one of: ${SEVERITIES.join(', ')}`);
      process.exit(1);
    }
    const scope = parseScope(opts.scope);
    let body = opts.body ?? title;
    if (body === '-') body = readFileSync(0, 'utf-8');
    let store: MemoryStore;
    try {
      store = scope === 'project' ? openStore() : openStoreForScope(process.cwd(), scope);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
    const m = store.add({
      type: type as MemoryType,
      title,
      body,
      files: opts.file,
      severity: opts.severity as Severity,
      confidence: 'human_verified',
    });
    renderMarkdown(store);
    console.log(`Recorded ${m.type} ${m.id.slice(0, 8)} [${scope}]: ${m.title}`);
    if (m.severity !== 'info' && (opts.file?.length ?? 0) > 0) {
      const where = scope === 'project' ? '' : ' (in every repo under this scope)';
      console.log(`Guardrail active: agents will be ${m.severity === 'block' ? 'blocked' : 'warned'} before editing ${opts.file!.join(', ')}${where}`);
    }
    store.close();
  });

program
  .command('promote')
  .description('Lift a project memory to a wider scope (it becomes human-verified and applies across repos)')
  .argument('<id>', 'project memory id (prefix ok)')
  .option('--workspace', 'promote to the workspace scope (nearest ancestor .memini)')
  .option('--user', 'promote to your user scope (~/.memini)')
  .action((id: string, opts: { workspace?: boolean; user?: boolean }) => {
    if (!opts.workspace === !opts.user) {
      console.error('Pick exactly one target: --workspace or --user');
      process.exit(1);
    }
    const scope: Scope = opts.workspace ? 'workspace' : 'user';
    const src = openStore();
    const m = src.get(id);
    if (!m) {
      console.error(`No memory found for id ${id}`);
      process.exit(1);
    }
    let dst: MemoryStore;
    try {
      dst = openStoreForScope(process.cwd(), scope);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
    // file refs become patterns: keep basenames so they match in any repo layout
    const patterns = m.refs
      .filter((r) => r.refType === 'file')
      .map((r) => r.refValue.split('/').pop()!)
      .filter((v, i, a) => a.indexOf(v) === i);
    const promoted = dst.add({
      type: m.type,
      title: m.title,
      body: m.body,
      files: patterns,
      severity: m.severity,
      confidence: 'human_verified',
      createdBy: m.createdBy,
    });
    renderMarkdown(dst);
    src.setStatus(m.id, 'archived');
    renderMarkdown(src);
    console.log(`Promoted to ${scope}: ${promoted.id.slice(0, 8)} ${promoted.title}`);
    if (patterns.length) console.log(`File guardrails now match by pattern: ${patterns.join(', ')}`);
    console.log(`Original project memory ${m.id.slice(0, 8)} archived.`);
    src.close();
    dst.close();
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
    const stores = openScopedStores(process.cwd());
    if (stores.length === 0) {
      console.error(`No ${PM_DIR}/ found. Run \`pm init\` first.`);
      process.exit(1);
    }
    if (opts.digest) {
      console.log(buildScopedDigest(stores, { query }) || 'No memories yet.');
    } else {
      const results = stores.flatMap(({ store, scope }) => {
        let found = store.recall({ query, type: opts.type as MemoryType | undefined, file: scope === 'project' ? opts.file : undefined, includeStale: true });
        if (scope !== 'project') found = found.filter((m) => m.confidence === 'human_verified');
        return found.map((m) => ({ m, scope }));
      });
      if (opts.json) console.log(JSON.stringify(results.map(({ m, scope }) => ({ ...m, scope })), null, 2));
      else if (results.length === 0) console.log('No matching memories.');
      else results.forEach(({ m, scope }) => printMemory(m, false, scope));
    }
    stores.forEach(({ store }) => store.close());
  });

program
  .command('check')
  .description('Guardrail check: exit 1 with warnings if a file has recorded risks')
  .argument('<path>', 'file to check')
  .option('--json', 'JSON output')
  .action((path: string, opts: { json?: boolean }) => {
    const hits = checkAllScopes(process.cwd(), path);
    if (opts.json) console.log(JSON.stringify(hits.map(({ memory, scope }) => ({ ...memory, scope })), null, 2));
    else if (hits.length === 0) console.log(`No recorded risks for ${path}.`);
    else {
      for (const { memory: m, scope } of hits) {
        const tag = scope !== 'project' ? ` [${scope}]` : '';
        console.error(`[${m.severity.toUpperCase()}]${tag} ${m.title} (${m.id.slice(0, 8)}, ${m.createdAt.slice(0, 10)})`);
        console.error(m.body.trim() + '\n');
      }
    }
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
  .command('edit')
  .description('Edit a memory (opens $EDITOR on the body unless flags are given)')
  .argument('<id>', 'memory id (prefix ok)')
  .option('--title <text>', 'new title')
  .option('--body <text>', 'new body (use "-" to read from stdin)')
  .option('-s, --severity <level>', `one of: ${SEVERITIES.join(', ')}`)
  .action((id: string, opts: { title?: string; body?: string; severity?: string }) => {
    const store = openStore();
    const mem = store.get(id);
    if (!mem) {
      console.error(`No memory found for id ${id}`);
      process.exit(1);
    }
    if (opts.severity && !SEVERITIES.includes(opts.severity as Severity)) {
      console.error(`Invalid severity "${opts.severity}". Use one of: ${SEVERITIES.join(', ')}`);
      process.exit(1);
    }
    let body = opts.body;
    if (body === '-') body = readFileSync(0, 'utf-8');
    if (opts.title === undefined && body === undefined && opts.severity === undefined) {
      // interactive: open the body in the user's editor
      const tmp = join(tmpdir(), `memini-edit-${mem.id.slice(0, 8)}.md`);
      writeFileSync(tmp, mem.body);
      const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
      const res = spawnSync(editor, [tmp], { stdio: 'inherit', shell: false });
      if (res.status !== 0) {
        console.error(`Editor exited with status ${res.status}; memory unchanged.`);
        process.exit(1);
      }
      body = readFileSync(tmp, 'utf-8');
      rmSync(tmp, { force: true });
      if (body === mem.body) {
        console.log('No changes.');
        store.close();
        return;
      }
    }
    const updated = store.update(mem.id, {
      title: opts.title,
      body,
      severity: opts.severity as Severity | undefined,
    })!;
    renderMarkdown(store);
    console.log(`Updated ${updated.id.slice(0, 8)}: ${updated.title}`);
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
  .description('Install guardrail hooks. Default: Claude Code + git pre-commit (tool-agnostic).')
  .option('--claude', 'Claude Code hooks only')
  .option('--git', 'git pre-commit hook only (works with any IDE/agent)')
  .action((opts: { claude?: boolean; git?: boolean }) => {
    const r = root();
    const both = !opts.claude && !opts.git;
    if (opts.claude || both) {
      const { path, changed } = installClaudeHooks(r);
      console.log(changed ? `Installed Claude Code hooks in ${path}` : `Claude Code hooks already installed (${path})`);
    }
    if (opts.git || both) {
      const { path, changed } = installGitHook(r);
      console.log(changed ? `Installed git pre-commit hook in ${path}` : `Git pre-commit hook already installed (${path})`);
    }
  });

program
  .command('install-mcp')
  .description('Print MCP server config for Cursor / Windsurf / Claude Code')
  .option('--write <tool>', 'write config file for: cursor')
  .action((opts: { write?: string }) => {
    const snippet = mcpConfigSnippet();
    if (opts.write === 'cursor') {
      const r = root();
      const p = join(r, '.cursor', 'mcp.json');
      mkdirSync(join(r, '.cursor'), { recursive: true });
      const existing = existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : {};
      existing.mcpServers = { ...(existing.mcpServers ?? {}), ...(snippet as { mcpServers: object }).mcpServers };
      writeFileSync(p, JSON.stringify(existing, null, 2) + '\n');
      // always-applied rule that steers the agent to the guardrail tools (advisory)
      const rulePath = join(r, '.cursor', 'rules', 'memini.mdc');
      mkdirSync(dirname(rulePath), { recursive: true });
      writeFileSync(rulePath, cursorRule());
      // enforced preToolUse hooks: block edits to guardrailed files (Cursor 1.7+)
      const { path: hooksPath } = installCursorHooks(r);
      console.log(`Wrote ${p}`);
      console.log(`Wrote ${rulePath}`);
      console.log(`Wrote ${hooksPath}  (enforced preToolUse guardrail)`);
      console.log('Restart Cursor (or reload the window) so it picks up the MCP server, rule, and hooks.');
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
  .command('precommit')
  .description('Guardrail check on staged files — blocks the commit on BLOCK-severity memories. Tool-agnostic: works no matter which IDE or agent made the edit.')
  .action(() => {
    const r = root();
    let staged: string[] = [];
    try {
      staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
        cwd: r,
        encoding: 'utf-8',
      })
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      process.exit(0); // no git / no staged files: fail open, never block a commit on our error
    }
    let blocked = false;
    let warned = false;
    for (const file of staged) {
      const hits = checkAllScopes(r, file);
      for (const { memory: m, scope } of hits) {
        const tag = scope !== 'project' ? ` [${scope}]` : '';
        if (m.severity === 'block') {
          blocked = true;
          console.error(`\n✋ BLOCKED${tag}: ${file}`);
          console.error(`   ${m.title} (${m.id.slice(0, 8)})`);
          console.error(`   ${m.body.trim().split('\n')[0]}`);
        } else {
          warned = true;
          console.error(`\n⚠  WARNING${tag}: ${file} — ${m.title} (${m.id.slice(0, 8)})`);
        }
      }
    }
    if (blocked) {
      console.error(`\nCommit blocked by memini. To override a specific memory: pm archive <id>`);
      console.error(`To bypass all guardrails for this one commit: git commit --no-verify\n`);
      process.exit(3); // distinct code: the hook blocks ONLY on 3, so command errors fail open
    }
    if (warned) console.error(`\n(warnings only — commit allowed)\n`);
    process.exit(0);
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
    const gitHookPath = join(r, '.git', 'hooks', 'pre-commit');
    const gitOk = existsSync(gitHookPath) && readFileSync(gitHookPath, 'utf-8').includes('memini precommit');
    checks.push(['git pre-commit guardrail', gitOk, `run \`pm install-hooks --git\``]);
    const cursorOk =
      existsSync(join(r, '.cursor', 'mcp.json')) &&
      existsSync(join(r, '.cursor', 'rules', 'memini.mdc')) &&
      existsSync(join(r, '.cursor', 'hooks.json'));
    checks.push(['cursor mcp + rule + hooks', cursorOk, `run \`pm install-mcp --write cursor\` (optional)`]);
    for (const [name, ok, fix] of checks) {
      console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  → ${fix}`}`);
    }
    console.log('\nScopes:');
    for (const s of resolveScopes(r)) {
      if (!s.exists) {
        console.log(`  ${s.scope.padEnd(9)} — none${s.scope === 'workspace' ? ' (create with `pm init --workspace` in a parent dir)' : ''}`);
        continue;
      }
      const store = new MemoryStore(s.root, { scope: s.scope });
      const active = store.list().filter((m) => m.status === 'active').length;
      console.log(`  ${s.scope.padEnd(9)} ${s.root}/${PM_DIR} — ${active} active memories`);
      store.close();
    }
  });

program.parseAsync(process.argv);
