import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryStore } from './store.js';
import { findRepoRoot } from './git.js';
import { renderMarkdown } from './render.js';
import { buildDigest, formatGuardrailWarning } from './digest.js';
import { redactSecrets } from './redact.js';
import { Severity } from './types.js';
import { VERSION } from './version.js';

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] };
}

export async function runMcpServer(cwd: string): Promise<void> {
  const root = findRepoRoot(cwd);
  const store = new MemoryStore(root);

  const server = new McpServer({ name: 'memini', version: VERSION });

  server.tool(
    'recall_project_context',
    'Load the most important project memories (failed attempts, fragile files, decisions, deployment rules) before starting work. Call this at the start of a task.',
    { task_description: z.string().describe('Short description of the task you are about to do') },
    async ({ task_description }) => {
      const digest = buildDigest(store, { query: task_description });
      return text(digest || 'No project memories recorded yet for this repo.');
    }
  );

  server.tool(
    'check_before_editing',
    'Check whether a file has recorded risks, failed attempts, or fragile-file warnings BEFORE editing it. Always call this before modifying configuration or deployment files.',
    { file_path: z.string().describe('Path of the file you intend to edit') },
    async ({ file_path }) => {
      const hits = store.check(file_path);
      if (hits.length === 0) return text(`No recorded risks for ${file_path}.`);
      return text(formatGuardrailWarning(file_path, hits));
    }
  );

  const rememberShape = {
    title: z.string().describe('One-line summary'),
    body: z.string().describe('Details in markdown: what, why, evidence'),
    files: z.array(z.string()).optional().describe('Repo-relative file paths this relates to'),
  };

  server.tool(
    'remember_decision',
    'Record an important design or implementation decision and WHY it was made, so future sessions do not relitigate or reverse it unknowingly.',
    rememberShape,
    async ({ title, body, files }) => {
      const m = store.add({ type: 'decision', title, body, files, createdBy: 'agent:mcp', confidence: 'agent_claimed' });
      renderMarkdown(store);
      return text(`Recorded decision ${m.id}: ${m.title}`);
    }
  );

  server.tool(
    'remember_failed_attempt',
    'Record an approach that was tried and FAILED, so no future session repeats it. Include what was tried, why it failed, and what the actual fix was (if known).',
    {
      title: z.string().describe('One-line summary of the failed approach'),
      what_was_tried: z.string(),
      why_it_failed: z.string(),
      actual_fix: z.string().optional().describe('The fix that actually worked, if discovered'),
      files: z.array(z.string()).optional(),
    },
    async ({ title, what_was_tried, why_it_failed, actual_fix, files }) => {
      const body = [
        `**Tried:** ${what_was_tried}`,
        `**Failed because:** ${why_it_failed}`,
        actual_fix ? `**Actual fix:** ${actual_fix}` : null,
      ]
        .filter(Boolean)
        .join('\n\n');
      const m = store.add({
        type: 'failed_attempt',
        title,
        body,
        files,
        severity: 'warn',
        createdBy: 'agent:mcp',
        confidence: 'agent_claimed',
      });
      renderMarkdown(store);
      return text(`Recorded failed attempt ${m.id}: ${m.title}. Future edits to linked files will be warned.`);
    }
  );

  server.tool(
    'remember_fragile_file',
    'Mark a file as fragile/risky so future sessions get a guardrail warning (or block) before touching it.',
    {
      file_path: z.string(),
      reason: z.string().describe('Why this file is fragile — what happened when it was mishandled'),
      severity: z.enum(['warn', 'block']).default('warn'),
    },
    async ({ file_path, reason, severity }) => {
      const m = store.add({
        type: 'fragile_file',
        title: `Fragile: ${file_path}`,
        body: reason,
        files: [file_path],
        severity: severity as Severity,
        createdBy: 'agent:mcp',
        confidence: 'agent_claimed',
      });
      renderMarkdown(store);
      return text(`Marked ${file_path} as fragile (${severity}), memory ${m.id}.`);
    }
  );

  server.tool(
    'end_session_summary',
    'At the end of a work session, record what changed, what worked, and what failed. Creates a session summary and proposes durable memories.',
    {
      summary_title: z.string(),
      what_changed: z.string(),
      what_worked: z.string(),
      what_failed: z.string().optional(),
      files: z.array(z.string()).optional(),
    },
    async ({ summary_title, what_changed, what_worked, what_failed, files }) => {
      const body = [
        `**Changed:** ${what_changed}`,
        `**Worked:** ${what_worked}`,
        what_failed ? `**Failed:** ${what_failed}` : null,
      ]
        .filter(Boolean)
        .join('\n\n');
      const m = store.add({
        type: 'session_summary',
        title: summary_title,
        body,
        files,
        createdBy: 'agent:mcp',
        confidence: 'agent_claimed',
      });
      const sessionsDir = join(store.dir, 'sessions');
      mkdirSync(sessionsDir, { recursive: true });
      const slug = summary_title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      const fname = `${new Date().toISOString().slice(0, 10)}-${slug || 'session'}.md`;
      // sessions/*.md may be committed — must go through redaction like the DB copy
      const safeTitle = redactSecrets(summary_title).text;
      const safeBody = redactSecrets(body).text;
      writeFileSync(join(sessionsDir, fname), `# ${safeTitle}\n\n${safeBody}\n`);
      renderMarkdown(store);
      return text(`Session summary saved (${m.id}, sessions/${fname}).`);
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
