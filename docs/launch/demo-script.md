# Demo video script — "Never the same mistake twice"

**Target length:** 90–110 seconds. One take per scene, no music needed, terminal + Claude Code side by side or sequential. Record with a clean terminal (large font, dark theme), a real-looking repo (use the fixture below), and your actual voice — HN/Reddit respond to authentic, not produced.

**Formats to cut from the same recording:**
- Full ~100s version → README + Show HN comment + YouTube
- 30s version (Scenes 2+4 only) → X/Twitter, Reddit inline
- GIF of Scene 4's guardrail moment → README header

---

## Setup (before recording)

```bash
mkdir demo-app && cd demo-app && git init
# minimal Vite-ish app with a vercel.json — enough to look real on screen
npx -y memini init
```

Pre-record hygiene: `clear` history, hide personal dirs from prompt, font ≥16pt.

## Scene 1 — The problem (0:00–0:20)

**Screen:** Claude Code session in the repo. Prompt: *"The Vercel deploy is failing with a build error, fix it."* Agent inspects and edits `vercel.json` (no memini memories exist yet — guardrail stays silent).

**Voiceover:**
> "Monday. My coding agent tries to fix a deploy failure by editing vercel.json. That change broke the build worse — the real fix turned out to be moving a checkout call server-side. An hour gone. Here's the thing: agents are stateless. Next session, this lesson is gone."

*(Tip: you can stage this — the point is showing the agent choosing vercel.json, not a full failure arc.)*

## Scene 2 — Record the lesson (0:20–0:40)

**Screen:** Terminal.

```bash
npx -y memini remember failed_attempt \
  "Editing vercel.json broke the build" \
  -b "Tried changing buildCommand; deploy failed harder.
Actual fix: move checkout server-side, set VITE_STRIPE_USE_SERVER=true." \
  --file vercel.json --severity warn
```

Show the output line: `Guardrail active: agents will be warned before editing vercel.json`.

Then briefly `cat .memini/failed_attempts.md` — scroll the human-readable memory with its commit link.

**Voiceover:**
> "So we record it once — one command, or the agent records it itself at session end. It's stored in the repo: readable markdown, linked to the git commit, reviewable in a PR like any other change."

## Scene 3 — Time passes (0:40–0:45)

**Screen:** Text card or fast cut: "3 days later. New session. Zero context."

## Scene 4 — THE MONEY SHOT (0:45–1:20)

**Screen:** Fresh Claude Code session (`claude`), same repo. Prompt: *"Deploy is failing again with a build error — fix it."*

The agent gathers context and attempts to edit `vercel.json` → **the guardrail fires on screen**:

```
PROJECT MEMORY GUARDRAIL for `vercel.json`:
[WARNING] Editing vercel.json broke the build (recorded 2026-07-03)
Tried changing buildCommand; deploy failed harder.
Actual fix: move checkout server-side, set VITE_STRIPE_USE_SERVER=true.
```

Let the agent's response play out: it abandons the vercel.json edit and goes for the server-side fix, citing the recorded memory.

**Voiceover:**
> "New session, no memory of Monday — and watch. The moment it reaches for vercel.json, the edit is intercepted. Not a note it might read — a hook it can't skip. The agent sees exactly what failed last time and what the actual fix was… and goes straight to the right answer. That hour we lost on Monday? It doesn't happen twice."

*(Recording tip: this scene is why the video exists. Do as many takes as needed until the agent visibly pivots and mentions the recorded fix. Keep the guardrail text on screen ≥4 seconds.)*

## Scene 5 — Close (1:20–1:40)

**Screen:** Quick cuts: `npx -y memini init` in a fresh repo (3 seconds, real time), then the README header.

**Voiceover:**
> "That's memini — Latin for 'I remember.' Failed attempts, fragile files, decisions, deployment rules — recorded in your repo, enforced by hooks, local-first, open source. One command to try it: npx memini init. Link below. Never the same mistake twice."

---

## Publishing checklist

- [ ] Upload full version to YouTube (title: "My AI coding agent stopped repeating its mistakes — memini demo")
- [ ] GIF of Scene 4 (≤10MB) embedded at the top of README.md
- [ ] 30s cut pinned to the repo and used in the X/Reddit posts
- [ ] Link video in the Show HN first comment, not the post body (HN prefers the repo as the main link)
