"use client";
// Small shared presentational pieces.
import type { ReactNode } from "react";
import { PATTERNS, TONE_COLORS } from "@/lib/patterns";
import type { EventType, Span } from "@/lib/types";

export const toneColor = (t: EventType) => TONE_COLORS[PATTERNS[t].tone];

/** Render text with lexicon highlights (hedges, numbers, pivots, refusals). */
export function Highlighted({ text, spans }: { text: string; spans: Span[] }) {
  const out: ReactNode[] = [];
  let i = 0;
  for (const s of spans) {
    if (s.kind === "pos" || s.kind === "neg") continue;
    if (s.start < i) continue;
    if (s.start > i) out.push(text.slice(i, s.start));
    out.push(
      <span key={s.start} className={`hl-${s.kind}`}>
        {text.slice(s.start, s.end)}
      </span>,
    );
    i = s.end;
  }
  if (i < text.length) out.push(text.slice(i));
  return <>{out}</>;
}

export function VerdictBadge({ verdict }: { verdict: string }) {
  const map: Record<string, [string, string]> = {
    answered: ["Answered", "var(--good)"],
    partial: ["Partial", "var(--caution)"],
    non_answer: ["Not answered", "var(--alert)"],
    declined: ["Declined", "var(--info)"],
  };
  const [label, color] = map[verdict] ?? [verdict, "var(--muted)"];
  return (
    <span className="verdict" style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
      {label}
    </span>
  );
}

export const ASK_ICON: Record<string, string> = {
  answered: "✓",
  partial: "◐",
  not_answered: "✗",
  declined: "⊘",
};

export function download(name: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
