# memini

**Never the same mistake twice.** Mistake-prevention guardrails and persistent project memory for AI coding agents.

AI coding agents are stateless: every session starts with amnesia. The agent that broke your build editing `vercel.json` on Monday will happily try the exact same edit on Thursday. `memini` gives each repo a persistent memory of **failed attempts, fragile files, decisions, and deployment rules** — and *force-feeds* the relevant warning to the agent at the moment it's about to repeat history.

Not a notebook the agent may choose to read. A guardrail it can't skip.

## How it works

1. **Memories live in your repo** — a `.memini/` folder with a local SQLite index and human-readable, PR-reviewable markdown views. Local-first: nothing leaves your machine.
2. **Hooks enforce guardrails** — when the agent tries to edit a file with recorded risks, the edit is intercepted *before it happens* and the recorded lesson is injected:
   > `[WARNING] Editing vercel.json broke the build (recorded 2026-07-03)` — Tried changing buildCommand; deploy failed. Actual fix: move checkout server-side and set `VITE_STRIPE_USE_SERVER=true`.
   - `warn` severity: the agent is warned once per session, then may proceed.
   - `block` severity: the edit is always denied until a human archives the memory.
3. **Session start injects a digest** of the most important memories (severity-first, token-budgeted).
4. **MCP tools** let the agent record what it learns: `remember_failed_attempt`, `remember_fragile_file`, `remember_decision`, `end_session_summary`, plus `recall_project_context` and `check_before_editing`.
5. **Git-aware staleness** — memories hash the files they reference; `pm stale` flags memories whose evidence has changed, and stale memories stop firing guardrails until re-verified.

## Quickstart (90 seconds)

```bash
cd your-repo
npx -y memini init       # creates .memini/ + installs Claude Code hooks

# record your first guardrail
npx -y memini remember failed_attempt \
  "Editing vercel.json broke the build" \
  -b "Tried changing buildCommand; deploy failed. Fix: move checkout server-side." \
  --file vercel.json --severity warn
```

That's it. Next time any Claude Code session in this repo tries to edit `vercel.json`, it gets the warning first.

**Other agents (Cursor, Windsurf, any MCP client):**

```bash
claude mcp add memini -- npx -y memini mcp   # Claude Code MCP
npx -y memini install-mcp --write cursor            # Cursor
npx -y memini install-mcp                           # print generic config
```

## CLI

| Command | What it does |
|---|---|
| `pm init` | Set up `.memini/`, gitignore, and hooks |
| `pm remember <type> <title> [-b body] [--file f...] [--severity warn\|block]` | Record a memory |
| `pm recall [query] [--file f] [--digest]` | Search memories / preview the agent digest |
| `pm check <path>` | Guardrail check (exit 1 if risks recorded) — usable in CI |
| `pm list / show / archive / approve <id>` | Manage memories |
| `pm stale` / `pm verify <id>` | Detect and re-verify outdated memories |
| `pm mcp` | Run the MCP server (stdio) |
| `pm doctor` | Diagnose setup |

Memory types: `decision`, `failed_attempt`, `fragile_file`, `architecture`, `deployment`, `client_preference`, `session_summary`.

## Design principles

- **Enforced, not advisory.** MCP memory tools are optional for the agent; hooks are not. The guardrail path works even if the agent never thinks to check its memory.
- **Human-readable, PR-able.** Every memory renders to markdown under `.memini/` that your team reviews like any other change.
- **Git-linked evidence.** Memories record the branch, commit, and file hashes they were born from, so claims are verifiable and staleness is detectable.
- **Local-first.** SQLite + markdown in your repo. No accounts, no cloud, no telemetry. Secrets are auto-redacted from memory bodies before they're stored.
- **Cross-tool.** Core is a CLI + files; Claude Code hooks and MCP are thin adapters.

## Security

Local-first by design: no server, no account, no telemetry. Secrets are auto-redacted before storage, file references are contained to the repo, and injected memory text is size-capped and framed as data. See [SECURITY.md](./SECURITY.md) for the full threat model — including the honest limitations (guardrails intercept edit tools, not arbitrary shell; `warn` is advisory, `block` is not).

## Status

Early (v0.1). Team sync — shared memory across your whole team, with a review workflow — is on the roadmap. Feedback and issues welcome.

## License

MIT
