# 🐾 Whisker Watch: a real-time earnings call monitor

Whisker Watch replays an earnings call at real speed. Captions roll like song lyrics, in sync with the voice. When the
call does something worth noticing, **a cat reacts**: a dodged question gets the side-eye cat, a long silence gets the
loading cat, a clean answer gets the vibing cat. Each cat comes with a card of evidence (the question, the exact quote,
the numbers) and 👍/👎 buttons, so a person stays the judge.

> **Design idea.** Each pattern is tied to one fixed cat. After a few minutes the audience can read the call from the
> cat alone, and the evidence card explains why the cat appeared. Good answers get a cat too, so the tool doesn't
> assume management is guilty.

## What it measures

| Cat | Signal | How it's measured | Track |
|---|---|---|---|
| Side-eye cat | **Non-answer** | When an answer ends (another speaker starts), the analyst's question is split into the items they asked for. An LLM judge rates each item *answered / partial / not answered / declined*. The headline verdict comes from a fixed rule: the core ask decides, and side asks can only lower it to *partial*. | text |
| Side-eye (alt) | **Partial answer** | Same check; some items answered, some not. | text |
| Sliding-away cat | **Deflection** | The judge finds the answer pivoted from the specific ask to something broader. Pivot phrases ("longer term", "as I said") are highlighted as evidence. | text |
| Head-tilt cat | **Declined with a reason** | Explicit refusal plus a reason ("we don't guide to that"). *Not* counted as evasion; a human decides. | text |
| Vibing cat | **Direct answer** | The core ask was answered, with the number when a number was asked for. | text |
| Loading cat | **Long pause** | Measured on the waveform: silence between the question and the answer's first voiced sound. Fires *during* the silence once it reaches ≥ 2.5 s and ≥ 2× this call's typical hand-off. | audio |
| Startled cat | **Vocal shift** | Each sentence's median pitch (autocorrelation) and pace (words/s), compared with the **same speaker's** earlier sentences: robust z ≥ 2.5 *and* a change of ≥ 12% (pitch) or ≥ 20% (pace). | audio |
| Paw-poke cat | **Hedging burst** | Hedge words in a rolling 80-word window: ≥ 4 hedges and ≥ 2× the speaker's own baseline rate. | text |
| "Huh?" cat | **Analyst pushes back** | "Just to clarify…", "I was asking…". The analyst's own verdict on the previous answer, used as an outside check on the non-answer flag. | text |
| Crying / happy cat | **Tone swing** | Finance tone dictionary (Loughran–McDonald style) per management turn, vs. the call's running average. | text |
| Typing cat | **Q&A begins** | The operator opens the line. Prepared remarks before it set each speaker's baseline. | text |

The **Rulebook** button in the app shows this table, the caveats, and every cat.

### Live, honestly
- **Nothing is judged early.** The engine is driven by the playhead. A sentence is analysed only after it has been
  heard, and an answer is judged only when someone else starts talking.
- **Two caption modes.**
  - *Lyric sync* (default): speech-to-text runs about a minute ahead, like a broadcast caption buffer, so the lyrics
    match the voice. The detectors still see only what has played.
  - *Strict live*: a chunk is transcribed only after it has played, as on a real live call. Captions trail by
    20–40 s.
- Every flag records both *where in the call* the evidence is (`t`) and *when it was raised* (`firedAt`). The feed shows
  the lag ("flagged 4 s later").

## How it works

```
 browser                                                       server (Vercel functions; key stays here)
 ───────                                                       ─────────────────────────────────────────
 MP3 ─► decode to 16 kHz mono (Web Audio) ─► energy, silences, pitch (all in-browser, no API)
          │
          └─► ~60 s WAV chunks, cut at quiet moments ─────────► /api/transcribe   gpt-4o-transcribe-diarize
                 + 2–10 s voice clips of known speakers             (speaker labels stay consistent across chunks)
                                                          ◄────  segments {speaker, start, end, text}
              speaker roster (who is operator/exec/analyst) ───► /api/speakers    LLM maps labels → named people
 playhead ─► engine (lib/engine.ts)
               ├ turn tracking → Q&A exchanges
               ├ question closes ───────────────────────────────► /api/question    asks checklist
               ├ answer closes ─────────────────────────────────► /api/judge       per-ask verdict + quote
               ├ rules: hedges, pushback, tone, pause, pitch, pace (local)
               └ call ends / "End & summarize" ─────────────────► /api/summary     narrative
 UI: lyrics · question card · cat stage · meters · flag feed · timeline · summary
```

Without an API key the app still works on **transcripts** (paste or drop a `.txt`). It then uses a rules-only judge.

## Run it locally

```bash
npm install
cp .env.example .env.local      # put your OPENAI_API_KEY in it
npm run dev                     # http://localhost:3000
```

Drop an MP3/M4A/WAV of an earnings call on the page and press ▶ (or space). Click the timeline or any line to jump.
Click a flag's time to replay that moment. **⏹ End & summarize** works at any point, which is handy for demos on part
of a call.

> If your shell already exports an `OPENAI_API_KEY`, Next.js will use that one and **not** the value in `.env.local`.
> Unset it first: `env -u OPENAI_API_KEY npm run dev`.

Transcript format for the text track: one turn per line or paragraph, as `Name -- Role: text`, `Name: text`, or
Motley Fool style (`Name -- Role` header lines followed by paragraphs).

## Deploy (Vercel)

1. Push this repo to a **private** GitHub repo. On vercel.com: Add New → Project → Import → Deploy.
2. Project → Settings → Environment Variables:
   - `OPENAI_API_KEY`: required for audio.
   - `ACCESS_CODE`: recommended. The URL is public, and with this set the app asks for the code before any paid call.
   - `OPENAI_MODEL` (optional): defaults to `gpt-5.4-mini`.
3. Set a monthly spending limit in the OpenAI console.

Audio is never uploaded whole. The browser decodes it and sends ~2 MB WAV chunks, so Vercel's 4.5 MB request limit
never applies. Transcriptions are cached in the browser (IndexedDB), so replaying a practice call costs nothing extra.

## How I checked it

- `npm run eval -- samples/<call>/transcript.txt` replays a transcript through the same engine and judge. It writes
  `validation/<call>_exchanges.csv` with one row per analyst question: the tool's verdict, the rules-only verdict, the
  per-item breakdown, and empty `my_label` / `my_note` columns.
- Fill in `my_label` (`answered` / `partial` / `non_answer` / `declined`), then run `npm run score`. It prints agreement,
  non-answer precision/recall and a confusion matrix.
- In the app, every flag has 👍 fair / 👎 misfire and a note. The summary shows your agreement rate per pattern and
  exports Markdown/JSON. Votes are remembered per file, so a rerun keeps them.
- **Results.** I hand-labelled all 49 analyst questions across the three practice calls, then compared:

  | Judge | Agrees with my label |
  |---|---|
  | LLM judge (what the app uses) | **43/49 (88%)** |
  | Rules-only judge (no API) | 17/49 (35%) |

  - **All 6 disagreements are the same kind:** the tool said *answered* where I said *partial*. The judge leans
    lenient: it never called an answer evasive that I thought was fine.
  - **Non-answers:** it caught both of the ones I found, with no false alarms. That is only 2 cases, so it is a
    small sample.
  - **What the rules miss:** the rules-only judge cannot tell a real explanation from on-topic filler, which is why
    the app uses the LLM judge with the rules as a fallback.
- `npm run replay -- <audio> <start> <length> [speed]` runs the full audio pipeline headless and prints speakers,
  exchanges, verdicts and events. I used it to tune thresholds.

Practice calls (not committed; audio is large and copyrighted): Chipotle Q3 2025 (guidance cut, stock −18%), Fiserv Q3
2026 (turnaround) and Apple FY26 Q4 (record quarter). Audio is from podcast feeds of the original calls; transcripts are
from fool.com.

## Known limitations

- **Speaker identity is the weak link.** If two executives get merged (same diarization label, no names said yet), one
  baseline mixes two voices. That person's pitch then looks "shifted" when the other one talks. The pitch rule ignores
  jumps beyond −30%/+45% (almost always a different person), but smaller merges slip through. It is better when playback
  starts at the beginning of the call, because the prepared remarks introduce everyone.
- **Pitch on phone audio is approximate.** Octave errors and line noise happen, so pitch is a hint, not evidence.
- **The judge sees text, not slides.** "As we showed on slide 12" can look like a non-answer.
- **Hedge words are also normal guidance language.** "We expect" is not evasion, which is why hedging is compared with
  the speaker's own rate.
- **Policy refusals are a grey zone.** "We don't comment on the roadmap" can reasonably be called *declined* or *not
  answered*. The judge sometimes picks the latter.
- Lyric-sync mode needs about 20–30 s after loading before the first captions are ready.

## Files

```
app/api/*            server routes (transcribe, speakers, question, judge, summary, health)
lib/engine.ts        the monitor: scheduler, causal processing, detectors, events, rule judge
lib/audio.ts         decoding, energy, silence, chunk planning, WAV encoding, pitch
lib/lexicon.ts       hedge / tone / pivot / refusal / push-back word lists, verdict rule
lib/patterns.ts      the rulebook: pattern → cat → rule → caveat
components/*         UI
scripts/*            headless replay, validation export, scoring
public/memes/        cat GIFs (+ credits.json with sources)
```

Cat GIFs come from Giphy/Tenor and are credited in `public/memes/credits.json`. Built with Claude Code.
