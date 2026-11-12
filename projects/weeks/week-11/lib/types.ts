// Shared types for the monitor engine, the UI and the API routes.

export type Role = "operator" | "executive" | "analyst" | "unknown";

export interface Speaker {
  id: string; // stable id, e.g. "S3"
  name: string; // "Jane Doe" or "Analyst (Morgan Stanley)" when the name is unknown
  role: Role;
  org?: string; // firm for analysts, title for executives
  color: string;
}

export interface Span {
  start: number; // char offset in segment text
  end: number;
  kind: "hedge" | "number" | "pos" | "neg" | "deflect" | "refusal";
}

export interface Segment {
  id: string;
  chunk: number;
  start: number; // seconds in the call
  end: number;
  text: string;
  speakerId: string | null;
  words: number;
  spans: Span[];
  // vocal features (filled in from the decoded audio when the segment is reached)
  f0?: number | null; // median pitch in Hz of voiced frames
  voicedRatio?: number;
  wps?: number; // words per second
}

export type EventType =
  | "nonanswer"
  | "partial"
  | "deflect"
  | "decline"
  | "direct"
  | "pause"
  | "hedge"
  | "vocal"
  | "followup"
  | "negative"
  | "positive"
  | "qa_start"
  | "call_end";

export interface MonitorEvent {
  id: string;
  type: EventType;
  t: number; // where in the call the evidence is (seconds) — the jump target
  firedAt: number; // playhead position when the flag was raised (shows detection lag)
  speakerId?: string | null;
  exchangeId?: string;
  title: string;
  detail: string;
  quote?: string;
  question?: string;
  metrics?: Record<string, string | number>;
  source: "rule" | "llm" | "audio";
  confidence?: number;
  feedback?: { vote: "agree" | "disagree"; note?: string };
}

export interface Ask {
  item: string; // what the analyst asked for, short
  wantsNumber: boolean;
  primary?: boolean; // the core of the question
  status?: "answered" | "partial" | "not_answered" | "declined";
  evidence?: string;
}

export type Verdict = "answered" | "partial" | "non_answer" | "declined";

export interface Judgment {
  verdict: Verdict;
  asks: Ask[];
  deflection: boolean;
  deflectedTo?: string;
  quote: string;
  rationale: string;
  confidence: number;
  source: "llm" | "rule";
  modelVerdict?: Verdict; // what the model said overall, before the deterministic rule
}

export interface Exchange {
  id: string;
  analystId: string;
  parentId?: string; // set for a follow-up within the same analyst slot
  qSegIds: string[];
  aSegIds: string[];
  status: "asking" | "answering" | "closed";
  qStart: number;
  qEnd: number;
  aStart?: number;
  aEnd?: number;
  asks?: Ask[];
  asksPending?: boolean;
  judgePending?: boolean;
  judgment?: Judgment;
  ruleJudgment?: Judgment;
  pauseBefore?: number;
}

export interface ChunkPlan {
  index: number;
  start: number;
  end: number;
  state: "idle" | "pending" | "transcribed" | "resolved" | "error";
  error?: string;
  attempts: number;
}

export interface RosterEntry {
  id: string;
  name: string;
  role: Role;
  org?: string;
}

// API payloads
export interface TranscribeResponse {
  segments: { speaker: string; start: number; end: number; text: string }[];
}

export interface SpeakersRequest {
  roster: RosterEntry[];
  context: { speaker: string; text: string }[];
  segments: { i: number; label: string; text: string }[];
  voiceMatched: string[]; // roster ids that were passed as voice references for this chunk
}

export interface SpeakersResponse {
  assignments: { i: number; speaker: string }[]; // roster id or a key of `newSpeakers`
  newSpeakers: { key: string; name: string; role: Role; org: string }[];
  updates: { id: string; name: string; role: Role; org: string }[];
}
