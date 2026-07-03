# Demo video script

**Target:** 90–120 seconds, screen recording + your voice. Don't script yourself word-for-word — the notes below are talking points. Record the narration while actually doing the thing, not dubbed after; slight stumbles and "ok so..." are good, they read as real. No music, no title cards with slogans.

**Cuts from the same footage:**
- Full version → README link + Show HN first comment + YouTube
- ~30s cut (scenes 2+4) → X/Reddit
- GIF of the scene 4 guardrail moment → top of README

---

## Setup (before recording)

```bash
mkdir demo-app && cd demo-app && git init
# minimal app with a vercel.json so it looks like a real project
npx -y memini init
```

Terminal font ≥16pt, clean prompt, hide anything personal. If you have a real repo where this actually happened to you, use that instead of the fixture — real beats staged everywhere it's possible.

## Scene 1 — the problem (~20s)

**Screen:** Claude Code session. Ask it to fix a failing deploy. Let it find and start editing `vercel.json` (no memories recorded yet, so nothing intervenes).

**Talking points, your words:**
- this happened to me for real — agent decided the deploy failure was in vercel.json, edited it, broke the build worse
- the actual fix was something else entirely (checkout call had to move server-side)
- and because sessions don't share memory, a few days later a fresh session did the exact same thing

## Scene 2 — recording the lesson (~20s)

**Screen:**

```bash
npx -y memini remember failed_attempt \
  "Editing vercel.json broke the build" \
  -b "Tried changing buildCommand; deploy failed harder.
Actual fix: move checkout server-side, set VITE_STRIPE_USE_SERVER=true." \
  --file vercel.json --severity warn
```

Then `cat .memini/failed_attempts.md` briefly.

**Talking points:**
- one command to write down what happened (the agent can also do this itself at session end)
- it's just markdown + sqlite in the repo, linked to the commit — you can read everything it knows

## Scene 3 — cut (~3s)

**Screen:** text on terminal: `# three days later, fresh session`

Nothing fancy. `echo` it if you want.

## Scene 4 — the guardrail fires (~35s, this is the whole video)

**Screen:** new Claude Code session, same repo. Ask it to fix a deploy failure again. It goes for `vercel.json` → the hook denies the edit and the recorded history appears in the session. Let its full reaction play: it should back off and go for the server-side fix, citing the memory.

**Talking points:**
- fresh session, it knows nothing about last time
- watch — it goes for vercel.json again... and gets stopped
- this isn't the agent choosing to check its notes, it's a PreToolUse hook, the edit is intercepted before it happens
- it reads what failed last time and what the actual fix was, and goes straight there

**Recording notes:** retake this scene until the agent visibly pivots and references the recorded fix in its own words. Leave the guardrail text on screen at least 4 seconds. Don't trim the agent's "thinking" too aggressively — watching it change course is the proof.

## Scene 5 — wrap (~15s)

**Screen:** `npx -y memini init` in an empty repo, real time (it's ~3s). Then the GitHub page.

**Talking points:**
- that's the whole setup
- local, open source, nothing leaves your machine
- link's below, tell me what your agent keeps forgetting

---

## Publishing checklist

- [ ] YouTube: plain descriptive title ("Stopping a coding agent from repeating a failed fix — memini demo"), no clickbait
- [ ] GIF of scene 4 (≤10MB) at the top of README.md
- [ ] 30s cut for X/Reddit posts
- [ ] Video goes in the Show HN *comment*, not as the submission URL — the repo is the link
