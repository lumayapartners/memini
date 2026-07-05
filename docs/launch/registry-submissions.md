# Registry submissions checklist

Status of each channel and exactly what to paste. Descriptions below are written to each list's
rules (descriptive, not promotional, no reader-addressing).

## 1. Official MCP registry — AUTOMATED ✅ (nothing to do)

Publishing happens from the release workflow via GitHub Actions OIDC (no account, no secrets).
Every `v*` tag now: publishes to npm → waits for propagation → publishes `server.json` to
registry.modelcontextprotocol.io. First run: tag v0.2.1.

## 2. PulseMCP — AUTOMATIC after #1 (nothing to do)

PulseMCP ingests the official registry daily and processes weekly. memini appears ~a week after
v0.2.1 is in the official registry. If the listing needs corrections later: hello@pulsemcp.com.

## 3. mcpservers.org — ✅ SUBMITTED 2026-07-05 (review within ~12h, email confirmation follows)

URL: https://mcpservers.org/submit (free tier; ignore the $39 premium)

- **Server Name:** memini
- **Short Description:** Local-first project memory for AI coding agents. Records failed attempts, fragile files, and decisions per repo, and warns the agent via hooks before it repeats a recorded mistake.
- **Link:** https://github.com/lumayapartners/memini
- **Category:** Memory
- **Contact Email:** admin@lumayapartners.com

## 4. awesome-claude-code — ⏸️ BLOCKED 2026-07-05, RETRY in a few days

Attempted 2026-07-05: repo has GitHub interaction limits enabled (issue creation restricted to
collaborators — a temporary anti-spam setting). Retry the same form when it lifts.
GitHub issue form, ~3 minutes (must be submitted by a human, PRs prohibited)

URL: https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml

- **Display Name:** memini
- **Category:** Memory & Context Persistence
- **Link:** https://github.com/lumayapartners/memini
- **Author Name:** Lumaya Partners
- **Author Link:** https://github.com/lumayapartners
- **Description:** Project memory with enforcement: a PreToolUse hook warns or blocks the agent before it edits files with recorded failed fixes, and a session-start hook injects per-repo decisions, deployment rules, and fragile-file history.
- Tick all three checkboxes (not a duplicate / link works / Claude Code-specific — the hooks are Claude Code-specific, so this is accurate).

## 5. awesome-mcp-servers (punkpeye) — 🖱️ BRANCH READY, PR NOT YET OPENED

One click: https://github.com/TanmayKnight/awesome-mcp-servers/pull/new/add-memini
(branch `add-memini` on the fork already contains the edit below; just paste title + body)

Section: `### 🧠 Knowledge & Memory`, alphabetical order. Entry line:

```markdown
- [lumayapartners/memini](https://github.com/lumayapartners/memini) 📇 🏠 🍎 🪟 🐧 - Local-first project memory and guardrails for coding agents. Records failed attempts, fragile files, and decisions per repo; warns the agent before it repeats a recorded mistake. `npx -y memini mcp`
```

(📇 TypeScript, 🏠 local. Their rules: agent-opened PRs must add `🤖🤖🤖` to the PR title.)

PR title: `Add memini (Knowledge & Memory) 🤖🤖🤖`

## 6. Smithery — SKIP for now

Their current flow wants either a hosted HTTP server (we're stdio/local-first) or an MCPB bundle
upload under a claimed namespace. Real effort, unclear audience overlap for a local-first tool.
Revisit if users ask for it or if we ever ship a hosted tier.
