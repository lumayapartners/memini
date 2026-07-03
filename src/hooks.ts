import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MemoryStore } from './store.js';
import { findRepoRoot } from './git.js';
import { buildDigest, formatGuardrailWarning } from './digest.js';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

interface ClaudeHookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; notebook_path?: string };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Claude Code PreToolUse hook. Guardrail semantics:
 *  - severity 'block'  -> always denied, memory injected as the reason
 *  - severity 'warn'   -> denied ONCE per session per file (warning injected), retry allowed
 * Fail-open on any error: a broken guardrail must never break the user's agent.
 */
export async function runPreToolUseHook(): Promise<void> {
  try {
    const input = JSON.parse(await readStdin()) as ClaudeHookInput;
    if (!input.tool_name || !EDIT_TOOLS.has(input.tool_name)) return allow();
    const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (!filePath) return allow();

    const root = findRepoRoot(input.cwd ?? process.cwd());
    if (!MemoryStore.exists(root)) return allow();
    const store = new MemoryStore(root);
    try {
      const hits = store.check(filePath);
      if (hits.length === 0) return allow();

      const blocks = hits.filter((m) => m.severity === 'block');
      const warning = formatGuardrailWarning(filePath, hits);

      if (blocks.length > 0) {
        return deny(
          `${warning}\n\nThis file is protected by a BLOCK-severity project memory. Do not edit it. ` +
            `If the user explicitly confirms the edit should proceed, they can archive the memory with: pm archive ${blocks[0].id}`
        );
      }

      const sessionId = input.session_id ?? 'unknown-session';
      if (store.hasWarned(sessionId, filePath)) return allow();
      store.markWarned(sessionId, filePath);
      return deny(
        `${warning}\n\nThis is a WARNING, not a block. Consider the recorded history above before proceeding. ` +
          `If you still believe this edit is correct, retry the same edit — it will be allowed.`
      );
    } finally {
      store.close();
    }
  } catch {
    return allow();
  }
}

/** Claude Code SessionStart hook: inject the project-memory digest as context. */
export async function runSessionStartHook(): Promise<void> {
  try {
    const input = JSON.parse(await readStdin()) as ClaudeHookInput;
    const root = findRepoRoot(input.cwd ?? process.cwd());
    if (!MemoryStore.exists(root)) return;
    const store = new MemoryStore(root);
    try {
      const digest = buildDigest(store);
      if (!digest) return;
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: digest },
        })
      );
    } finally {
      store.close();
    }
  } catch {
    /* fail open */
  }
}

function allow(): void {
  process.exitCode = 0;
}

function deny(reason: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  );
  process.exitCode = 0;
}

// --- installer ---

interface HookEntry {
  matcher?: string;
  hooks: { type: 'command'; command: string }[];
}

const PRE_TOOL_USE: HookEntry = {
  matcher: 'Edit|Write|MultiEdit|NotebookEdit',
  hooks: [{ type: 'command', command: 'npx -y memini hook claude-pre-tool-use' }],
};
const SESSION_START: HookEntry = {
  hooks: [{ type: 'command', command: 'npx -y memini hook claude-session-start' }],
};

/** Idempotently install guardrail hooks into <repo>/.claude/settings.json. */
export function installClaudeHooks(root: string): { path: string; changed: boolean } {
  const settingsPath = join(root, '.claude', 'settings.json');
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  }
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;

  let changed = false;
  const ensure = (event: string, entry: HookEntry) => {
    const list = hooks[event] ?? [];
    const marker = entry.hooks[0].command;
    if (!list.some((e) => e.hooks?.some((h) => h.command === marker))) {
      list.push(entry);
      hooks[event] = list;
      changed = true;
    }
  };
  ensure('PreToolUse', PRE_TOOL_USE);
  ensure('SessionStart', SESSION_START);

  if (changed) {
    settings.hooks = hooks;
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }
  return { path: settingsPath, changed };
}

/** Generate MCP client config snippets for other tools (Cursor, Windsurf). */
export function mcpConfigSnippet(): object {
  return {
    mcpServers: {
      memini: { command: 'npx', args: ['-y', 'memini', 'mcp'] },
    },
  };
}
