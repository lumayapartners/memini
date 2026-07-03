# Design: memory scopes (v0.2 candidate)

Origin: Tanmay's daily use case — multiple client projects on one work laptop. Each project has
project-specific guardrails, but some knowledge ("how AWS infra is set up on the org's internal
network", "database connections must use org OAuth, never PATs") applies to every repo on that
machine belonging to that org — and to nothing else.

## Scopes

| Scope | Location | Resolution | Typical content |
|---|---|---|---|
| project | `<repo>/.memini/` | repo root (today's behavior, unchanged) | file-linked failed attempts, fragile files, repo decisions |
| workspace | `.memini/` in an ancestor directory of the repo | directory walk upward from repo root (first hit wins; like .gitconfig/ESLint/CLAUDE.md) | org/network conventions shared across sibling repos |
| user | `~/.memini/` | always merged | personal workflow rules that follow the developer |

Explicitly NOT adding a fourth "global" tier: on one machine user ≈ global, and cross-machine
sharing is the cloud team-sync tier (Phase 4), not a filesystem scope.

## User control (core requirement)

- `pm remember <type> <title> --scope project|workspace|user` (default: project)
- `pm promote <id> --workspace|--user` — lift a project memory outward
- `pm demote <id>` — push back down / restrict
- Digest, recall, and guardrail output label every memory with its scope.

## Precedence & merging

- All applicable scopes merge into digest/recall, labeled.
- Conflicts: most specific scope wins; the wider memory is suppressed for that repo
  (suppression is visible in `pm recall --all`).
- Token budget priority: project first, then workspace, then user.

## Guardrail semantics across scopes

- File-linked guardrails at workspace/user scope match by repo-relative path/glob
  (e.g. `vercel.json`, `**/serverless.yml`) since absolute paths differ per repo.
- SECURITY: wider scope = wider injection blast radius. Non-project memories must be
  `human_verified` to fire guardrails or enter the digest. Agents (MCP tools) can only
  write to project scope; widening requires a human `pm promote`.

## Relationship to team sync (Phase 4)

Workspace scope is single-player team memory: same review-before-widening flow, same
provenance labeling, same precedence questions. Building it first derisks the Phase 4
architecture with zero cloud infrastructure.

## Open questions

- Should `pm init` in a repo under a workspace dir auto-link, or ask? (lean: auto, print notice)
- Stale detection for workspace memories with file globs — hash per matching repo? (lean: v1
  workspace memories are unhashed; staleness stays project-only)
- Windows: `~/.memini` → `%USERPROFILE%\.memini`.
