// The rulebook: every pattern the monitor can flag, the fixed cat that reacts to it,
// and the plain-language rule behind it. The UI's "Rulebook" drawer renders this table,
// so what the audience sees is exactly what the code does.

import type { EventType } from "./types";

export interface Pattern {
  type: EventType;
  label: string; // short name shown on cards
  cat: string; // what the cat does — the "translation"
  gif: string;
  tone: "alert" | "caution" | "info" | "good";
  priority: number; // higher pops first / is never dropped from the cat queue
  rule: string; // how it is detected
  caveat: string; // why it might be wrong
}

const g = (k: string) => `/memes/${k}.gif`;

export const PATTERNS: Record<EventType, Pattern> = {
  nonanswer: {
    type: "nonanswer",
    label: "Non-answer",
    cat: "Side-eye cat looks away",
    gif: g("nonanswer"),
    tone: "alert",
    priority: 10,
    rule:
      "When an answer ends (someone else starts talking), the analyst's question is broken into the specific things asked for. A judge model checks each one against the answer. Flagged when none of them was answered and no reason was given.",
    caveat: "The number may have been given earlier in the call, or in a later answer.",
  },
  partial: {
    type: "partial",
    label: "Partial answer",
    cat: "Cat answers half, then glances away",
    gif: g("nonanswer_alt"),
    tone: "caution",
    priority: 7,
    rule: "Same check as a non-answer, but at least one of the things asked for was answered and at least one wasn't.",
    caveat: "Analysts often stack 2–3 questions; skipping one can be time pressure, not evasion.",
  },
  deflect: {
    type: "deflect",
    label: "Deflection",
    cat: "Cat slides out of frame",
    gif: g("deflect"),
    tone: "alert",
    priority: 9,
    rule:
      "The judge model finds that the answer moved from the specific, near-term thing asked about to a broader topic (long-term vision, strategy talk, a different metric). Pivot phrases like “longer term” or “what I'd say is” are highlighted as supporting evidence.",
    caveat: "Some context-setting is normal before a direct answer; check whether the answer comes back.",
  },
  decline: {
    type: "decline",
    label: "Declined, with a reason",
    cat: "Head-tilt cat: you decide",
    gif: g("decline"),
    tone: "info",
    priority: 6,
    rule:
      "Management explicitly says it won't or can't give the information (“we don't guide to that”, “not going to disclose”) and gives a reason. Not counted as evasion. A human should judge whether the reason holds up.",
    caveat: "A stated policy can still be a convenient shield.",
  },
  direct: {
    type: "direct",
    label: "Direct answer",
    cat: "Vibing cat nods along",
    gif: g("direct"),
    tone: "good",
    priority: 3,
    rule: "Every item the analyst asked for was answered. When numbers were requested, the answer contains them.",
    caveat: "A direct answer can still be spin. This only checks that the question got answered.",
  },
  pause: {
    type: "pause",
    label: "Long pause",
    cat: "Loading cat…",
    gif: g("pause"),
    tone: "caution",
    priority: 5,
    rule:
      "Measured from the audio waveform: the silence between the end of the question and the first voiced sound of the answer. Flagged when it is ≥ 2.5 s and at least twice this call's typical hand-off gap.",
    caveat: "Phone line delays, muting/unmuting and deciding who answers all add silence.",
  },
  hedge: {
    type: "hedge",
    label: "Hedging burst",
    cat: "Cautious cat pokes with one paw",
    gif: g("hedge"),
    tone: "caution",
    priority: 4,
    rule:
      "Hedge words (“may”, “we think”, “it's early”, “kind of”…) are counted in a rolling 80-word window of the current speaker. Flagged when there are ≥ 4 and the rate is at least double that speaker's own baseline so far.",
    caveat: "“We expect” is also normal guidance language. The baseline comparison is there to soften that.",
  },
  vocal: {
    type: "vocal",
    label: "Vocal shift",
    cat: "Startled cat",
    gif: g("vocal"),
    tone: "caution",
    priority: 5,
    rule:
      "Each sentence's median pitch (autocorrelation on the waveform) and speech rate (words/second) are compared with the same speaker's earlier sentences. Flagged when the robust z-score is ≥ 2.5 (median/MAD) AND the change is big enough to hear: ≥ 12% in pitch or ≥ 20% in pace, after ≥ 6 sentences of baseline. Jumps beyond −30%/+45% in pitch are ignored as probably a different person.",
    caveat: "Excitement, reading a list of numbers, or a bad phone line all shift voice. A change is not a lie.",
  },
  followup: {
    type: "followup",
    label: "Analyst pushes back",
    cat: "“Huh?” cat",
    gif: g("followup"),
    tone: "caution",
    priority: 8,
    rule:
      "The analyst comes back with “just to clarify”, “to follow up”, “I was asking about”… This is the analyst's own verdict that the previous answer fell short. It works as an outside check on the non-answer flag.",
    caveat: "Many follow-ups are a planned second question, not dissatisfaction.",
  },
  negative: {
    type: "negative",
    label: "Tone turns negative",
    cat: "Crying cat",
    gif: g("negative"),
    tone: "caution",
    priority: 4,
    rule:
      "Finance tone dictionary (Loughran–McDonald style) on each management turn: flagged when negative words dominate and net tone drops well below this call's running average for management.",
    caveat: "Words like “decline” or “loss” can describe a competitor, or last year.",
  },
  positive: {
    type: "positive",
    label: "Upbeat turn",
    cat: "Happy-happy-happy cat",
    gif: g("positive"),
    tone: "good",
    priority: 2,
    rule: "Same dictionary: flagged when a management turn is strongly positive relative to the call's running average.",
    caveat: "Prepared remarks are written to sound upbeat. The running average absorbs some of that.",
  },
  qa_start: {
    type: "qa_start",
    label: "Q&A begins",
    cat: "Typing cat gets ready",
    gif: g("qa_start"),
    tone: "info",
    priority: 6,
    rule: "The operator opens the line for questions (“question-and-answer session”, “first question comes from”).",
    caveat: "—",
  },
  call_end: {
    type: "call_end",
    label: "Call ended",
    cat: "Cool cat signs off",
    gif: g("call_end"),
    tone: "info",
    priority: 1,
    rule: "The recording ended. Any open answer is judged and the summary is built.",
    caveat: "—",
  },
};

export const IDLE_GIF = g("idle");

export const TONE_COLORS: Record<Pattern["tone"], string> = {
  alert: "var(--alert)",
  caution: "var(--caution)",
  info: "var(--info)",
  good: "var(--good)",
};
