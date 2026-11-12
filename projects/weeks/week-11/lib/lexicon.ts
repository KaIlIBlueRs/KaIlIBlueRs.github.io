// Dictionaries and phrase lists used by the rule-based detectors.
// Kept deliberately small and readable. Each list is something a person can audit.

import type { Span } from "./types";

const HEDGES = [
  // modal / probability
  "may", "might", "could", "possibly", "perhaps", "probably", "maybe", "likely", "unlikely",
  "potentially", "hopefully", "presumably", "arguably", "tentatively", "conceivably",
  // approximators
  "roughly", "approximately", "somewhat", "fairly", "relatively", "generally", "largely",
  "more or less", "give or take", "ballpark", "sort of", "kind of", "a little bit", "a bit",
  "to some extent", "to some degree", "in some ways", "in a sense", "so to speak",
  // epistemic stance
  "i think", "we think", "i believe", "we believe", "we feel", "i feel", "i guess", "i suppose",
  "it seems", "seems to", "appears to", "it appears", "we assume", "assuming", "we'd hope", "we hope",
  "not sure", "not certain", "uncertain", "unclear", "it depends", "depending on", "if anything",
  // too-early family
  "it's early", "it is early", "too early", "early days", "hard to say", "difficult to say",
  "tough to say", "hard to predict", "difficult to predict", "hard to know", "we'll see", "time will tell",
  "remains to be seen", "subject to",
];

// Finance tone words, in the spirit of the Loughran–McDonald dictionary (a hand-picked subset).
const NEGATIVE = [
  "decline", "declined", "declines", "declining", "decrease", "decreased", "decreases", "loss", "losses",
  "weak", "weaker", "weakness", "weakening", "softness", "softer", "headwind", "headwinds", "challenging",
  "challenge", "challenges", "difficult", "difficulty", "pressure", "pressured", "pressures", "slowdown",
  "slower", "slowing", "drop", "dropped", "miss", "missed", "shortfall", "delay", "delays", "delayed",
  "disappoint", "disappointing", "disappointed", "adverse", "adversely", "unfavorable", "deteriorate",
  "deteriorated", "deteriorating", "deterioration", "impairment", "restructuring", "layoffs", "downturn",
  "volatile", "volatility", "concern", "concerns", "concerned", "problem", "problems", "negative", "negatively",
  "unfortunately", "tough", "hurt", "erosion", "contraction", "compressed", "compression", "write-down",
  "writedown", "litigation", "recall", "shortage", "shortages", "disruption", "disruptions", "constrained",
  "worse", "worsened", "worsening", "lost", "lower", "cut", "cuts", "underperform", "underperformed",
];

const POSITIVE = [
  "strong", "stronger", "strongest", "strength", "record", "growth", "grew", "growing", "improve", "improved",
  "improvement", "improvements", "improving", "exceeded", "exceed", "exceeds", "outperform", "outperformed",
  "robust", "healthy", "momentum", "accelerate", "accelerated", "accelerating", "acceleration", "expand",
  "expanded", "expanding", "expansion", "gain", "gains", "gained", "success", "successful", "successfully",
  "excellent", "great", "pleased", "proud", "excited", "exciting", "confident", "confidence", "opportunity",
  "opportunities", "tailwind", "tailwinds", "best", "solid", "favorable", "positive", "positively", "upside",
  "beat", "achieve", "achieved", "milestone", "delivered", "outstanding", "terrific", "fantastic", "thrilled",
];

// Moves from the specific to the general. Shown as evidence; the judge decides.
const DEFLECT = [
  "long term", "long-term", "longer term", "longer-term", "over time", "big picture", "bigger picture",
  "step back", "stepping back", "more broadly", "broadly speaking", "what i would say", "what i'd say",
  "the way i'd think about", "the way i would think about", "the way we think about", "as i said",
  "as we said", "as we've said", "as i mentioned", "as we mentioned", "as mentioned", "i'd point you",
  "focus on what we can control", "remain confident", "we're very confident", "we are very confident",
  "remain committed", "the fundamentals", "multi-year", "multiyear", "our strategy", "at the end of the day",
];

// Explicit refusals — the difference between "declined" and "evaded".
const REFUSAL = [
  "we don't guide", "we do not guide", "not going to guide", "not going to give", "not going to provide",
  "won't provide", "will not provide", "won't comment", "not going to comment", "don't comment",
  "do not comment", "can't comment", "cannot comment", "not in a position to", "don't break out",
  "do not break out", "don't disclose", "do not disclose", "not disclosing", "we don't provide",
  "we do not provide", "premature", "we'll share more", "we will share more", "more to come",
  "at a later date", "investor day", "on the next call", "not going to get into", "won't get into",
  "don't want to get ahead", "not going to speculate", "won't speculate", "wouldn't want to speculate",
  "not going to parse", "don't want to give", "not something we disclose", "not prepared to",
  "don't make any comment", "don't make any comments", "do not make any comment", "don't talk about future",
  "not going to talk about", "won't talk about", "can't talk about", "cannot talk about", "can't share", "cannot share",
  "not going to share", "won't share", "we'll update you", "we will update you", "next call",
];

// Strong push-back by an analyst: the analyst's own signal that the last answer fell short.
export const PUSHBACK = [
  "just to clarify", "to clarify", "just to be clear", "to be clear", "i was asking", "i was more asking",
  "i was really asking", "my question was", "the question was more", "let me ask it", "ask it differently",
  "ask it another way", "asking it another way", "didn't answer", "did not answer", "did you say",
  "just to make sure", "make sure i understood", "make sure i understand", "so does that mean",
  "so that means", "so is it fair to say", "so are you saying", "are you saying", "i want to come back to",
  "going back to my", "go back to my", "push back", "push a little", "press you", "pin you down",
  "any more color", "any color at all", "even directionally", "even a range",
];

export const QA_START = [
  "question-and-answer", "question and answer", "q&a", "q and a", "first question", "open the line",
  "open up the line", "open the call", "open up the call", "open it up for questions", "take your questions",
  "begin the question", "open the floor", "open it up to questions", "open up for questions",
];

export const WANTS_NUMBER = [
  "how much", "how many", "what percent", "what percentage", "what's the number", "the number", "quantify",
  "size", "sizing", "magnitude", "range", "guide", "guidance", "margin", "margins", "growth rate", "run rate",
  "run-rate", "how big", "basis points", "bps", "dollars", "ballpark", "numbers", "what level", "how large",
  "percentage", "%", "outlook for", "expectation for", "expectations for", "split", "mix",
];

const NUMBER_WORDS =
  "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|half|doubled?|tripled?";

const NUMBER_RE = new RegExp(
  String.raw`(\$\s?\d[\d,.]*\s*(?:million|billion|trillion|[mbk])?\b)|(\b\d[\d,]*(?:\.\d+)?\s*(?:%|percent|basis points|bps|bp|x|times|million|billion|thousand)?)|(\b(?:low|mid|high)[- ](?:single|double|teens|twenties|thirties)[- ]?(?:digits?)?)|(\bdouble[- ]digits?\b)|(\b(?:${NUMBER_WORDS})\b(?:[- ](?:percent|basis points|million|billion|hundred))?)`,
  "gi",
);

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseRe(list: string[]) {
  const sorted = [...list].sort((a, b) => b.length - a.length).map(escapeRe);
  // \b doesn't work next to "%" or "&"; use lookarounds on letters instead
  return new RegExp(`(?<![a-z'])(?:${sorted.join("|")})(?![a-z'])`, "gi");
}

const HEDGE_RE = phraseRe(HEDGES);
const NEG_RE = phraseRe(NEGATIVE);
const POS_RE = phraseRe(POSITIVE);
const DEFLECT_RE = phraseRe(DEFLECT);
const REFUSAL_RE = phraseRe(REFUSAL);
const PUSHBACK_RE = phraseRe(PUSHBACK);
const QA_RE = phraseRe(QA_START);
const WANTS_RE = phraseRe(WANTS_NUMBER);

function collect(text: string, re: RegExp, kind: Span["kind"], out: Span[]) {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].trim().length === 0) {
      re.lastIndex++;
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length, kind });
  }
}

/** Annotate a sentence with every lexicon hit. Overlaps are resolved by priority. */
export function annotate(text: string): Span[] {
  const raw: Span[] = [];
  collect(text, REFUSAL_RE, "refusal", raw);
  collect(text, DEFLECT_RE, "deflect", raw);
  collect(text, HEDGE_RE, "hedge", raw);
  collect(text, NUMBER_RE, "number", raw);
  collect(text, NEG_RE, "neg", raw);
  collect(text, POS_RE, "pos", raw);
  // keep earlier-listed kinds when spans overlap
  const order: Span["kind"][] = ["refusal", "deflect", "hedge", "number", "neg", "pos"];
  raw.sort((a, b) => a.start - b.start || order.indexOf(a.kind) - order.indexOf(b.kind));
  const out: Span[] = [];
  for (const s of raw) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) {
      if (order.indexOf(s.kind) < order.indexOf(last.kind)) out[out.length - 1] = s;
      continue;
    }
    out.push(s);
  }
  return out;
}

export const countWords = (t: string) => (t.match(/[A-Za-z0-9$%'][^\s]*/g) || []).length;

export const hasPushback = (t: string) => {
  PUSHBACK_RE.lastIndex = 0;
  const m = PUSHBACK_RE.exec(t);
  return m ? m[0] : null;
};
export const isQaStart = (t: string) => {
  QA_RE.lastIndex = 0;
  return QA_RE.test(t);
};
export const wantsNumber = (t: string) => {
  WANTS_RE.lastIndex = 0;
  return WANTS_RE.test(t);
};
export const countKind = (spans: Span[], kind: Span["kind"]) => spans.filter((s) => s.kind === kind).length;

/** Split a question into its separate asks — used by the rule-based fallback judge. */
export function splitAsks(q: string): string[] {
  const parts = q
    .split(/(?<=\?)\s+|\b(?:and then|secondly|second question|my follow-up|as a follow-up|and also|separately)\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  const qs = parts.filter((p) => /\?|how|what|why|when|where|could you|can you|any color|talk about/i.test(p));
  return (qs.length ? qs : [q]).slice(0, 4);
}

/**
 * Deterministic verdict from per-ask statuses (shared by the LLM judge route and the rule judge),
 * so the headline call is auditable: the core ask decides, side asks can only downgrade to "partial".
 */
export function verdictFromAsks(asks: { status?: string; primary?: boolean }[]): "answered" | "partial" | "non_answer" | "declined" {
  if (!asks.length) return "partial";
  const primary = asks.find((a) => a.primary) ?? asks[0];
  const st = asks.map((a) => a.status);
  const answered = st.filter((s) => s === "answered").length;
  if (primary.status === "declined") return st.some((s) => s === "answered") ? "partial" : "declined";
  if (primary.status === "answered") return answered >= Math.ceil(asks.length / 2) ? "answered" : "partial";
  if (primary.status === "not_answered" && !st.some((s) => s === "answered" || s === "partial"))
    return st.some((s) => s === "declined") ? "declined" : "non_answer";
  return "partial";
}
