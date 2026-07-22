import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MemoryStore } from '../src/store.js';
import { checkAllScopes } from '../src/scopes.js';
import { collectMemories, computeStats, reviewMemories } from '../src/insights.js';
import { changedFiles } from '../src/git.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pm-ins-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t.dev'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: root });
  writeFileSync(join(root, 'vercel.json'), '{}');
  writeFileSync(join(root, 'auth.js'), 'x');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('fire tracking', () => {
  it('increments only via checkAllScopes recordFires, not plain check', () => {
    const s = new MemoryStore(root);
    const m = s.add({ type: 'fragile_file', title: 'x', body: 'y', files: ['vercel.json'], severity: 'block' });
    s.close();

    // plain check (pm check) — no fire
    checkAllScopes(root, 'vercel.json');
    let s2 = new MemoryStore(root);
    expect(s2.get(m.id)!.fireCount).toBe(0);
    s2.close();

    // real intervention — fires
    checkAllScopes(root, 'vercel.json', { recordFires: true });
    checkAllScopes(root, 'vercel.json', { recordFires: true });
    s2 = new MemoryStore(root);
    const fired = s2.get(m.id)!;
    expect(fired.fireCount).toBe(2);
    expect(fired.lastFiredAt).toBeTruthy();
    s2.close();
  });

  it('migrates an older DB missing the fire columns', () => {
    // create a legacy-shaped table without fire columns, then open normally
    const s = new MemoryStore(root);
    s.db.exec(`ALTER TABLE memories DROP COLUMN fire_count`);
    s.db.exec(`ALTER TABLE memories DROP COLUMN last_fired_at`);
    s.close();
    const s2 = new MemoryStore(root); // migrate() should re-add them
    const m = s2.add({ type: 'decision', title: 't', body: 'b' });
    expect(m.fireCount).toBe(0);
    s2.close();
  });
});

describe('computeStats', () => {
  it('summarizes counts, fires, and never-fired guardrails', () => {
    const s = new MemoryStore(root);
    s.add({ type: 'fragile_file', title: 'a', body: 'x', files: ['vercel.json'], severity: 'block' });
    s.add({ type: 'decision', title: 'b', body: 'y' });
    s.close();
    checkAllScopes(root, 'vercel.json', { recordFires: true });

    const stats = computeStats(collectMemories(root));
    expect(stats.total).toBe(2);
    expect(stats.guardrails).toBe(1);
    expect(stats.totalFires).toBe(1);
    expect(stats.topFired).toHaveLength(1);
    expect(stats.neverFired).toBe(0);
  });
});

describe('reviewMemories', () => {
  it('flags contradictions (different severities on same file)', () => {
    const s = new MemoryStore(root);
    s.add({ type: 'fragile_file', title: 'lock it', body: 'x', files: ['vercel.json'], severity: 'block' });
    s.add({ type: 'failed_attempt', title: 'careful', body: 'y', files: ['vercel.json'], severity: 'warn' });
    s.close();
    const findings = reviewMemories(collectMemories(root));
    expect(findings.some((f) => f.kind === 'contradiction')).toBe(true);
  });

  it('flags near-duplicate memories of the same type on the same file', () => {
    const s = new MemoryStore(root);
    s.add({ type: 'fragile_file', title: 'auth module is fragile', body: 'x', files: ['auth.js'], severity: 'warn' });
    s.add({ type: 'fragile_file', title: 'auth module fragile handle carefully', body: 'y', files: ['auth.js'], severity: 'warn' });
    s.close();
    const findings = reviewMemories(collectMemories(root));
    expect(findings.some((f) => f.kind === 'duplicate')).toBe(true);
  });

  it('healthy memory produces no findings', () => {
    const s = new MemoryStore(root);
    s.add({ type: 'decision', title: 'use supabase', body: 'x' });
    s.add({ type: 'fragile_file', title: 'auth fragile', body: 'y', files: ['auth.js'], severity: 'warn' });
    s.close();
    expect(reviewMemories(collectMemories(root))).toHaveLength(0);
  });
});

describe('changedFiles', () => {
  it('lists modified tracked files with full paths', () => {
    writeFileSync(join(root, 'auth.js'), 'changed content');
    const changed = changedFiles(root);
    expect(changed).toContain('auth.js');
  });

  it('is empty on a clean tree', () => {
    expect(changedFiles(root)).toHaveLength(0);
  });
});
