// The monitor engine. It is driven by a playhead (the audio element's currentTime, or a
// virtual clock in transcript mode) and only ever analyses what the playhead has passed.
//
//  - Transcription runs in chunks. In "lyric" mode it runs a little ahead of the playhead
//    so captions can be shown in sync, the way a broadcast caption buffer works. In "strict" mode
//    a chunk is sent only after it has been played, so captions lag but nothing is known early.
//  - Detectors in both modes see a sentence only once the playhead has reached its end.
//    A non-answer is judged only once the next speaker starts.

import {
  annotate,
  countKind,
  countWords,
  hasPushback,
  isQaStart,
  splitAsks,
  verdictFromAsks,
  wantsNumber,
} from "./lexicon";
import { PATTERNS } from "./patterns";
import {
  encodeWav,
  longestSilence,
  pitchStats,
  planChunks,
  silenceUpTo,
  type AudioData,
} from "./audio";
import type {
  Ask,
  ChunkPlan,
  EventType,
  Exchange,
  Judgment,
  MonitorEvent,
  Role,
  RosterEntry,
  Segment,
  Speaker,
  SpeakersRequest,
  SpeakersResponse,
  TranscribeResponse,
} from "./types";

export interface JudgeRequest {
  analyst: string;
  question: string;
  asks: Ask[] | null;
  answer: { speaker: string; text: string }[];
  earlier: string; // short recap of earlier answers so "as I said" can be checked
}

export interface SummaryRequest {
  title: string;
  durationSec: number;
  speakers: RosterEntry[];
  exchanges: {
    t: number;
    analyst: string;
    question: string;
    verdict: string;
    rationale: string;
  }[];
  events: { t: number; type: string; title: string; detail: string }[];
}

export interface Api {
  transcribe(chunk: Blob, refs: { name: string; audio: Blob }[]): Promise<TranscribeResponse>;
  speakers(req: SpeakersRequest): Promise<SpeakersResponse>;
  question(q: { analyst: string; question: string }): Promise<{ asks: Ask[] }>;
  judge(req: JudgeRequest): Promise<Judgment>;
  summary(req: SummaryRequest): Promise<{ summary: string }>;
}

export interface MonitorOptions {
  title: string;
  api: Api | null; // null = rules only (no key / offline)
  audio?: AudioData;
  live: "lyric" | "strict";
  // transcript mode: pre-built segments + speakers
  script?: { speakers: Speaker[]; segments: Segment[]; duration: number };
}

const EXEC_COLORS = ["#ffb454", "#ff7a90", "#f7d154", "#ff9a5c", "#e8a2ff", "#ffcf99"];
const ANALYST_COLORS = ["#5cc8ff", "#7cf0c0", "#9aa8ff", "#58e1e8", "#b8f27c", "#84b6ff", "#c5a3ff"];
const OTHER_COLOR = "#9aa3b2";

const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mad = (a: number[], m: number) => median(a.map((x) => Math.abs(x - m)));
const robustZ = (x: number, hist: number[]) => {
  const m = median(hist);
  const d = mad(hist, m) * 1.4826;
  return d > 1e-9 ? (x - m) / d : 0;
};
const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
};
export const fmtTime = fmt;

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Split long diarized segments into sentence-sized lines (timed by character share) for lyric display. */
export function splitIntoLines(start: number, end: number, text: string, maxDur = 9): { start: number; end: number; text: string }[] {
  const dur = end - start;
  if (dur <= maxDur) return [{ start, end, text: text.trim() }];
  const sentences = text.trim().split(/(?<=[.?!])\s+(?=[A-Z"'(\d$])/);
  const pieces: string[] = [];
  for (const s of sentences) {
    const prev = pieces[pieces.length - 1];
    if (prev && countWords(prev) < 5) pieces[pieces.length - 1] = prev + " " + s;
    else pieces.push(s);
  }
  // break very long sentences at commas
  const target = Math.max(12, Math.round((countWords(text) / dur) * maxDur));
  const fine: string[] = [];
  for (const p of pieces) {
    if (countWords(p) <= target * 1.6) {
      fine.push(p);
      continue;
    }
    const clauses = p.split(/(?<=[,;:])\s+/);
    let cur = "";
    for (const c of clauses) {
      if (cur && countWords(cur) + countWords(c) > target) {
        fine.push(cur);
        cur = c;
      } else cur = cur ? cur + " " + c : c;
    }
    if (cur) fine.push(cur);
  }
  const total = fine.reduce((a, p) => a + p.length, 0) || 1;
  let t = start;
  return fine.map((p) => {
    const d = (p.length / total) * dur;
    const out = { start: t, end: t + d, text: p };
    t += d;
    return out;
  });
}

/** Diarization splits crosstalk into tiny fragments; glue a speaker's fragments back together. */
export function mergeFragments<T extends { speaker: string; start: number; end: number; text: string }>(raw: T[]): T[] {
  const out: T[] = [];
  for (const r of raw) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.speaker === r.speaker &&
      r.start - prev.end < 0.4 &&
      (prev.end - prev.start < 1.2 || countWords(prev.text) <= 2 || countWords(r.text) <= 2)
    ) {
      out[out.length - 1] = { ...prev, end: Math.max(prev.end, r.end), text: `${prev.text} ${r.text}`.trim() };
    } else out.push({ ...r });
  }
  return out;
}

export const isGenericName = (n: string) =>
  !n || /[()]/.test(n) || /^(speaker|analyst|executive|operator|unknown|management|participant)\b/i.test(n.trim());

const isBackchannel = (s: Segment) => s.words <= 3 && s.end - s.start < 1.6;

interface Turn {
  speakerId: string;
  segIds: string[];
  start: number;
  hedgeFired: boolean;
}

export class Monitor {
  readonly title: string;
  readonly duration: number;
  readonly audio?: AudioData;
  readonly live: "lyric" | "strict";
  api: Api | null;

  speakers = new Map<string, Speaker>();
  segments: Segment[] = []; // sorted by start
  chunks: ChunkPlan[] = [];
  exchanges: Exchange[] = [];
  events: MonitorEvent[] = [];
  catQueue: MonitorEvent[] = [];
  log: string[] = [];

  playhead = 0;
  procTime = 0; // analysis frontier: everything before it has been processed
  qaStarted = false;
  ended = false;
  summary: string | null = null;
  summaryPending = false;
  version = 0;

  private listeners = new Set<() => void>();
  private segCursor = 0; // index of the next segment whose *entry* hasn't been processed
  private doneCursor = 0; // index of the next segment whose *completion* hasn't been processed
  private turn: Turn | null = null;
  private openEx: Exchange | null = null;
  private idn = 0;
  private refs = new Map<string, Blob>(); // voice reference clips by roster id
  private handoffGaps: number[] = [];
  private execTones: number[] = [];
  private lastFired = new Map<string, number>();
  private resolving = false;
  private inFlight = 0;
  private speakerSeq = 0;
  private colorIdx = { exec: 0, analyst: 0 };
  private pauseFiredFor: string | null = null;
  // vocal/hedge baselines per speaker
  private base = new Map<string, { f0: number[]; wps: number[]; words: number; hedges: number }>();

  constructor(opts: MonitorOptions) {
    this.title = opts.title;
    this.api = opts.api;
    this.audio = opts.audio;
    this.live = opts.live;
    if (opts.script) {
      this.duration = opts.script.duration;
      for (const sp of opts.script.speakers) this.speakers.set(sp.id, sp);
      this.segments = opts.script.segments;
      this.chunks = [{ index: 0, start: 0, end: this.duration, state: "resolved", attempts: 0 }];
    } else if (opts.audio) {
      this.duration = opts.audio.duration;
      const plan = opts.live === "strict" ? planChunks(opts.audio, 20, 5) : planChunks(opts.audio, 60, 12);
      this.chunks = plan.map((c, i) => ({ index: i, ...c, state: "idle", attempts: 0 }));
    } else {
      throw new Error("Monitor needs audio or a script");
    }
  }

  // ───────────────────────── subscription ─────────────────────────
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }
  private id(p: string) {
    return `${p}${++this.idn}`;
  }
  private note(msg: string) {
    this.log.push(`[${fmt(this.playhead)}] ${msg}`);
    if (this.log.length > 200) this.log.shift();
  }

  // ───────────────────────── main loop ─────────────────────────
  /** Call ~10×/s with the current playhead. */
  tick(playhead: number) {
    const prev = this.playhead;
    this.playhead = playhead;
    if (this.audio) this.schedule();
    let changed = this.process();
    if (this.audio) changed = this.livePause() || changed;
    if (changed || Math.abs(playhead - prev) > 0.2) this.emit();
  }

  /** Jump: forward jumps past untranscribed audio skip that stretch (nothing is analysed there). */
  seek(t: number) {
    if (t > this.procTime + 2) {
      const ready = this.readyUntil();
      if (t > ready) {
        const c = this.chunkAt(t);
        if (c && c.start > this.procTime) {
          this.note(`Jumped ahead; skipping ${fmt(this.procTime)}–${fmt(c.start)}`);
          this.abandonOpen();
          this.procTime = c.start;
          while (this.segCursor < this.segments.length && this.segments[this.segCursor].start < this.procTime)
            this.segCursor++;
          this.doneCursor = Math.max(this.doneCursor, this.segCursor);
        }
      }
    }
    this.tick(t);
  }

  // ───────────────────────── transcription scheduler ─────────────────────────
  private chunkAt(t: number) {
    return this.chunks.find((c) => t >= c.start && t < c.end) ?? this.chunks[this.chunks.length - 1];
  }

  private readyUntil() {
    let c = this.chunkAt(this.procTime);
    if (!c) return this.procTime;
    let t = this.procTime;
    // a chunk that failed for good is skipped (a gap), so analysis doesn't stall behind it
    while (c && (c.state === "resolved" || (c.state === "error" && c.attempts >= 3))) {
      t = c.end;
      c = this.chunks[c.index + 1];
    }
    return t;
  }

  private schedule() {
    if (!this.api || !this.audio) return;
    const maxInFlight = 2;
    const from = this.chunkAt(this.procTime);
    if (!from) return;
    for (let i = from.index; i < this.chunks.length && this.inFlight < maxInFlight; i++) {
      const c = this.chunks[i];
      const want =
        this.live === "lyric"
          ? c.start <= this.playhead + 130 // keep ~2 chunks ahead
          : c.end <= this.playhead + 0.05; // strict: only audio that has been heard
      if (!want) break;
      if (c.state === "idle" || (c.state === "error" && c.attempts < 3 && !(c as any)._retryAt) ) {
        this.transcribeChunk(c);
      } else if (c.state === "error" && c.attempts < 3 && Date.now() > (c as any)._retryAt) {
        this.transcribeChunk(c);
      }
    }
  }

  private async transcribeChunk(c: ChunkPlan) {
    if (!this.api || !this.audio) return;
    c.state = "pending";
    c.attempts++;
    this.inFlight++;
    this.emit();
    try {
      const wav = encodeWav(this.audio, c.start, c.end);
      const refs = this.pickRefs();
      const res = await this.api.transcribe(wav, refs);
      (c as any)._raw = mergeFragments(res.segments.map((s) => ({
        ...s,
        start: s.start + c.start,
        end: s.end + c.start,
        speaker: refs.some((r) => r.name === s.speaker) ? s.speaker : `c${c.index}:${s.speaker ?? "?"}`,
      })));
      (c as any)._refNames = refs.map((r) => r.name);
      c.state = "transcribed";
      c.error = undefined;
    } catch (e: any) {
      c.state = "error";
      c.error = String(e?.message || e);
      (c as any)._retryAt = Date.now() + 2000 * c.attempts;
      this.note(`Chunk ${c.index + 1} failed: ${c.error}`);
    } finally {
      this.inFlight--;
      this.emit();
      this.resolveNext();
    }
  }

  /** Name speakers chunk by chunk, in order (each chunk's roster depends on the last). */
  private async resolveNext() {
    if (this.resolving) return;
    const c = this.chunks.find((ch) => ch.state === "transcribed");
    if (!c) return;
    const prev = this.chunks[c.index - 1];
    if (prev && (prev.state === "pending" || prev.state === "transcribed")) return; // wait for order
    this.resolving = true;
    try {
      await this.resolveChunk(c);
    } catch (e: any) {
      this.note(`Speaker naming failed for chunk ${c.index + 1}: ${e?.message || e}`);
      this.resolveHeuristic(c);
    } finally {
      this.resolving = false;
      this.emit();
      this.resolveNext();
    }
  }

  private roster(): RosterEntry[] {
    return [...this.speakers.values()].map((s) => ({ id: s.id, name: s.name, role: s.role, org: s.org }));
  }

  private newSpeaker(name: string, role: Role, org?: string): Speaker {
    const id = `S${++this.speakerSeq}`;
    const color =
      role === "executive"
        ? EXEC_COLORS[this.colorIdx.exec++ % EXEC_COLORS.length]
        : role === "analyst"
          ? ANALYST_COLORS[this.colorIdx.analyst++ % ANALYST_COLORS.length]
          : OTHER_COLOR;
    const sp: Speaker = { id, name, role, org, color };
    this.speakers.set(id, sp);
    return sp;
  }

  private updateSpeaker(id: string, name: string, role: Role, org?: string) {
    const sp = this.speakers.get(id);
    if (!sp) return;
    // never turn one named person into another (that would merge two people's voice baselines)
    const first = (n: string) => n.trim().split(/\s+/)[0]?.toLowerCase();
    if (name && !isGenericName(sp.name) && !isGenericName(name) && first(name) !== first(sp.name)) return;
    const roleChanged = sp.role !== role && role !== "unknown";
    if (name && (isGenericName(sp.name) || name.length > sp.name.length)) sp.name = name;
    sp.org = org || sp.org;
    if (roleChanged) {
      sp.role = role;
      sp.color =
        role === "executive"
          ? EXEC_COLORS[this.colorIdx.exec++ % EXEC_COLORS.length]
          : role === "analyst"
            ? ANALYST_COLORS[this.colorIdx.analyst++ % ANALYST_COLORS.length]
            : OTHER_COLOR;
    }
  }

  private async resolveChunk(c: ChunkPlan) {
    const raw: { speaker: string; start: number; end: number; text: string }[] = ((c as any)._raw || []).filter(
      (s: any) => s.text && s.text.trim(),
    );
    const voiceMatched: string[] = (c as any)._refNames || [];
    let assign: Map<number, string>;
    if (this.api) {
      const context = this.segments
        .filter((s) => s.end <= c.start + 0.01)
        .slice(-10)
        .map((s) => {
          const sp = s.speakerId ? this.speakers.get(s.speakerId) : null;
          return { speaker: sp ? `${sp.id} (${sp.name}, ${sp.role})` : "?", text: truncate(s.text, 220) };
        });
      const res = await this.api.speakers({
        roster: this.roster(),
        context,
        segments: raw.map((s, i) => ({ i, label: s.speaker, text: truncate(s.text, 400) })),
        voiceMatched,
      });
      for (const u of res.updates || []) this.updateSpeaker(u.id, u.name, u.role, u.org);
      const keyToId = new Map<string, string>();
      for (const n of res.newSpeakers || []) {
        const existing = [...this.speakers.values()].find(
          (s) => s.name.toLowerCase() === n.name.toLowerCase() && n.name && !/^(unknown|speaker)/i.test(n.name),
        );
        keyToId.set(n.key, existing ? existing.id : this.newSpeaker(n.name, n.role, n.org).id);
      }
      assign = new Map();
      for (const a of res.assignments || []) {
        const id = this.speakers.has(a.speaker) ? a.speaker : keyToId.get(a.speaker);
        if (id) assign.set(a.i, id);
      }
      // anything unassigned: follow the diarization label of a neighbour with the same label
      const labelTo = new Map<string, string>();
      raw.forEach((s, i) => {
        const id = assign.get(i);
        if (id) labelTo.set(s.speaker, id);
      });
      raw.forEach((s, i) => {
        if (!assign.has(i)) {
          const id = labelTo.get(s.speaker) ?? (this.speakers.has(s.speaker) ? s.speaker : null);
          if (id) assign.set(i, id);
        }
      });
    } else {
      assign = this.heuristicAssign(raw);
    }
    this.addSegments(c, raw, assign);
  }

  private resolveHeuristic(c: ChunkPlan) {
    const raw = ((c as any)._raw || []) as { speaker: string; start: number; end: number; text: string }[];
    this.addSegments(c, raw, this.heuristicAssign(raw));
  }

  /** No-LLM fallback: one roster entry per diarization label, roles from operator phrases. */
  private heuristicAssign(raw: { speaker: string; text: string }[]) {
    const map = new Map<number, string>();
    const labelTo = new Map<string, string>();
    let nextIsAnalyst: string | null = null;
    raw.forEach((s, i) => {
      let id = this.speakers.has(s.speaker) ? s.speaker : labelTo.get(s.speaker);
      if (!id) {
        const op = /(next|first|following) question|please go ahead|ladies and gentlemen|conference (call|operator)|your line is open/i.test(
          s.text,
        );
        const role: Role = op ? "operator" : nextIsAnalyst ? "analyst" : this.qaStarted ? "executive" : "executive";
        const name = op ? "Operator" : nextIsAnalyst ? nextIsAnalyst : `Speaker ${this.speakerSeq + 1}`;
        id = this.newSpeaker(name, role).id;
        labelTo.set(s.speaker, id);
      }
      const m = s.text.match(/question (?:comes|is coming) from (?:the line of )?([A-Z][a-z]+ [A-Z][a-zA-Z'-]+)/);
      nextIsAnalyst = m ? m[1] : null;
      map.set(i, id);
    });
    return map;
  }

  private addSegments(
    c: ChunkPlan,
    raw: { speaker: string; start: number; end: number; text: string }[],
    assign: Map<number, string>,
  ) {
    const fresh: Segment[] = [];
    raw.forEach((s, i) => {
      const speakerId = assign.get(i) ?? null;
      for (const line of splitIntoLines(Math.max(c.start, s.start), Math.min(c.end + 0.5, s.end), s.text)) {
        fresh.push({
          id: this.id("g"),
          chunk: c.index,
          start: line.start,
          end: Math.max(line.end, line.start + 0.3),
          text: line.text,
          speakerId,
          words: countWords(line.text),
          spans: annotate(line.text),
        });
      }
    });
    // insert keeping order; segments of an already-processed region are dropped (can't rewrite history)
    const keep = fresh.filter((s) => s.start >= this.procTime - 0.01 || c.start >= this.procTime);
    this.segments = [...this.segments, ...keep].sort((a, b) => a.start - b.start);
    // cursors refer to indices: recompute from times
    this.segCursor = this.segments.findIndex((s) => !(s as any)._entered);
    if (this.segCursor < 0) this.segCursor = this.segments.length;
    this.doneCursor = this.segments.findIndex((s) => !(s as any)._done);
    if (this.doneCursor < 0) this.doneCursor = this.segments.length;
    c.state = "resolved";
    this.updateRefs();
  }

  /** Voice references (up to 4: operator + top executives) so later chunks keep the same labels. */
  private pickRefs(): { name: string; audio: Blob }[] {
    const out: { name: string; audio: Blob }[] = [];
    const ids = [...this.refs.keys()];
    for (const id of ids.slice(0, 4)) {
      const b = this.refs.get(id);
      if (b) out.push({ name: id, audio: b });
    }
    return out;
  }

  private updateRefs() {
    if (!this.audio) return;
    const talk = new Map<string, number>();
    for (const s of this.segments) if (s.speakerId) talk.set(s.speakerId, (talk.get(s.speakerId) || 0) + s.end - s.start);
    const candidates = [...this.speakers.values()]
      .filter((s) => s.role === "operator" || s.role === "executive")
      .sort((a, b) => (talk.get(b.id) || 0) - (talk.get(a.id) || 0));
    const op = candidates.find((s) => s.role === "operator");
    const execs = candidates.filter((s) => s.role === "executive" && !isGenericName(s.name)).slice(0, op ? 3 : 4);
    for (const sp of [...(op ? [op] : []), ...execs]) {
      if (this.refs.has(sp.id) || this.refs.size >= 4) continue;
      // a clean 4–8 s stretch of this speaker, away from turn boundaries
      // longest sentence that sits inside one of this speaker's turns (both neighbours are the same speaker)
      const segs = this.segments
        .map((s, i) => ({ s, i }))
        .filter(
          ({ s, i }) =>
            s.speakerId === sp.id &&
            s.end - s.start >= 3 &&
            this.segments[i - 1]?.speakerId === sp.id &&
            this.segments[i + 1]?.speakerId === sp.id,
        )
        .sort((a, b) => b.s.end - b.s.start - (a.s.end - a.s.start));
      if (talk.get(sp.id)! < 20) continue; // need enough speech to be sure who this is
      const pick = segs[0]?.s;
      if (!pick) continue;
      this.refs.set(sp.id, encodeWav(this.audio, pick.start + 0.2, Math.min(pick.end, pick.start + 8)));
    }
  }

  // ───────────────────────── causal processing ─────────────────────────
  private process(): boolean {
    let changed = false;
    const limit = Math.min(this.playhead, this.readyUntil());
    // entries (speaker changes) — at the moment a sentence starts
    while (this.segCursor < this.segments.length) {
      const s = this.segments[this.segCursor];
      if (s.start > limit) break;
      if ((s as any)._entered) {
        this.segCursor++;
        continue;
      }
      (s as any)._entered = true;
      this.onEnter(s);
      this.segCursor++;
      changed = true;
    }
    // completions (content) — once the sentence has been fully heard
    while (this.doneCursor < this.segments.length) {
      const s = this.segments[this.doneCursor];
      if (s.end > limit || !(s as any)._entered) break;
      if (!(s as any)._done) {
        (s as any)._done = true;
        this.onComplete(s);
        changed = true;
      }
      this.doneCursor++;
    }
    if (limit > this.procTime) this.procTime = limit;
    // end of call
    if (!this.ended && this.playhead >= this.duration - 0.25 && this.readyUntil() >= this.duration - 0.25) {
      this.finish();
      changed = true;
    }
    return changed;
  }

  private role(id: string | null): Role {
    return (id && this.speakers.get(id)?.role) || "unknown";
  }

  private onEnter(s: Segment) {
    const sp = s.speakerId;
    if (!sp) return;
    // backchannel ("Got it.", "Okay.", crosstalk) doesn't take the floor
    if (this.turn && this.turn.speakerId !== sp && isBackchannel(s)) {
      (s as any)._backchannel = true;
      return;
    }
    if (!this.turn || this.turn.speakerId !== sp) {
      const prevTurn = this.turn;
      this.turn = { speakerId: sp, segIds: [], start: s.start, hedgeFired: false };
      this.onTurnChange(prevTurn, s);
    }
    this.turn.segIds.push(s.id);
    const ex = this.openEx;
    const r = this.role(sp);
    if (ex) {
      if (r === "analyst" && ex.analystId === sp && ex.status === "asking" && !ex.qSegIds.includes(s.id)) ex.qSegIds.push(s.id);
      if (r === "executive" && ex.status === "answering" && !ex.aSegIds.includes(s.id)) ex.aSegIds.push(s.id);
    }
  }

  private onTurnChange(prev: Turn | null, s: Segment) {
    const sp = s.speakerId!;
    const r = this.role(sp);
    const prevSeg = prev ? this.segById(prev.segIds[prev.segIds.length - 1]) : null;
    // hand-off gap baseline (all speaker changes)
    if (prevSeg && this.audio) {
      const gap = longestSilence(this.audio, prevSeg.end - 0.4, s.start + 0.6).seconds;
      if (prev && this.role(prev.speakerId) === "analyst" && r === "executive") {
        if (this.openEx) this.openEx.pauseBefore = gap;
      } else this.handoffGaps.push(gap);
    }
    if (prev && this.role(prev.speakerId) === "executive") this.onExecTurnEnd(prev);

    const ex = this.openEx;
    if (r === "analyst") {
      if (!this.qaStarted) this.startQa(s.start, false);
      if (ex && ex.status === "answering") {
        this.closeExchange(ex);
        this.openExchange(sp, s, ex.analystId === sp ? ex.parentId ?? ex.id : undefined);
      } else if (ex && ex.status === "asking" && ex.analystId === sp) {
        // same analyst continues
      } else {
        if (ex) this.closeExchange(ex);
        this.openExchange(sp, s);
      }
    } else if (r === "executive") {
      if (ex && ex.status === "asking") {
        ex.status = "answering";
        ex.aStart = s.start;
        const q = this.segById(ex.qSegIds[ex.qSegIds.length - 1]);
        ex.qEnd = q ? q.end : s.start;
        this.parseQuestion(ex);
        this.checkPause(ex);
      }
    } else if (r === "operator") {
      if (ex && ex.status === "answering") this.closeExchange(ex);
    }
  }

  private onComplete(s: Segment) {
    const sp = s.speakerId;
    const r = this.role(sp);
    if (!sp || (s as any)._backchannel) return;
    // operator opens the Q&A
    if (r === "operator" && !this.qaStarted && isQaStart(s.text)) this.startQa(s.start, true);
    // vocal features
    if (this.audio && s.end - s.start >= 1.5) {
      const p = pitchStats(this.audio, s.start, s.end);
      s.f0 = p.f0;
      s.voicedRatio = p.voicedRatio;
      s.wps = s.words / Math.max(0.5, s.end - s.start);
    }
    const b = this.base.get(sp) ?? { f0: [], wps: [], words: 0, hedges: 0 };
    this.base.set(sp, b);
    if (r === "executive") {
      if (this.qaStarted) {
        this.checkVocal(s, b);
        this.checkHedge(s, b);
      }
    }
    if (r === "analyst" && this.qaStarted) this.checkPushback(s);
    // update baselines after checking (a sentence is never compared with itself)
    if (s.f0 && s.end - s.start >= 2.5 && (s.voicedRatio ?? 0) >= 0.3) b.f0.push(s.f0);
    if (s.wps && s.words >= 10 && s.end - s.start >= 4 && s.wps * 60 > 70 && s.wps * 60 < 290) b.wps.push(s.wps);
    b.words += s.words;
    b.hedges += countKind(s.spans, "hedge");
  }

  private segById(id?: string) {
    return id ? this.segments.find((s) => s.id === id) : undefined;
  }

  private startQa(t: number, byOperator: boolean) {
    this.qaStarted = true;
    this.fire({
      type: "qa_start",
      t,
      title: "Q&A begins",
      detail: byOperator
        ? "The operator opened the line. Everything before this was the baseline: scripted remarks."
        : "First analyst on the line. Scripted remarks (if heard) served as the baseline.",
      source: "rule",
    });
  }

  // ───────────────────────── exchanges ─────────────────────────
  private openExchange(analystId: string, s: Segment, parentId?: string) {
    const ex: Exchange = {
      id: this.id("x"),
      analystId,
      parentId,
      qSegIds: [s.id],
      aSegIds: [],
      status: "asking",
      qStart: s.start,
      qEnd: s.end,
    };
    this.exchanges.push(ex);
    this.openEx = ex;
    this.pauseFiredFor = null;
  }

  private abandonOpen() {
    if (this.openEx && this.openEx.status === "answering") this.closeExchange(this.openEx);
    this.openEx = null;
    this.turn = null;
  }

  private text(ids: string[]) {
    return ids
      .map((id) => this.segById(id))
      .filter(Boolean)
      .map((s) => s!.text)
      .join(" ");
  }

  private answerTurns(ex: Exchange) {
    const out: { speaker: string; text: string }[] = [];
    for (const id of ex.aSegIds) {
      const s = this.segById(id);
      if (!s) continue;
      const sp = this.speakers.get(s.speakerId || "");
      const name = sp ? `${sp.name}${sp.org ? ` (${sp.org})` : ""}` : "Management";
      const last = out[out.length - 1];
      if (last && last.speaker === name) last.text += " " + s.text;
      else out.push({ speaker: name, text: s.text });
    }
    return out;
  }

  private analystLabel(id: string) {
    const sp = this.speakers.get(id);
    return sp ? `${sp.name}${sp.org ? `, ${sp.org}` : ""}` : "Analyst";
  }

  private async parseQuestion(ex: Exchange) {
    const q = this.text(ex.qSegIds);
    if (!this.api || countWords(q) < 6) {
      ex.asks = splitAsks(q).map((item) => ({ item: truncate(item, 90), wantsNumber: wantsNumber(item) }));
      return;
    }
    ex.asksPending = true;
    try {
      const r = await this.api.question({ analyst: this.analystLabel(ex.analystId), question: q });
      if (!ex.judgment) ex.asks = r.asks.slice(0, 5);
    } catch {
      ex.asks = splitAsks(q).map((item) => ({ item: truncate(item, 90), wantsNumber: wantsNumber(item) }));
    } finally {
      ex.asksPending = false;
      this.emit();
    }
  }

  private closeExchange(ex: Exchange) {
    if (ex.status === "closed") return;
    const wasAnswering = ex.status === "answering";
    ex.status = "closed";
    if (this.openEx === ex) this.openEx = null;
    if (!wasAnswering || !ex.aSegIds.length) return;
    const last = this.segById(ex.aSegIds[ex.aSegIds.length - 1]);
    ex.aEnd = last ? last.end : this.playhead;
    this.judge(ex);
  }

  private earlierRecap(ex: Exchange) {
    return this.exchanges
      .filter((e) => e !== ex && e.judgment && (e.aEnd ?? 0) <= ex.qStart)
      .slice(-4)
      .map((e) => truncate(this.text(e.aSegIds), 300))
      .join(" | ");
  }

  private async judge(ex: Exchange) {
    const question = this.text(ex.qSegIds);
    const answerTurns = this.answerTurns(ex);
    const answer = answerTurns.map((t) => t.text).join(" ");
    ex.ruleJudgment = ruleJudge(question, answer, ex.asks ?? null);
    let j: Judgment = ex.ruleJudgment;
    if (this.api) {
      ex.judgePending = true;
      this.emit();
      try {
        j = await this.api.judge({
          analyst: this.analystLabel(ex.analystId),
          question,
          asks: ex.asks ?? null,
          answer: answerTurns,
          earlier: this.earlierRecap(ex),
        });
        j.source = "llm";
      } catch (e: any) {
        this.note(`Judge failed, using rules: ${e?.message || e}`);
      }
      ex.judgePending = false;
    }
    ex.judgment = j;
    if (j.asks?.length) ex.asks = j.asks;
    this.fireVerdict(ex, j, question);
    this.emit();
    this.maybeSummarize();
  }

  private fireVerdict(ex: Exchange, j: Judgment, question: string) {
    const analyst = this.analystLabel(ex.analystId);
    const firstAnswerSpeaker = this.segById(ex.aSegIds[0])?.speakerId ?? null;
    const missed = (j.asks || []).filter((a) => a.status !== "answered").map((a) => a.item);
    const answered = (j.asks || []).filter((a) => a.status === "answered").map((a) => a.item);
    const base = {
      t: ex.aStart ?? ex.qStart,
      speakerId: firstAnswerSpeaker,
      exchangeId: ex.id,
      question: truncate(question, 400),
      quote: j.quote,
      source: j.source,
      confidence: j.confidence,
    } as const;
    const map: Record<string, EventType> = {
      non_answer: "nonanswer",
      partial: "partial",
      declined: "decline",
      answered: "direct",
    };
    const type = map[j.verdict] ?? "partial";
    const titles: Record<string, string> = {
      nonanswer: `Didn't answer ${analyst.split(",")[0]}`,
      partial: `Partly answered ${analyst.split(",")[0]}`,
      decline: "Declined, with a reason",
      direct: `Answered ${analyst.split(",")[0]} directly`,
    };
    const detail =
      type === "nonanswer"
        ? `Asked for: ${missed.join("; ") || (j.asks || []).map((a) => a.item).join("; ") || "—"}. ${j.rationale}`
        : type === "partial"
          ? `Answered: ${answered.join("; ") || "—"}. Not answered: ${missed.join("; ") || "—"}. ${j.rationale}`
          : j.rationale;
    this.fire({ ...base, type, title: titles[type], detail });
    if (j.deflection && j.verdict !== "answered") {
      this.fire({
        ...base,
        type: "deflect",
        t: (ex.aStart ?? ex.qStart) + 1,
        title: "Pivoted away from the question",
        detail: j.deflectedTo ? `Moved to: ${j.deflectedTo}` : "Moved to broader ground instead of the specific ask.",
      });
    }
  }

  // ───────────────────────── detectors ─────────────────────────
  private cooldown(key: string, sec: number) {
    const last = this.lastFired.get(key);
    if (last !== undefined && this.playhead - last < sec) return true;
    this.lastFired.set(key, this.playhead);
    return false;
  }

  /** Live: fire the loading cat *during* a long silence after a question. */
  private livePause(): boolean {
    const ex = this.openEx;
    if (!ex || ex.status !== "asking" || !this.audio || this.pauseFiredFor === ex.id) return false;
    const lastQ = this.segById(ex.qSegIds[ex.qSegIds.length - 1]);
    if (!lastQ || !(lastQ as any)._done || this.playhead < lastQ.end) return false;
    // only when the analyst has stopped and nobody has started yet
    const next = this.segments[this.segCursor];
    if (next && next.start <= this.playhead) return false;
    const sil = silenceUpTo(this.audio, this.playhead);
    const thr = this.pauseThreshold();
    if (sil >= thr && this.playhead - lastQ.end < 30) {
      this.pauseFiredFor = ex.id;
      this.fire({
        type: "pause",
        t: this.playhead - sil,
        speakerId: null,
        exchangeId: ex.id,
        title: `Silence after the question… ${sil.toFixed(1)} s`,
        detail: `Nobody has started answering yet. A typical hand-off on this call takes ${this.typicalGap().toFixed(1)} s.`,
        source: "audio",
        metrics: { silence_s: +sil.toFixed(1), typical_s: +this.typicalGap().toFixed(1) },
      });
      return true;
    }
    return false;
  }

  private typicalGap() {
    const m = median(this.handoffGaps.slice(-30));
    return Number.isFinite(m) ? m : 0.8;
  }
  private pauseThreshold() {
    return Math.max(2.5, 2 * this.typicalGap());
  }

  private checkPause(ex: Exchange) {
    if (ex.pauseBefore === undefined) return;
    const gap = ex.pauseBefore;
    const fired = this.events.find((e) => e.type === "pause" && e.exchangeId === ex.id);
    if (fired) {
      // update the live flag with the final length
      fired.title = `Paused ${gap.toFixed(1)} s before answering`;
      fired.metrics = { ...(fired.metrics || {}), silence_s: +gap.toFixed(1) };
      fired.speakerId = this.segById(ex.aSegIds[0])?.speakerId ?? null;
      return;
    }
    if (gap >= this.pauseThreshold()) {
      this.pauseFiredFor = ex.id;
      this.fire({
        type: "pause",
        t: ex.qEnd,
        speakerId: this.segById(ex.aSegIds[0])?.speakerId ?? this.turn?.speakerId ?? null,
        exchangeId: ex.id,
        title: `Paused ${gap.toFixed(1)} s before answering`,
        detail: `Typical hand-off on this call: ${this.typicalGap().toFixed(1)} s.`,
        source: "audio",
        metrics: { silence_s: +gap.toFixed(1), typical_s: +this.typicalGap().toFixed(1) },
      });
    }
  }

  private checkVocal(s: Segment, b: { f0: number[]; wps: number[] }) {
    if (s.end - s.start < 2.5 || s.words < 6) return;
    const out: string[] = [];
    const metrics: Record<string, number> = {};
    // a jump beyond ±60% is almost always a different person or an octave error, not stress
    const ratio = s.f0 ? s.f0 / median(b.f0) : 1;
    if (s.f0 && b.f0.length >= 6 && ratio > 0.7 && ratio < 1.45 && (s.voicedRatio ?? 0) >= 0.3) {
      const z = robustZ(s.f0, b.f0);
      metrics.pitch_hz = Math.round(s.f0);
      metrics.pitch_base_hz = Math.round(median(b.f0));
      metrics.pitch_z = +z.toFixed(1);
      // needs both a robust z ≥ 2.5 and a change listeners would notice (≥ 12%)
      if (Math.abs(z) >= 2.5 && Math.abs(ratio - 1) >= 0.12) out.push(`pitch ${z > 0 ? "up" : "down"} to ${Math.round(s.f0)} Hz (usual ${Math.round(median(b.f0))} Hz)`);
    }
    if (s.wps && b.wps.length >= 6 && s.end - s.start >= 4 && s.words >= 10 && s.wps * 60 > 70 && s.wps * 60 < 290) {
      const z = robustZ(s.wps, b.wps);
      metrics.wpm = Math.round(s.wps * 60);
      metrics.wpm_base = Math.round(median(b.wps) * 60);
      metrics.rate_z = +z.toFixed(1);
      const rr = s.wps / median(b.wps);
      if (Math.abs(z) >= 2.5 && Math.abs(rr - 1) >= 0.2)
        out.push(`speaking ${z > 0 ? "faster" : "slower"}: ${Math.round(s.wps * 60)} wpm (usual ${Math.round(median(b.wps) * 60)})`);
    }
    if (!out.length || this.cooldown(`vocal:${s.speakerId}`, 45)) return;
    const sp = this.speakers.get(s.speakerId!);
    this.fire({
      type: "vocal",
      t: s.start,
      speakerId: s.speakerId,
      exchangeId: this.openEx?.id,
      title: `${sp?.name.split(" ")[0] ?? "Speaker"}'s voice shifted`,
      detail: out.join("; ") + ". Compared with this speaker's own earlier sentences.",
      quote: s.text,
      source: "audio",
      metrics,
    });
  }

  private checkHedge(s: Segment, b: { words: number; hedges: number }) {
    const turn = this.turn;
    if (!turn || turn.hedgeFired || turn.speakerId !== s.speakerId) return;
    // rolling window of the last ~80 words of this turn
    const segs = turn.segIds.map((id) => this.segById(id)).filter((x): x is Segment => !!x && (x as any)._done);
    let words = 0;
    let hedges = 0;
    const hits: string[] = [];
    for (let i = segs.length - 1; i >= 0 && words < 80; i--) {
      words += segs[i].words;
      for (const sp of segs[i].spans)
        if (sp.kind === "hedge") {
          hedges++;
          hits.push(segs[i].text.slice(sp.start, sp.end).toLowerCase());
        }
    }
    if (words < 30) return;
    const rate = (hedges / words) * 100;
    const baseRate = b.words >= 150 ? (b.hedges / b.words) * 100 : 1.5;
    if (hedges >= 4 && rate >= Math.max(2 * baseRate, 4)) {
      turn.hedgeFired = true;
      const sp = this.speakers.get(s.speakerId!);
      this.fire({
        type: "hedge",
        t: s.start,
        speakerId: s.speakerId,
        exchangeId: this.openEx?.id,
        title: `Hedging burst from ${sp?.name.split(" ")[0] ?? "management"}`,
        detail: `${hedges} hedges in the last ${words} words (${rate.toFixed(1)}/100 vs. usual ${baseRate.toFixed(1)}): ${[...new Set(hits.reverse())].slice(0, 6).join(", ")}.`,
        quote: s.text,
        source: "rule",
        metrics: { hedges, words, rate_per100: +rate.toFixed(1), base_per100: +baseRate.toFixed(1) },
      });
    }
  }

  private checkPushback(s: Segment) {
    const ex = this.openEx;
    if (!ex || ex.analystId !== s.speakerId) return;
    const hit = hasPushback(s.text);
    // a push-back only means something if this analyst already got an answer in this slot
    const prior = this.exchanges.filter((e) => e.analystId === s.speakerId && e !== ex && e.aSegIds.length).pop();
    if (!hit || !prior || ex.qSegIds.indexOf(s.id) > 2) return;
    if (this.events.some((e) => e.type === "followup" && e.exchangeId === ex.id)) return;
    (prior as any).pushedBack = true;
    this.fire({
      type: "followup",
      t: s.start,
      speakerId: s.speakerId,
      exchangeId: ex.id,
      title: `${this.analystLabel(s.speakerId!).split(",")[0]} pushes back`,
      detail: `“${hit}”: the analyst signals the previous answer didn't land. Use it as a check on that answer's verdict.`,
      quote: s.text,
      source: "rule",
    });
  }

  private onExecTurnEnd(t: Turn) {
    const segs = t.segIds.map((id) => this.segById(id)).filter((x): x is Segment => !!x);
    const words = segs.reduce((a, s) => a + s.words, 0);
    if (words < 40) return;
    const pos = segs.reduce((a, s) => a + countKind(s.spans, "pos"), 0);
    const neg = segs.reduce((a, s) => a + countKind(s.spans, "neg"), 0);
    const tone = ((pos - neg) / words) * 100;
    const hist = this.execTones.slice();
    this.execTones.push(tone);
    if (!this.qaStarted || hist.length < 3) return;
    const m = hist.reduce((a, x) => a + x, 0) / hist.length;
    const sd = Math.sqrt(hist.reduce((a, x) => a + (x - m) ** 2, 0) / hist.length) || 1;
    const z = (tone - m) / sd;
    const sp = this.speakers.get(t.speakerId);
    const quoteSeg =
      segs
        .map((s) => ({ s, k: countKind(s.spans, z < 0 ? "neg" : "pos") }))
        .sort((a, b) => b.k - a.k)[0]?.s ?? segs[0];
    if (z <= -1.75 && neg >= 3 && tone < 0 && !this.cooldown("negative", 120)) {
      this.fire({
        type: "negative",
        t: quoteSeg.start,
        speakerId: t.speakerId,
        exchangeId: this.openEx?.id,
        title: `Tone turned negative (${sp?.name.split(" ")[0] ?? "management"})`,
        detail: `${neg} negative vs ${pos} positive words; net ${tone.toFixed(1)}/100 vs call average ${m.toFixed(1)}.`,
        quote: quoteSeg.text,
        source: "rule",
        metrics: { pos, neg, net_per100: +tone.toFixed(1), call_avg: +m.toFixed(1) },
      });
    } else if (z >= 1.75 && pos >= 5 && tone > 3 && !this.cooldown("positive", 150)) {
      this.fire({
        type: "positive",
        t: quoteSeg.start,
        speakerId: t.speakerId,
        exchangeId: this.openEx?.id,
        title: `Upbeat moment (${sp?.name.split(" ")[0] ?? "management"})`,
        detail: `${pos} positive vs ${neg} negative words; net ${tone.toFixed(1)}/100 vs call average ${m.toFixed(1)}.`,
        quote: quoteSeg.text,
        source: "rule",
        metrics: { pos, neg, net_per100: +tone.toFixed(1), call_avg: +m.toFixed(1) },
      });
    }
  }

  // ───────────────────────── events & cats ─────────────────────────
  private fire(e: Omit<MonitorEvent, "id" | "firedAt">) {
    const ev: MonitorEvent = { ...e, id: this.id("e"), firedAt: this.playhead };
    this.events.push(ev);
    this.events.sort((a, b) => a.t - b.t);
    // cat queue: one cat at a time; drop low-priority cats when it backs up
    this.catQueue.push(ev);
    this.catQueue.sort((a, b) => PATTERNS[b.type].priority - PATTERNS[a.type].priority);
    if (this.catQueue.length > 3) this.catQueue = this.catQueue.slice(0, 3);
    this.note(`${PATTERNS[ev.type].label}: ${ev.title}`);
    this.emit();
  }

  nextCat(): MonitorEvent | undefined {
    const c = this.catQueue.shift();
    this.emit();
    return c;
  }

  setFeedback(id: string, vote: "agree" | "disagree" | null, note?: string) {
    const e = this.events.find((x) => x.id === id);
    if (!e) return;
    e.feedback = vote ? { vote, note: note ?? e.feedback?.note } : undefined;
    this.emit();
  }

  // ───────────────────────── end of call ─────────────────────────
  /** Called at the end of the recording, or by "End & summarize" during a partial demo. */
  finish() {
    if (this.ended) return;
    this.ended = true;
    if (this.turn && this.role(this.turn.speakerId) === "executive") this.onExecTurnEnd(this.turn);
    if (this.openEx) this.closeExchange(this.openEx);
    this.fire({
      type: "call_end",
      t: this.playhead,
      title: this.playhead >= this.duration - 1 ? "Call ended" : `Stopped at ${fmt(this.playhead)}`,
      detail: "Summary below. Click any event to replay it.",
      source: "rule",
    });
    this.maybeSummarize();
  }

  private maybeSummarize() {
    if (!this.ended || this.summary || this.summaryPending) return;
    if (this.exchanges.some((e) => e.judgePending)) return;
    this.summaryPending = true;
    this.emit();
    const req = this.summaryRequest();
    const fallback = templateSummary(this);
    if (!this.api) {
      this.summary = fallback;
      this.summaryPending = false;
      this.emit();
      return;
    }
    this.api
      .summary(req)
      .then((r) => (this.summary = r.summary || fallback))
      .catch(() => (this.summary = fallback))
      .finally(() => {
        this.summaryPending = false;
        this.emit();
      });
  }

  summaryRequest(): SummaryRequest {
    return {
      title: this.title,
      durationSec: Math.round(this.playhead),
      speakers: this.roster(),
      exchanges: this.exchanges
        .filter((e) => e.judgment)
        .map((e) => ({
          t: Math.round(e.qStart),
          analyst: this.analystLabel(e.analystId),
          question: truncate(this.text(e.qSegIds), 350),
          verdict: e.judgment!.verdict,
          rationale: e.judgment!.rationale,
        })),
      events: this.events
        .filter((e) => e.type !== "call_end")
        .map((e) => ({ t: Math.round(e.t), type: e.type, title: e.title, detail: truncate(e.detail, 200) })),
    };
  }

  // ───────────────────────── views for the UI ─────────────────────────
  speaker(id?: string | null) {
    return id ? this.speakers.get(id) : undefined;
  }
  /** The question card shows the current (or most recent) exchange. */
  currentExchange(): Exchange | undefined {
    // skip stray "thank you" turns that never got an answer
    const real = (e: Exchange) => e.status !== "closed" || e.aSegIds.length > 0 || countWords(this.text(e.qSegIds)) >= 6;
    if (this.openEx && real(this.openEx)) return this.openEx;
    for (let i = this.exchanges.length - 1; i >= 0; i--) if (real(this.exchanges[i])) return this.exchanges[i];
    return undefined;
  }
  questionText(ex: Exchange) {
    return this.text(ex.qSegIds);
  }
  coverage() {
    return this.chunks.map((c) => ({ start: c.start, end: c.end, state: c.state }));
  }
  liveSilence() {
    return this.audio ? silenceUpTo(this.audio, this.playhead) : 0;
  }
  baselineOf(id?: string | null) {
    const b = id ? this.base.get(id) : undefined;
    if (!b) return null;
    return {
      f0: median(b.f0),
      wpm: median(b.wps) * 60,
      hedgeRate: b.words ? (b.hedges / b.words) * 100 : NaN,
      n: b.f0.length,
    };
  }
}

// ───────────────────────── rule-based judge (fallback + second opinion) ─────────────────────────
// re-export so the judge route can share the rule
export { verdictFromAsks };

const STOP = new Set(
  "about above after again against also among and any are because been before being below between both but can could did does doing down during each few from further have having here how into its itself just more most other our ours out over own same should some such than that the their theirs them then there these they this those through under until very was were what when where which while who whom why will with would you your yours guys maybe kind sort think thanks thank question questions really just quarter year going sure".split(
    " ",
  ),
);
const stems = (t: string) =>
  new Set(
    (t.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []).filter((w) => !STOP.has(w)).map((w) => w.slice(0, 5)),
  );

export function ruleJudge(question: string, answer: string, asks: Ask[] | null): Judgment {
  const items: Ask[] = (asks && asks.length
    ? asks
    : splitAsks(question).map((item) => ({ item, wantsNumber: wantsNumber(item) }))
  ).map((a) => ({ ...a }));
  const spans = annotate(answer);
  const nums = countKind(spans, "number");
  const refusal = countKind(spans, "refusal");
  const deflect = countKind(spans, "deflect");
  const aStems = stems(answer);
  let numBudget = nums;
  for (const a of items) {
    const overlap = [...stems(a.item)].filter((s) => aStems.has(s)).length;
    if (a.wantsNumber) {
      if (numBudget > 0 && overlap >= 1) {
        a.status = "answered";
        numBudget--;
      } else if (refusal) a.status = "declined";
      else a.status = overlap >= 2 ? "partial" : "not_answered";
    } else {
      a.status = overlap >= 2 && countWords(answer) >= 30 ? "answered" : refusal ? "declined" : overlap >= 1 ? "partial" : "not_answered";
    }
  }
  if (!items.some((a) => a.primary) && items[0]) items[0].primary = true;
  let verdict = verdictFromAsks(items);
  if (verdict === "non_answer" && refusal) verdict = "declined";
  const sentences = answer.split(/(?<=[.?!])\s+/);
  const quote =
    sentences
      .map((s) => ({ s, k: annotate(s).filter((x) => x.kind === "deflect" || x.kind === "refusal" || x.kind === "hedge").length }))
      .sort((a, b) => b.k - a.k)[0]?.s ?? sentences[0] ?? "";
  return {
    verdict,
    asks: items,
    deflection: deflect >= 2 && verdict !== "answered",
    deflectedTo: undefined,
    quote: truncate(quote, 220),
    rationale: `Rules: ${nums} number(s), ${refusal} refusal phrase(s), ${deflect} pivot phrase(s) in the answer.`,
    confidence: 0.4,
    source: "rule",
  };
}

export function templateSummary(m: Monitor): string {
  const judged = m.exchanges.filter((e) => e.judgment);
  const count = (v: string) => judged.filter((e) => e.judgment!.verdict === v).length;
  const lines = [
    `${m.title}: monitored ${fmt(m.playhead)} of audio, ${judged.length} analyst question(s) judged.`,
    `Answered directly: ${count("answered")}, partly: ${count("partial")}, not answered: ${count("non_answer")}, declined with a reason: ${count("declined")}.`,
  ];
  const by = new Map<string, number>();
  for (const e of m.events) by.set(e.type, (by.get(e.type) || 0) + 1);
  const other = ["pause", "hedge", "vocal", "followup", "negative", "positive"]
    .filter((t) => by.get(t))
    .map((t) => `${PATTERNS[t as EventType].label.toLowerCase()} ×${by.get(t)}`);
  if (other.length) lines.push(`Other signals: ${other.join(", ")}.`);
  return lines.join(" ");
}
