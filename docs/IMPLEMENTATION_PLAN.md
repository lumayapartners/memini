# Implementation Plan — "Guardrail" (working name)

**Product:** Team-shared project memory and mistake-prevention guardrails for AI coding agents.
**One-line promise:** Your team's AI agents stop repeating each other's mistakes.
**Read first:** `MARKET_ANALYSIS.md` for why the scope is guardrails + team memory, NOT generic memory storage.

This plan is written to be executed by LLM coding agents (Claude Opus/Sonnet, etc.). Each phase lists concrete tasks, file layout, schemas, and acceptance criteria. Execute phases in order; do not start a phase before the previous phase's acceptance criteria pass. Gates marked **GO/KILL** require a human decision.

---

## Product definition

### What it is
1. A **local CLI + storage layer** (`.projectmemory/` in each repo) holding structured, human-readable memories: failed attempts, fragile files, decisions, deployment rules, session summaries.
2. An **MCP server** exposing recall/remember tools to any MCP-compatible coding agent.
3. **Hook integrations** (Claude Code hooks first) that *force* guardrail checks into the agent loop — a warning fires before the agent edits a known-fragile file, whether or not the agent chose to consult memory.
4. **Git-aware staleness detection** — memories reference commits/files; when referenced code changes materially, memories get flagged for review.
5. (Paid, later) **Team sync** — memories proposed by agents, reviewed by humans, shared across a team and across tools.

### What it is NOT (non-goals — do not build these)
- Not a vector database, RAG system, or retrieval-benchmark competitor. Plain SQLite FTS5 + structured types is sufficient.
- Not a general "memory for all AI agents" API. Coding agents on git repos only.
- Not a chat-history summarizer. Memories are discrete, typed, reviewable facts.
- No cloud anything until Phase 5. No accounts, no telemetry beyond opt-in.

### Differentiation invariants (every feature must respect these)
- **Enforced, not advisory:** the guardrail path must work even when the agent never calls an MCP tool.
- **Human-readable and PR-able:** every memory exists as markdown a human can read, edit, and review in a pull request.
- **Git-linked evidence:** memories cite commits/branches/files so claims are verifiable and staleness is detectable.
- **Cross-tool:** nothing may depend on a single agent product. Core = CLI + files; MCP and hooks are thin adapters.

---

## Architecture

### Stack
- **Language:** TypeScript on Node.js ≥ 20 (single language for CLI + MCP server; best MCP SDK support; easy npm distribution).
- **Storage:** SQLite (via `better-sqlite3`) as index + canonical store; markdown files generated from it (one-way: DB → markdown render; markdown edits re-imported via `pm sync` command).
- **Search:** SQLite FTS5. No embeddings in MVP. (Optional embeddings behind a flag in Phase 4+ only if recall quality demands it.)
- **MCP:** official `@modelcontextprotocol/sdk`, stdio transport.
- **Git:** shell out to `git` (no libgit2 dependency).
- **Distribution:** npm package `@<org>/projectmemory` with `npx` support; single binary later via `bun build --compile` if needed.

### Repo layout (the product's own monorepo)
```
projectmemory/
  packages/
    core/        # domain logic: memory store, git linking, staleness, redaction
    cli/         # `pm` command — thin wrapper over core
    mcp/         # MCP server — thin wrapper over core
    hooks/       # hook adapters (claude-code first), shell entrypoints
  docs/
  examples/
  .github/workflows/ci.yml
```

### Per-user-repo data layout (what the tool creates in a customer's repo)
```
.projectmemory/
  memory.db              # SQLite, canonical store (gitignored by default; team mode syncs it)
  decisions.md           # rendered, human-readable views (committed)
  failed_attempts.md
  fragile_files.md
  architecture.md
  deployment.md
  client_preferences.md
  sessions/
    2026-07-03-fix-stripe-webhook.md
  config.json            # tool config: redaction rules, hook settings, sync settings
```

### SQLite schema (v1)
```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,              -- ulid
  type TEXT NOT NULL CHECK (type IN
    ('decision','failed_attempt','fragile_file','architecture',
     'deployment','client_preference','session_summary')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,               -- markdown
  severity TEXT DEFAULT 'info' CHECK (severity IN ('info','warn','block')),
  confidence TEXT DEFAULT 'unverified' CHECK (confidence IN
    ('unverified','agent_claimed','human_verified')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active','stale','archived','rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,                  -- 'agent:<name>' or 'human:<git user>'
  source_session TEXT
);
CREATE TABLE memory_refs (          -- git evidence links
  memory_id TEXT REFERENCES memories(id),
  ref_type TEXT CHECK (ref_type IN ('file','commit','branch','pr')),
  ref_value TEXT NOT NULL,          -- path, sha, branch name, PR url
  file_content_hash TEXT            -- hash of referenced file at link time (staleness)
);
CREATE VIRTUAL TABLE memories_fts USING fts5(title, body, content=memories);
```

---

## Phase 0 — Validation spike (Week 1–2). Cost: near-zero.

Goal: prove the core bet (guardrails change agent behavior) before writing production code.

Tasks:
1. Hand-author a `.projectmemory/fragile_files.md` and `failed_attempts.md` on 1–2 real repos the founders actively work on.
2. Write a throwaway Claude Code `PreToolUse` hook (bash/node script, <100 lines) that greps those files when the agent attempts `Edit`/`Write` on a listed path and injects the warning into the tool result.
3. Run 2 weeks of real daily work. Log every instance where (a) the hook fired, (b) the warning changed what the agent did, (c) the warning was noise.
4. Competitor teardown: actually install and use `claude-mem`, OpenMemory (Mem0), and Supermemory MCP for the same 2 weeks. Document exactly what they do and don't do against the differentiation invariants above.

**GO/KILL gate:** proceed only if the hook demonstrably prevented ≥3 real repeated mistakes across 2 weeks AND the competitor teardown confirms none of them does enforced guardrails + git-linked failed attempts. Otherwise stop or re-scope — you will have spent two weeks, not six months.

---

## Phase 1 — Core + CLI (Week 3–5)

Goal: `pm` CLI managing a `.projectmemory` store, fully usable by a human without any agent.

Tasks:
1. Scaffold monorepo (pnpm workspaces, TypeScript strict, vitest, ESLint).
2. Implement `core`: memory CRUD on the SQLite schema above; ULID ids; markdown rendering per type (`decisions.md` etc. regenerated on every write); `pm sync` re-import of hand-edited markdown (markdown is parsed with frontmatter blocks per memory).
3. Implement git linking: `pm remember` auto-captures current branch + HEAD sha; `--file <path>` links files and stores content hash.
4. Implement secret redaction: on every memory write, scan body against common secret patterns (AWS keys, JWTs, `sk-`/`pk_` keys, connection strings, high-entropy strings) and redact with `[REDACTED:<type>]`. Non-configurable ON by default.
5. CLI commands:
   - `pm init` — create `.projectmemory/`, sensible `.gitignore` entries, config.json
   - `pm remember <type> "<title>" [--body|-] [--file <path>...] [--severity warn|block]`
   - `pm recall [query] [--type t] [--file <path>] [--json]` — FTS + filters; `--file` returns memories whose refs match the path (this powers guardrails)
   - `pm list / pm show <id> / pm edit <id> / pm archive <id>`
   - `pm check <path>` — exit code + stderr warning if active warn/block memories reference the path (the guardrail primitive; hooks call this)
   - `pm stale` — recompute file content hashes; flag memories whose referenced files changed >N% (line-diff ratio) as `stale`
   - `pm session start/end` — session summary skeleton written to `sessions/`
6. Tests: unit tests for store, redaction, staleness; golden-file tests for markdown rendering; ≥80% coverage on `core`.

Acceptance criteria:
- Fresh repo → `pm init` → `pm remember failed_attempt "Changing vercel.json broke build" --file vercel.json --severity block` → `pm check vercel.json` exits non-zero and prints the memory in <100ms.
- Hand-editing `failed_attempts.md` then `pm sync` round-trips without data loss.
- A body containing a fake AWS key is stored redacted.
- `git log` shows rendered markdown diffs that a human can review in a PR.

## Phase 2 — MCP server + hooks (Week 5–8). This is the differentiating phase.

Goal: agents both *can* use memory (MCP) and *can't avoid* guardrails (hooks).

Tasks:
1. MCP server (`pm mcp` / `packages/mcp`), stdio, exposing tools with JSON-schema outputs:
   - `recall_project_context({task_description})` → top-K relevant active memories, grouped by type, with a hard token budget (~1500 tokens) and severity-first ordering
   - `check_before_editing({file_path})` → warn/block memories for that path + staleness flags
   - `remember_decision({title, body, files?})`, `remember_failed_attempt({title, what_was_tried, why_it_failed, files?})`, `remember_fragile_file({file_path, reason, severity})`
   - `end_session_summary({what_changed, what_worked, what_failed})` → writes session file + proposes memories (created as `confidence: agent_claimed`)
2. Claude Code hook adapter (`packages/hooks`):
   - `PreToolUse` on Edit/Write/NotebookEdit → runs `pm check <path>` → on warn: inject warning text into context; on block-severity: deny with the memory as the reason (agent must acknowledge/override via explicit flag)
   - `SessionStart` → inject `recall_project_context` output (token-budgeted)
   - `Stop`/`SessionEnd` → prompt session summary
   - `pm install-hooks claude-code` writes `.claude/settings.json` entries idempotently
3. Cursor/Windsurf adapters: MCP config generators (`pm install-mcp cursor|windsurf`); document rules-file fallback where hooks don't exist.
4. Loop-safety: hook must be <50ms p95 (SQLite lookup only, no LLM calls), fail-open on error, and rate-limit repeated identical warnings within one session.
5. Integration test harness: scripted Claude Code session (headless `claude -p`) on a fixture repo proving: fragile-file edit triggers warning; blocked file edit is denied; session start injects context.

Acceptance criteria:
- On a fixture repo with a `block` memory on `vercel.json`, a headless agent instructed to "fix the deploy by editing vercel.json" is interrupted by the guardrail and cites the stored failed attempt in its response — *with zero MCP tool calls by the agent*.
- All MCP tools pass MCP Inspector validation; recall output never exceeds token budget.
- Hook overhead measured <50ms p95 on a repo with 1,000 memories.

**Demo gate:** record the before/after video (agent repeats mistake vs. agent warned) — this is the launch asset. Do not proceed to Phase 3 without a compelling recording.

## Phase 3 — Polish + OSS launch (Week 8–12)

Goal: public open-source launch; success = usage signal, not revenue.

Tasks:
1. DX hardening: `npx @<org>/projectmemory init` one-command setup incl. hook install; clear README with 90-second quickstart; `pm doctor` diagnosing broken hook/MCP config.
2. Staleness UX: `pm stale` runs in a post-commit hook (optional); stale memories demoted from guardrail firing but surfaced in recall as "possibly outdated".
3. Session summary quality: template with structured sections; memories proposed at session end require `pm approve <id>` (or auto-approve config) before they gain guardrail power — this is the quality-control loop from the memo's "poor memory quality" risk.
4. Docs site (simple, e.g. Vitepress) with: quickstart per tool (Claude Code, Cursor, Windsurf, Codex CLI), memory-type guide, hook security notes.
5. Launch: MIT license; Show HN + r/ClaudeAI + Cursor forum + MCP registries; publish the before/after demo and 2–3 "my agent remembered last week's fix" write-ups from Phase 0 dogfooding.
6. Instrument (opt-in only): anonymous counters for guardrail fires and recalls.

**GO/KILL gate (Month 4):** ≥500 GitHub stars OR ≥200 weekly active repos (opt-in telemetry / npm downloads as proxy) OR ≥20 unsolicited "this saved me" reports. Below all three → the wedge isn't landing; do not build the paid layer; investigate why (positioning vs. product) before spending more.

## Phase 4 — Team sync (paid) (Month 4–7)

Goal: first revenue. Multiplayer memory: agents propose, humans review, team shares.

Tasks:
1. Sync backend: start with **git-native sync** (memories as files in-repo, merged via normal git) as the free tier's team story, then build **cloud sync** (Supabase or Postgres + row-level security) for: cross-repo org memory, non-committed private memories, and review workflow.
2. Review workflow: web dashboard (Next.js on Vercel) — queue of `agent_claimed` memories → human approve/reject/edit → approved memories sync to all teammates' local stores and gain guardrail power team-wide.
3. Identity/billing: GitHub OAuth; Stripe per-seat subscription ($15–25/user/mo); 14-day trial; team = GitHub org mapping.
4. Conflict/merge semantics: last-writer-wins per memory id + tombstones; document clearly.
5. Agency features (fast follow): multi-repo workspaces, per-client grouping, client handoff export (bundle of all memories for a repo as a readable doc).

Acceptance criteria: two developers on the same repo — dev A's agent records a failed attempt, dev B's agent is warned within one sync cycle (<60s cloud, next-pull git). 5 design partners (target agencies from Phase 3 users) actively syncing.

**GO/KILL gate (Month 8):** ≥10 paying teams or ≥$2k MRR with active design-partner pipeline. Below → the OSS tool may still thrive, but reconsider the business (options: acquisition conversations, consulting-adjacent model, or sunset paid).

## Phase 5 — Scale what works (Month 8+)

Direction depends on Phase 4 signal; candidates in priority order:
1. **Enterprise-lite:** self-hosted sync server (Docker), SSO/SAML, audit log export — sell to the first team that asks, custom pricing.
2. **Deeper intelligence:** optional embeddings for recall; memory dedup/consolidation (background LLM pass, like "dream" consolidation); PR-review bot that comments when a diff touches fragile files.
3. **More surfaces:** GitHub Action (guardrail check in CI), VS Code extension surfacing memories inline, Codex/Gemini CLI hook adapters as those ecosystems standardize.

---

## Operating principles for LLM agents executing this plan

1. Work phase by phase; within a phase, tasks are ordered — respect dependencies.
2. Every task ends with tests passing and a conventional commit. CI (lint + typecheck + tests) must stay green.
3. When a design decision isn't specified here, choose the option that preserves the four differentiation invariants; record the decision in `docs/decisions/` (dogfood the product's own philosophy).
4. Never add a cloud dependency, account requirement, or telemetry before Phase 4, even if convenient.
5. Performance budgets are requirements, not suggestions: hook path <50ms p95, recall <200ms, init <5s.
6. Prefer boring technology. Any proposal to add a vector DB, graph DB, or new service before Phase 5 is out of scope by definition.

## Success metrics summary

| Checkpoint | Metric | Threshold |
|---|---|---|
| Week 2 (Phase 0) | Real mistakes prevented in dogfooding | ≥3 |
| Month 4 (post-launch) | Stars / weekly active repos / love | 500 / 200 / 20 |
| Month 8 (paid) | Paying teams / MRR | 10 / $2k |
| Month 12 | MRR / logo retention | $10k / >85% |
