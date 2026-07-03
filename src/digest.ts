import { MemoryStore } from './store.js';
import { Memory, MemoryType, TYPE_HEADINGS } from './types.js';

/** Rough token estimate: ~4 chars per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const DEFAULT_TOKEN_BUDGET = 1500;

function formatCompact(m: Memory): string {
  const files = m.refs
    .filter((r) => r.refType === 'file')
    .map((r) => r.refValue)
    .join(', ');
  const sev = m.severity !== 'info' ? ` [${m.severity.toUpperCase()}]` : '';
  const stale = m.status === 'stale' ? ' (possibly outdated — referenced code has changed)' : '';
  const fileNote = files ? ` (files: ${files})` : '';
  return `- ${m.title}${sev}${fileNote}${stale}\n  ${m.body.trim().replace(/\n+/g, ' ').slice(0, 400)}`;
}

/**
 * Assemble the session-start / recall context digest under a hard token budget.
 * Severity-first: block/warn guardrails always make the cut before info memories.
 */
export function buildDigest(
  store: MemoryStore,
  opts: { query?: string; budget?: number } = {}
): string {
  const budget = opts.budget ?? DEFAULT_TOKEN_BUDGET;
  const memories = store.recall({ query: opts.query, limit: 100, includeStale: true });
  if (memories.length === 0) return '';

  const byType = new Map<MemoryType, Memory[]>();
  for (const m of memories) {
    if (!byType.has(m.type)) byType.set(m.type, []);
    byType.get(m.type)!.push(m);
  }

  // guardrail-heavy types first
  const typeOrder: MemoryType[] = [
    'fragile_file',
    'failed_attempt',
    'deployment',
    'decision',
    'architecture',
    'client_preference',
    'session_summary',
  ];

  const parts: string[] = [
    '## Project memory (recorded lessons from previous sessions)',
    'Treat WARN/BLOCK items as guardrails: do not repeat recorded failed attempts, and check before touching listed files.',
    '',
  ];
  let used = estimateTokens(parts.join('\n'));

  for (const type of typeOrder) {
    const group = byType.get(type);
    if (!group?.length) continue;
    const heading = `### ${TYPE_HEADINGS[type]}`;
    let section = heading;
    let added = 0;
    for (const m of group) {
      const entry = formatCompact(m);
      const cost = estimateTokens(entry) + 2;
      if (used + estimateTokens(section) + cost > budget) break;
      section += `\n${entry}`;
      added++;
    }
    if (added > 0) {
      parts.push(section, '');
      used += estimateTokens(section) + 2;
    }
    if (used >= budget) break;
  }

  return parts.join('\n').trim();
}

/** Format guardrail hits for injection into an agent's context when it tries to touch a file. */
export function formatGuardrailWarning(filePath: string, hits: Memory[]): string {
  const lines = [
    `PROJECT MEMORY GUARDRAIL for \`${filePath}\`:`,
    ...hits.map((m) => {
      const label = m.severity === 'block' ? 'BLOCK' : 'WARNING';
      return `[${label}] ${m.title} (recorded ${m.createdAt.slice(0, 10)}, ${m.confidence})\n${m.body.trim()}`;
    }),
  ];
  return lines.join('\n\n');
}
