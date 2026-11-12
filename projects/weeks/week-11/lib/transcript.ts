// Transcript-only track: turns a pasted/uploaded transcript into timed segments,
// replayed at a natural speaking pace (no audio, so vocal detectors stay off).

import { annotate, countWords } from "./lexicon";
import type { Role, Segment, Speaker } from "./types";

const EXEC_COLORS = ["#ffb454", "#ff7a90", "#f7d154", "#ff9a5c", "#e8a2ff", "#ffcf99"];
const ANALYST_COLORS = ["#5cc8ff", "#7cf0c0", "#9aa8ff", "#58e1e8", "#b8f27c", "#84b6ff", "#c5a3ff"];

export const WPS = 2.6; // ≈156 words per minute

function roleOf(name: string, label: string): Role {
  const l = `${name} ${label}`.toLowerCase();
  if (/operator|moderator|conference/.test(l)) return "operator";
  if (/analyst|research|capital|securities|partners|bank|sachs|morgan|jpmorgan|barclays|ubs|citi|evercore|bernstein|jefferies|cowen|wells fargo|baird|stifel|oppenheimer|mizuho|bmo|rbc|td |deutsche|raymond james|piper|keybanc|wolfe|truist|guggenheim|needham|macquarie|hsbc|redburn|loop capital|melius|bofa|merrill|nomura|credit suisse|bernstein|cantor|william blair|kbw|susquehanna/.test(l))
    return "analyst";
  return "executive";
}

interface Turn {
  name: string;
  label: string;
  text: string;
}

/** Accepts "Name -- Role: text", "Name: text", or Motley-Fool style "Name -- Role" header lines followed by paragraphs. */
export function parseTranscript(raw: string): Turn[] {
  const lines = raw.replace(/\r/g, "").split("\n");
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  const inline = /^([A-Z][\w.'’ -]{1,60}?)(?:\s+--\s+([^:]{1,80}))?:\s+(.+)$/;
  const header = /^([A-Z][\w.'’ -]{1,60}?)(?:\s+--\s+(.{1,80}))?$/;
  for (const line0 of lines) {
    const line = line0.trim();
    if (!line) continue;
    const m = line.match(inline);
    if (m && m[1].split(" ").length <= 6) {
      cur = { name: m[1].trim(), label: (m[2] || "").trim(), text: m[3].trim() };
      turns.push(cur);
      continue;
    }
    const h = line.match(header);
    if (h && (h[2] || /^operator$/i.test(h[1])) && line.length < 100 && !/[.?!]$/.test(line)) {
      cur = { name: h[1].trim(), label: (h[2] || "").trim(), text: "" };
      turns.push(cur);
      continue;
    }
    if (cur) cur.text += (cur.text ? " " : "") + line;
    else turns.push((cur = { name: "Speaker", label: "", text: line }));
  }
  return turns.filter((t) => t.text.trim());
}

export function buildScript(raw: string) {
  const turns = parseTranscript(raw);
  const speakers = new Map<string, Speaker>();
  let e = 0;
  let a = 0;
  const segments: Segment[] = [];
  let t = 1;
  let n = 0;
  for (const turn of turns) {
    let sp = speakers.get(turn.name);
    if (!sp) {
      const role = roleOf(turn.name, turn.label);
      const org = turn.label.replace(/^analyst\s*[,–-]?\s*/i, "").trim() || undefined;
      sp = {
        id: `S${speakers.size + 1}`,
        name: turn.name,
        role,
        org,
        color: role === "executive" ? EXEC_COLORS[e++ % EXEC_COLORS.length] : role === "analyst" ? ANALYST_COLORS[a++ % ANALYST_COLORS.length] : "#9aa3b2",
      };
      speakers.set(turn.name, sp);
    }
    const sentences = turn.text.split(/(?<=[.?!])\s+(?=[A-Z"'(\d$])/);
    for (const text of sentences) {
      const words = countWords(text);
      const dur = Math.max(0.8, words / WPS);
      segments.push({ id: `t${++n}`, chunk: 0, start: t, end: t + dur, text, speakerId: sp.id, words, spans: annotate(text) });
      t += dur + 0.25;
    }
    t += 0.9;
  }
  return { speakers: [...speakers.values()], segments, duration: t + 1 };
}
