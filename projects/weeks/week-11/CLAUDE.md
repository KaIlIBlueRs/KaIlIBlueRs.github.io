# CLAUDE.md

Guidance for AI coding agents working in this repo (Claude Code / Codex).

## What this is
Whisker Watch: a Next.js (App Router, TypeScript) app, deployed on Vercel, that replays an earnings call in real time
and flags non-answers, deflection, hedging, pauses and vocal shifts. Each pattern pops a fixed cat GIF. See README.md.

## Commands
- `npm run dev`: local dev server (use `env -u OPENAI_API_KEY npm run dev` if the shell exports a different key)
- `npm run typecheck`, `npm run build`: run both before saying anything is done
- `npm run replay -- <audio> <startSec> <lenSec> [speed] [lyric|strict]`: headless end-to-end run against the dev server
- `npm run eval -- <transcript.txt>`, then `npm run score`: judge validation against hand labels in `validation/`

## Architecture rules
- **Causality is the core invariant.** `Monitor.process()` only analyses segments whose end is ≤ the playhead and
  ≤ `readyUntil()`. Never let a detector read ahead of `procTime`. Lyric mode may *transcribe* ahead; it must not
  *analyse* ahead.
- Answers are judged in `closeExchange()`, which runs when a different (non-executive) speaker takes the floor or the
  call ends, never mid-answer.
- Keys live only in server routes (`lib/server/openai.ts`, `import "server-only"`). The browser calls `/api/*`.
  Every paid route calls `guard()` (key present + optional `ACCESS_CODE`).
- Request bodies must stay under Vercel's 4.5 MB: audio goes up as ~60–80 s 16 kHz mono WAV chunks plus ≤ 4 short
  voice references.
- The headline verdict is derived deterministically by `verdictFromAsks()` (lib/lexicon.ts) from per-ask statuses.
  Change that function, not the prompt, to change how verdicts are counted.
- Every pattern lives in `lib/patterns.ts` (label, GIF, rule text, caveat). The Rulebook UI renders it, so keep the
  rule text in sync with the code.
- Vocal baselines are per speaker. Anything that might merge two people into one speaker id (speaker naming,
  `updateSpeaker`) also corrupts pitch and pace flags.

## Conventions
- No new runtime dependencies without a reason. The app uses plain CSS (app/globals.css, design tokens on `:root`).
- `samples/` (practice audio) and `.replay-cache/` are gitignored. Never commit audio or keys.
- Thresholds are documented in README.md and patterns.ts. Update both when you tune one.
