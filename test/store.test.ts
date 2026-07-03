import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MemoryStore } from '../src/store.js';
import { renderMarkdown } from '../src/render.js';
import { buildDigest, estimateTokens, formatGuardrailWarning } from '../src/digest.js';

let root: string;
let store: MemoryStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pm-test-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t.dev'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: root });
  writeFileSync(join(root, 'vercel.json'), '{"buildCommand": "npm run build"}');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  store = new MemoryStore(root);
});

afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe('MemoryStore', () => {
  it('adds and retrieves a memory with git refs', () => {
    const m = store.add({
      type: 'failed_attempt',
      title: 'Editing vercel.json broke the build',
      body: 'Changed buildCommand, deploy failed.',
      files: ['vercel.json'],
      severity: 'warn',
    });
    expect(m.id).toBeTruthy();
    expect(m.refs.some((r) => r.refType === 'file' && r.refValue === 'vercel.json')).toBe(true);
    expect(m.refs.some((r) => r.refType === 'commit')).toBe(true);
    const fileRef = m.refs.find((r) => r.refType === 'file');
    expect(fileRef?.fileContentHash).toBeTruthy();
  });

  it('resolves memories by id prefix', () => {
    const m = store.add({ type: 'decision', title: 'Use Supabase', body: 'Because RLS.' });
    expect(store.get(m.id.slice(0, 8))?.id).toBe(m.id);
  });

  it('check() returns warn/block memories for a file, absolute or relative path', () => {
    store.add({
      type: 'fragile_file',
      title: 'Fragile: vercel.json',
      body: 'Broke prod twice.',
      files: ['vercel.json'],
      severity: 'block',
    });
    expect(store.check('vercel.json')).toHaveLength(1);
    expect(store.check(join(root, 'vercel.json'))).toHaveLength(1);
    expect(store.check('other.json')).toHaveLength(0);
  });

  it('check() ignores info-severity and archived memories', () => {
    const m = store.add({ type: 'decision', title: 'Info note', body: 'x', files: ['vercel.json'], severity: 'info' });
    const w = store.add({ type: 'fragile_file', title: 'Warn', body: 'x', files: ['vercel.json'], severity: 'warn' });
    expect(store.check('vercel.json')).toHaveLength(1);
    store.setStatus(w.id, 'archived');
    expect(store.check('vercel.json')).toHaveLength(0);
  });

  it('full-text recall finds memories by content', () => {
    store.add({ type: 'deployment', title: 'Stripe checkout fix', body: 'Move checkout server-side, set VITE_STRIPE_USE_SERVER=true' });
    store.add({ type: 'decision', title: 'Unrelated', body: 'Nothing here' });
    const results = store.recall({ query: 'stripe checkout' });
    expect(results).toHaveLength(1);
    expect(results[0].title).toContain('Stripe');
  });

  it('recall orders by severity first', () => {
    store.add({ type: 'decision', title: 'A info', body: 'x', severity: 'info' });
    store.add({ type: 'fragile_file', title: 'B block', body: 'x', severity: 'block' });
    store.add({ type: 'failed_attempt', title: 'C warn', body: 'x', severity: 'warn' });
    const results = store.recall({});
    expect(results.map((m) => m.severity)).toEqual(['block', 'warn', 'info']);
  });

  it('detects stale memories when referenced files change', () => {
    const m = store.add({ type: 'fragile_file', title: 'Fragile', body: 'x', files: ['vercel.json'], severity: 'warn' });
    expect(store.detectStale()).toHaveLength(0);
    writeFileSync(join(root, 'vercel.json'), '{"totally": "rewritten"}');
    const stale = store.detectStale();
    expect(stale).toHaveLength(1);
    expect(store.get(m.id)?.status).toBe('stale');
    // stale memories no longer fire guardrails
    expect(store.check('vercel.json')).toHaveLength(0);
    // re-verify restores guardrail with fresh hash
    store.reverify(m.id);
    expect(store.get(m.id)?.status).toBe('active');
    expect(store.check('vercel.json')).toHaveLength(1);
    expect(store.detectStale()).toHaveLength(0);
  });

  it('rejects file refs that escape the repository root', () => {
    expect(() =>
      store.add({ type: 'fragile_file', title: 'evil', body: 'x', files: ['../../../etc/passwd'], severity: 'warn' })
    ).toThrow(/escapes repository root/);
    expect(() =>
      store.add({ type: 'fragile_file', title: 'evil-abs', body: 'x', files: ['/etc/passwd'], severity: 'warn' })
    ).toThrow(/escapes repository root/);
    // check() on an outside path silently returns nothing (hook fail-open path)
    expect(store.check('../outside.txt')).toHaveLength(0);
  });

  it('truncates oversized bodies at write time', () => {
    const m = store.add({ type: 'decision', title: 'big', body: 'x'.repeat(50_000) });
    expect(m.body.length).toBeLessThan(17_000);
    expect(m.body).toContain('[…truncated]');
  });

  it('warn-once session tracking', () => {
    expect(store.hasWarned('s1', 'vercel.json')).toBe(false);
    store.markWarned('s1', 'vercel.json');
    expect(store.hasWarned('s1', 'vercel.json')).toBe(true);
    expect(store.hasWarned('s2', 'vercel.json')).toBe(false);
  });
});

describe('renderMarkdown', () => {
  it('renders committed, human-readable views', () => {
    store.add({ type: 'failed_attempt', title: 'Bad fix', body: 'Details here', files: ['vercel.json'], severity: 'warn' });
    renderMarkdown(store);
    const md = readFileSync(join(store.dir, 'failed_attempts.md'), 'utf-8');
    expect(md).toContain('# Failed Attempts');
    expect(md).toContain('Bad fix');
    expect(md).toContain('`vercel.json`');
    expect(existsSync(join(store.dir, 'decisions.md'))).toBe(true);
  });
});

describe('buildDigest', () => {
  it('respects the token budget and puts guardrails first', () => {
    for (let i = 0; i < 50; i++) {
      store.add({ type: 'decision', title: `Decision ${i}`, body: 'y'.repeat(300) });
    }
    store.add({ type: 'fragile_file', title: 'DANGER file', body: 'do not touch', files: ['vercel.json'], severity: 'block' });
    const digest = buildDigest(store, { budget: 800 });
    expect(estimateTokens(digest)).toBeLessThanOrEqual(900);
    expect(digest).toContain('DANGER file');
    expect(digest.indexOf('Fragile Files')).toBeLessThan(digest.indexOf('Decisions'));
  });

  it('returns empty string for empty store', () => {
    expect(buildDigest(store)).toBe('');
  });

  it('marks injected memory text as data, not instructions', () => {
    store.add({ type: 'fragile_file', title: 'F', body: 'x', files: ['vercel.json'], severity: 'warn' });
    expect(buildDigest(store)).toContain('not instructions');
    const warning = formatGuardrailWarning('vercel.json', store.check('vercel.json'));
    expect(warning).toContain('not instructions');
  });
});

describe('formatGuardrailWarning', () => {
  it('caps injected body length', () => {
    store.add({
      type: 'fragile_file',
      title: 'huge',
      body: 'y'.repeat(15_000),
      files: ['vercel.json'],
      severity: 'warn',
    });
    const warning = formatGuardrailWarning('vercel.json', store.check('vercel.json'));
    expect(warning.length).toBeLessThan(2_000);
    expect(warning).toContain('[…truncated]');
  });
});
