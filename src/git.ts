import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export interface GitContext {
  branch: string | null;
  head: string | null;
  user: string | null;
  root: string | null;
}

/** Tracked files changed vs HEAD (staged + working tree), repo-relative. Empty if clean/no repo. */
export function changedFiles(cwd: string): string[] {
  // --name-only gives plain paths, no status columns to parse.
  const out = git(cwd, ['diff', '--name-only', 'HEAD']);
  if (!out) return [];
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

export function gitContext(cwd: string): GitContext {
  return {
    branch: git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    head: git(cwd, ['rev-parse', 'HEAD']),
    user: git(cwd, ['config', 'user.name']),
    root: git(cwd, ['rev-parse', '--show-toplevel']),
  };
}

export function findRepoRoot(cwd: string): string {
  return git(cwd, ['rev-parse', '--show-toplevel']) ?? resolve(cwd);
}

/** Resolve symlinks when possible so paths compare consistently (e.g. macOS /var → /private/var). */
function realpathSafe(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Normalize a path to repo-root-relative with forward slashes, so refs match across machines and tools. */
export function normalizeRepoPath(root: string, filePath: string): string {
  const abs = isAbsolute(filePath) ? filePath : join(realpathSafe(root), filePath);
  return relative(realpathSafe(root), realpathSafe(abs)).split(sep).join('/');
}

/** True when a normalized repo path stays inside the repo root. */
export function isInsideRepo(repoRelPath: string): boolean {
  return !repoRelPath.startsWith('..') && !isAbsolute(repoRelPath) && repoRelPath !== '';
}

export function hashFile(root: string, repoRelPath: string): string | null {
  if (!isInsideRepo(repoRelPath)) return null; // never read outside the repo
  const abs = join(root, repoRelPath);
  if (!existsSync(abs)) return null;
  try {
    return createHash('sha256').update(readFileSync(abs)).digest('hex');
  } catch {
    return null;
  }
}
