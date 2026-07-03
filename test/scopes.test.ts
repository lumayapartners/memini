import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MemoryStore } from '../src/store.js';
import { resolveScopes, checkAllScopes, openScopedStores } from '../src/scopes.js';
import { buildScopedDigest } from '../src/digest.js';
import { globMatch } from '../src/glob.js';

let ws: string; // workspace dir (e.g. ~/cigna)
let repo: string; // repo under it

beforeEach(() => {
  ws = realpathSync(mkdtempSync(join(tmpdir(), 'pm-ws-')));
  repo = join(ws, 'project-a');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 't@t.dev'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: repo });
  writeFileSync(join(repo, 'vercel.json'), '{}');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
});

afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

describe('globMatch', () => {
  it('bare filenames match at any depth', () => {
    expect(globMatch('vercel.json', 'vercel.json')).toBe(true);
    expect(globMatch('vercel.json', 'apps/web/vercel.json')).toBe(true);
    expect(globMatch('vercel.json', 'vercel.json.bak')).toBe(false);
  });
  it('supports * and ** and ?', () => {
    expect(globMatch('config/*.yml', 'config/app.yml')).toBe(true);
    expect(globMatch('config/*.yml', 'config/deep/app.yml')).toBe(false);
    expect(globMatch('config/**/*.yml', 'config/deep/app.yml')).toBe(true);
    expect(globMatch('file?.ts', 'file1.ts')).toBe(true);
  });
});

describe('scope resolution', () => {
  it('finds workspace store in ancestor directory', () => {
    new MemoryStore(ws, { scope: 'workspace' }).close(); // create ~/cigna/.memini
    new MemoryStore(repo).close(); // create project store
    const scopes = resolveScopes(repo);
    expect(scopes.find((s) => s.scope === 'project')?.root).toBe(repo);
    const wsScope = scopes.find((s) => s.scope === 'workspace');
    expect(wsScope?.exists).toBe(true);
    expect(wsScope?.root).toBe(ws);
  });

  it('no workspace scope when no ancestor store exists', () => {
    new MemoryStore(repo).close();
    expect(resolveScopes(repo).find((s) => s.scope === 'workspace')).toBeUndefined();
  });
});

describe('cross-scope guardrails', () => {
  it('verified workspace memories fire in repos below, by glob', () => {
    const wsStore = new MemoryStore(ws, { scope: 'workspace' });
    wsStore.add({
      type: 'deployment',
      title: 'Org rule: vercel.json edits need platform review',
      body: 'Internal network deploys are managed; do not hand-edit.',
      files: ['vercel.json'],
      severity: 'warn',
      confidence: 'human_verified',
    });
    wsStore.close();
    new MemoryStore(repo).close();

    const hits = checkAllScopes(repo, join(repo, 'vercel.json'));
    expect(hits).toHaveLength(1);
    expect(hits[0].scope).toBe('workspace');
  });

  it('unverified workspace memories never fire (agent-poisoning defense)', () => {
    const wsStore = new MemoryStore(ws, { scope: 'workspace' });
    wsStore.add({
      type: 'fragile_file',
      title: 'agent claimed',
      body: 'x',
      files: ['vercel.json'],
      severity: 'block',
      confidence: 'agent_claimed',
    });
    wsStore.close();
    new MemoryStore(repo).close();
    expect(checkAllScopes(repo, join(repo, 'vercel.json'))).toHaveLength(0);
  });

  it('project and workspace hits merge, project store paths still exact', () => {
    const wsStore = new MemoryStore(ws, { scope: 'workspace' });
    wsStore.add({ type: 'deployment', title: 'ws rule', body: 'x', files: ['vercel.json'], severity: 'warn', confidence: 'human_verified' });
    wsStore.close();
    const prj = new MemoryStore(repo);
    prj.add({ type: 'failed_attempt', title: 'repo lesson', body: 'x', files: ['vercel.json'], severity: 'warn' });
    prj.close();
    const hits = checkAllScopes(repo, join(repo, 'vercel.json'));
    expect(hits.map((h) => h.scope).sort()).toEqual(['project', 'workspace']);
  });
});

describe('scoped digest', () => {
  it('labels wider-scope entries and filters unverified ones', () => {
    const wsStore = new MemoryStore(ws, { scope: 'workspace' });
    wsStore.add({ type: 'deployment', title: 'Org OAuth rule', body: 'Use org OAuth for db connections', confidence: 'human_verified' });
    wsStore.add({ type: 'deployment', title: 'Unverified claim', body: 'x', confidence: 'agent_claimed' });
    wsStore.close();
    const prj = new MemoryStore(repo);
    prj.add({ type: 'decision', title: 'Repo decision', body: 'y' });
    prj.close();

    const stores = openScopedStores(repo);
    const digest = buildScopedDigest(stores);
    stores.forEach(({ store }) => store.close());

    expect(digest).toContain('Org OAuth rule');
    expect(digest).toContain('[workspace]');
    expect(digest).toContain('Repo decision');
    expect(digest).not.toContain('Unverified claim');
  });
});
