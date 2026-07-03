# Security

## Reporting a vulnerability

Email admin@lumayapartners.com or open a GitHub security advisory on this repo. Please do not file public issues for exploitable vulnerabilities.

## Threat model

memini is a **local-first** tool: everything runs with the developer's own privileges on the developer's machine. There is no server, no account, and no telemetry. The realistic adversary is a **prompt-injected or misbehaving AI agent** with access to memini's MCP tools and the repo, or malicious content entering memory bodies.

### Protections in place

- **No SQL injection:** all queries are parameterized; FTS search terms are tokenized, quoted, and bound.
- **No shell injection:** git is invoked via `execFile` with argv arrays (no shell); the generated hook shim single-quote-escapes embedded paths.
- **Path containment:** file references that resolve outside the repository root are rejected on write and ignored on guardrail checks; memini never reads files outside the repo.
- **Secret redaction:** memory titles/bodies and committed session summaries are scanned for common secret shapes (cloud keys, API tokens, JWTs, private keys, connection strings, URL credentials, password assignments) and redacted **before storage**. This is best-effort defense in depth, not a guarantee — do not paste secrets into memories.
- **Context-injection hardening:** memory text injected into agent context is explicitly framed as *data, not instructions*, size-capped per entry, and token-budgeted overall. Agent-created memories are labeled `agent_claimed` until a human runs `pm approve`.
- **Bounded storage:** memory bodies are truncated at write time; warn-once tracking rows are garbage-collected after 14 days.
- **Local by default:** `memory.db` and the machine-specific hook shim are gitignored; only human-readable markdown views are committed, and they are one-way renders (never parsed back).
- **Supply chain:** minimal dependency set, `npm audit` clean, published tarball contains only compiled `dist/`, README, and LICENSE.

### Accepted limitations (by design — know these)

1. **Guardrails cover file-edit tools, not arbitrary shell.** The hook intercepts `Edit`/`Write`/`MultiEdit`/`NotebookEdit`. An agent can still modify a protected file via `Bash` (`echo > file`). Guardrails are a strong nudge with evidence, not a sandbox.
2. **Hooks fail open.** If the guardrail crashes (corrupt DB, malformed input), the edit proceeds and the error is logged to stderr. A broken guardrail must never break your agent; the tradeoff is that failures disable protection silently unless you watch hook logs.
3. **`warn` severity is advisory.** It blocks once per session and allows retry — an agent that retries proceeds. Use `block` for files that must not be touched; `block` requires a human to `pm archive` the memory.
4. **Prompt injection cannot be fully eliminated.** Memory bodies are shown to the agent; the data-not-instructions framing reduces but does not eliminate the risk that a model follows embedded directives. Review agent-created memories (`pm list`, `pm approve`) — especially in repos where untrusted parties can influence what agents record.
5. **Redaction is pattern-based.** Novel or unusual secret formats can slip through. The gitignored DB never leaves your machine, but committed markdown views do — review them like any other diff.
