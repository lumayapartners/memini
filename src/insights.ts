import { Memory, MemoryType } from './types.js';
import { Scope } from './store.js';
import { openScopedStores } from './scopes.js';
import { globMatch } from './glob.js';

export interface ScopedMemory {
  memory: Memory;
  scope: Scope;
}

/** Gather active + stale memories across all scopes at a cwd (caller-agnostic). */
export function collectMemories(cwd: string): ScopedMemory[] {
  const stores = openScopedStores(cwd);
  try {
    return stores.flatMap(({ store, scope }) =>
      store
        .list()
        .filter((m) => m.status === 'active' || m.status === 'stale')
        .map((memory) => ({ memory, scope }))
    );
  } finally {
    stores.forEach(({ store }) => store.close());
  }
}

function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export interface Stats {
  total: number;
  byType: Record<string, number>;
  byScope: Record<string, number>;
  guardrails: number; // warn/block active
  totalFires: number;
  topFired: ScopedMemory[];
  neverFired: number; // guardrails that have never fired
  stale: number;
}

export function computeStats(items: ScopedMemory[]): Stats {
  const byType: Record<string, number> = {};
  const byScope: Record<string, number> = {};
  let guardrails = 0;
  let totalFires = 0;
  let neverFired = 0;
  let stale = 0;
  for (const { memory: m, scope } of items) {
    byType[m.type] = (byType[m.type] ?? 0) + 1;
    byScope[scope] = (byScope[scope] ?? 0) + 1;
    totalFires += m.fireCount;
    if (m.status === 'stale') stale++;
    if (m.severity === 'warn' || m.severity === 'block') {
      guardrails++;
      if (m.fireCount === 0) neverFired++;
    }
  }
  const topFired = [...items]
    .filter((i) => i.memory.fireCount > 0)
    .sort((a, b) => b.memory.fireCount - a.memory.fireCount)
    .slice(0, 5);
  return { total: items.length, byType, byScope, guardrails, totalFires, topFired, neverFired, stale };
}

// --- review: quality issues worth a human's attention ---

const NEVER_FIRED_STALE_DAYS = 45;

export interface ReviewFinding {
  kind: 'duplicate' | 'contradiction' | 'dormant';
  memories: ScopedMemory[];
  detail: string;
}

/** Normalize a title for fuzzy duplicate detection (lowercase, alphanumeric tokens). */
function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function fileSet(m: Memory): Set<string> {
  return new Set(m.refs.filter((r) => r.refType === 'file').map((r) => r.refValue));
}

function sharesFile(a: Memory, b: Memory): boolean {
  const fb = fileSet(b);
  for (const f of fileSet(a)) {
    if (fb.has(f)) return true;
    // glob-aware: workspace patterns vs project paths
    for (const g of fb) if (globMatch(f, g) || globMatch(g, f)) return true;
  }
  return false;
}

/**
 * Surface memories worth reviewing: near-duplicates, contradictory guardrails on
 * the same file, and dormant guardrails (never fired long after creation).
 * All heuristic and local — no LLM, reviewable by a human.
 */
export function reviewMemories(items: ScopedMemory[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const active = items.filter((i) => i.memory.status === 'active');

  // duplicates & contradictions (pairwise on file-sharing memories)
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i].memory;
      const b = active[j].memory;
      if (!sharesFile(a, b)) continue;
      const sim = jaccard(tokens(a.title), tokens(b.title));
      if (a.type === b.type && sim >= 0.5) {
        findings.push({
          kind: 'duplicate',
          memories: [active[i], active[j]],
          detail: `Similar ${a.type} memories on the same file (${Math.round(sim * 100)}% title overlap)`,
        });
      } else if (a.severity !== 'info' && b.severity !== 'info' && a.severity !== b.severity) {
        findings.push({
          kind: 'contradiction',
          memories: [active[i], active[j]],
          detail: `Different severities (${a.severity} vs ${b.severity}) guarding the same file`,
        });
      }
    }
  }

  // dormant guardrails: warn/block, never fired, older than threshold
  for (const it of active) {
    const m = it.memory;
    if ((m.severity === 'warn' || m.severity === 'block') && m.fireCount === 0) {
      const age = daysSince(m.createdAt);
      if (age !== null && age >= NEVER_FIRED_STALE_DAYS) {
        findings.push({
          kind: 'dormant',
          memories: [it],
          detail: `Guardrail created ${age}d ago has never fired — still relevant?`,
        });
      }
    }
  }
  return findings;
}

export const MEMORY_TYPE_ORDER: MemoryType[] = [
  'fragile_file',
  'failed_attempt',
  'deployment',
  'decision',
  'architecture',
  'client_preference',
  'session_summary',
];
