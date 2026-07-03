# Show HN post

**Title:**

> Show HN: Guardrails that stop coding agents from repeating failed fixes

**URL:** https://github.com/lumayapartners/memini

**Body:**

---

I got tired of watching my coding agent make the same mistake twice.

Concrete example from a few weeks ago: a Vercel deploy on a client project started failing. I asked the agent to fix it. It decided the problem was in vercel.json, edited it, and the build broke in a new way. We went in circles for a while before I worked out the actual issue — a Stripe call that had to move server-side. Annoying, but fine. Three days later the same project had a different deploy error. New session, and the first thing the agent did was open vercel.json again.

Everything I tried to fix this had the same weakness. CLAUDE.md is stuff you write ahead of time, and the newer auto-memory features mostly capture preferences and project facts, not "we tried X and it made things worse." The MCP memory servers (OpenMemory, claude-mem, that family) will store whatever you give them, but they depend on the agent deciding to search its memory before doing something risky. Mine basically never did that unprompted.

So the thing my partner and I built doesn't wait to be asked. It's a PreToolUse hook. When the agent tries to edit a file that has recorded history, the edit is intercepted and the history lands in its context before anything happens:

    PROJECT MEMORY GUARDRAIL for `vercel.json`:
    [WARNING] Editing vercel.json broke the build (recorded 2026-06-12)
    Tried changing buildCommand; deploy failed harder.
    Actual fix: move checkout server-side, set VITE_STRIPE_USE_SERVER=true.

A "warn" memory blocks the first attempt and lets a retry through — in practice the agent reads the denial reason and changes course. A "block" memory stays blocked until a human archives it. The lookup is a local sqlite query, about 45ms, and the hook fails open on any error so it can't wedge your session.

Memories are typed (failed_attempt, fragile_file, decision, deployment rules) and live in a .memini/ folder in the repo. The db is gitignored; rendered markdown is committed, so you can actually read what's accumulating and review it in PRs. Each memory stores the commit it was recorded at and a hash of the files it references. When a referenced file changes later, the memory gets flagged stale and stops firing until someone re-verifies it. That part turned out to matter more than I expected — a confidently wrong old memory is worse than no memory.

There's also an MCP server so the agent can record its own failures at the end of a session. Agent-written memories get labeled as such and don't count as verified until you approve them.

Setup is `npx -y memini init` in a repo. Local-first, no account, MIT. Hook enforcement is Claude Code only for now — Cursor and Windsurf get the MCP tools, but I haven't found an equivalent of PreToolUse there yet.

Things it doesn't do, to save you the trouble of finding out: it intercepts the edit tools, not bash, so an agent that echoes into a file goes right around it. And injected memory text is still text in a context window — we cap the size and frame it as data rather than instructions, but prompt injection through memories isn't a solved problem. Notes on both in SECURITY.md.

Curious whether other people's agents have this groundhog-day problem or if my projects are just cursed. What does yours keep forgetting?

---

**First comment (post right after submitting):**

Author here. Some details that didn't fit above.

We tried the polite version first — an MCP tool called recall_project_context the agent was supposed to call before starting work. Watching the logs over a couple of weeks of real use, it called it occasionally when the task description sounded scary, and skipped it the rest of the time. The hook approach came out of that frustration: the only reliable place to put memory is in the path of the action itself, not behind a tool the model has to think to use.

The warn-once thing also came from testing rather than design. Originally warnings blocked every attempt, which made the agent treat the guardrail as an obstacle and try to work around it (one memorable session it decided to write a new config file instead). Deny once with the reason, allow the retry — it reads the history, and either changes approach or proceeds having actually considered it. That's the behavior we wanted anyway.

The db-gitignored / markdown-committed split is deliberate: markdown renders are one-way, never parsed back, so a teammate can't inject memories into your agent by committing a doctored file. Shared team memory is the thing we want to build next, but it needs a review step before someone else's memory can fire guardrails on your machine.

**Style notes for whoever posts this (do not include):**

- Post Tue–Thu, 8–10am ET. Reply to every substantive comment in the first 3 hours with specifics, not thanks.
- If asked for benchmarks/numbers we don't have, say we don't have them yet. Nothing kills a Show HN faster than a caught embellishment.
- Replace the vercel.json story details with whatever actually happened in your dogfooding if it differs — every claim in the post should be personally defensible.
