import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { MemoryStore, PM_DIR, Scope } from './store.js';
import { findRepoRoot, normalizeRepoPath } from './git.js';

export interface ScopeInfo {
  scope: Scope;
  root: string;
  exists: boolean;
}

/**
 * Resolve the scopes that apply at a given cwd:
 *  - project:  the enclosing repo root (always present as a concept)
 *  - workspace: the nearest ancestor directory ABOVE the repo root containing
 *    a .memini/ store — e.g. ~/cigna/.memini covers every repo under ~/cigna.
 *    (Directory-walk resolution, like .gitconfig / ESLint / CLAUDE.md.)
 *  - user: ~/.memini, personal rules that follow the developer everywhere
 */
export function resolveScopes(cwd: string): ScopeInfo[] {
  const projectRoot = findRepoRoot(cwd);
  const home = resolve(homedir());
  const scopes: ScopeInfo[] = [
    { scope: 'project', root: projectRoot, exists: MemoryStore.exists(projectRoot) },
  ];

  let dir = dirname(resolve(projectRoot));
  while (true) {
    if (dir === home) break; // home is the user scope, not a workspace
    if (existsSync(join(dir, PM_DIR, 'memory.db'))) {
      scopes.push({ scope: 'workspace', root: dir, exists: true });
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  scopes.push({ scope: 'user', root: home, exists: MemoryStore.exists(home) });
  return scopes;
}

/** Open every existing store at this cwd, ordered project → workspace → user. */
export function openScopedStores(cwd: string): { store: MemoryStore; scope: Scope; root: string }[] {
  return resolveScopes(cwd)
    .filter((s) => s.exists)
    .map((s) => ({ store: new MemoryStore(s.root, { scope: s.scope }), scope: s.scope, root: s.root }));
}

/** Open (creating if needed) the store for an explicit target scope. */
export function openStoreForScope(cwd: string, scope: Scope): MemoryStore {
  if (scope === 'project') return new MemoryStore(findRepoRoot(cwd), { scope: 'project' });
  if (scope === 'user') return new MemoryStore(resolve(homedir()), { scope: 'user' });
  const ws = resolveScopes(cwd).find((s) => s.scope === 'workspace');
  if (!ws) {
    throw new Error(
      `No workspace store found above this repo. Create one in the directory that groups your repos:\n` +
        `  cd <parent-dir> && pm init --workspace`
    );
  }
  return new MemoryStore(ws.root, { scope: 'workspace' });
}

/**
 * Cross-scope guardrail check for a file in the current repo.
 * Project memories match by exact normalized path; workspace/user memories
 * match by glob pattern and only when human-verified.
 */
export function checkAllScopes(
  cwd: string,
  filePath: string,
  opts: { recordFires?: boolean } = {}
): { memory: import('./types.js').Memory; scope: Scope }[] {
  const stores = openScopedStores(cwd);
  const projectRoot = findRepoRoot(cwd);
  const rel = normalizeRepoPath(projectRoot, filePath);
  const hits: { memory: import('./types.js').Memory; scope: Scope }[] = [];
  try {
    for (const { store, scope } of stores) {
      const found = scope === 'project' ? store.check(filePath) : store.checkPattern(rel);
      // Count a real guardrail intervention as a "fire" (not manual `pm check`).
      if (opts.recordFires && found.length) store.recordFire(found.map((m) => m.id));
      hits.push(...found.map((memory) => ({ memory, scope })));
    }
  } finally {
    stores.forEach(({ store }) => store.close());
  }
  return hits;
}
