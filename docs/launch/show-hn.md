# Show HN post

**Title (80 chars max, no hype words — HN penalizes them):**

> Show HN: Memini – Stop your AI coding agent from repeating its own mistakes

**URL:** https://github.com/lumayapartners/memini

**Body:**

---

Last month my coding agent broke a Vercel deploy by editing vercel.json. It took an hour to find the real fix (the checkout call had to move server-side). Three days later, on a similar bug, a fresh session of the same agent went straight back to editing vercel.json. Same dead end, same wasted hour. It had no idea it had already tried that.

Coding agents are stateless between sessions. CLAUDE.md and the new auto-memory features help with preferences and project facts, but nothing records *what was tried and failed* — and more importantly, nothing puts that history in front of the agent at the moment it's about to repeat it. Memory tools exist (Mem0, Supermemory, claude-mem), but they're libraries the agent may or may not decide to consult. In practice, it doesn't.

So we built memini (Latin: "I remember"). Two ideas:

1. Typed, git-linked memories that live in your repo: failed attempts, fragile files, decisions, deployment rules. Stored in SQLite, rendered to human-readable markdown you can review in a PR. Each memory records the branch/commit it came from and hashes the files it references — when the referenced code changes, the memory is flagged stale and stops firing until re-verified.

2. Enforcement via hooks, not advice via tools. On Claude Code, a PreToolUse hook intercepts the edit *before it happens*:

    PROJECT MEMORY GUARDRAIL for `vercel.json`:
    [WARNING] Editing vercel.json broke the build (recorded 2026-06-12)
    Tried changing buildCommand; deploy failed.
    Actual fix: move checkout server-side, set VITE_STRIPE_USE_SERVER=true.

   `warn` severity blocks once and allows a considered retry; `block` denies until a human archives the memory. The agent doesn't get to skip the warning, because it never has to remember to ask. The hook path is ~45ms per edit (SQLite lookup, no LLM calls) and fails open — a broken guardrail can never break your agent.

There's also an MCP server so agents can record what they learn (`remember_failed_attempt`, `remember_fragile_file`, session summaries) — agent-written memories are labeled until a human approves them. Works with Cursor/Windsurf via MCP; enforced hooks are Claude Code-only for now.

Try it (local-first, no account, no telemetry):

    cd your-repo
    npx -y memini init

Honest limitations, before you find them: guardrails intercept edit tools, not arbitrary bash (`echo > file` bypasses them — this is a strong nudge with evidence, not a sandbox). Prompt injection via memory bodies is mitigated (data-not-instructions framing, size caps, approval labels) but not eliminated — threat model is in SECURITY.md. And warn-severity is deliberately advisory; block is the hard stop.

MIT licensed. The roadmap is team-shared memory — your agent warned by your teammate's agent's failure from yesterday — which is where we think this gets genuinely interesting for agencies running many client repos.

Would love feedback, especially from anyone running agents across multiple repos daily: what does your agent keep forgetting?

---

**First comment (post immediately after submitting, from your account):**

Author here. A few technical notes that didn't fit the post:

- Why hooks instead of MCP tools: we tested tool-based recall first. Agents call `recall_project_context` maybe 20% of the time unprompted. The PreToolUse hook makes recall structurally guaranteed on the risky path (file edits), which is the only place it really matters.
- Warn-once semantics: first edit attempt on a flagged file is denied with the recorded history injected; an immediate retry proceeds. This maps well to how agents actually behave — they read the denial reason, reconsider, and either change approach or proceed deliberately.
- Staleness: memories hash referenced files at write time. `pm stale` flags memories whose evidence changed; stale memories stop firing guardrails but still appear in recall marked "possibly outdated". This was the fix for the "old memories poison the context" problem every memory tool hits.
- The DB is gitignored; only rendered markdown is committed (one-way render, never parsed back). That's deliberate: it keeps the attack surface of "teammate commits malicious memory" closed until we build the reviewed team-sync flow.
