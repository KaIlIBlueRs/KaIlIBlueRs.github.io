"use client";
import { fmtTime, type Monitor } from "@/lib/engine";
import { PATTERNS } from "@/lib/patterns";
import type { EventType } from "@/lib/types";
import { ASK_ICON, VerdictBadge, download, toneColor } from "./bits";

// ───────────────────────── rulebook ─────────────────────────
export function RulebookSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2>📖 The rulebook</h2>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted" style={{ maxWidth: "75ch" }}>
          Each pattern has exactly one cat, so after a few minutes you can read the call from the cat alone. The cat only
          says &ldquo;look here&rdquo;. The card under it shows the evidence, and you are the judge: every flag has
          👍/👎. A flag is a signal, not proof that anyone is lying.
        </p>
        <table className="grid" style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th style={{ width: 80 }}>Cat</th>
              <th style={{ width: 170 }}>Pattern</th>
              <th>How it's detected</th>
              <th style={{ width: 230 }}>Why it might be wrong</th>
            </tr>
          </thead>
          <tbody>
            {Object.values(PATTERNS).map((p) => (
              <tr key={p.type} className="rule-row">
                <td>
                  <img src={p.gif} alt={p.cat} />
                </td>
                <td>
                  <b style={{ color: toneColor(p.type) }}>{p.label}</b>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {p.cat}
                  </div>
                </td>
                <td style={{ fontSize: 13 }}>{p.rule}</td>
                <td className="muted" style={{ fontSize: 12.5 }}>
                  {p.caveat}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Design choices</h3>
        <ul className="muted" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
          <li>
            <b>Nothing is judged early.</b> A sentence is analysed only after it has been heard, and an answer is judged
            only once someone else starts talking.
          </li>
          <li>
            <b>Everyone is compared with themselves.</b> Pitch, pace and hedging are measured against each speaker's own
            earlier sentences. The scripted prepared remarks give that baseline; flags start in the Q&amp;A.
          </li>
          <li>
            <b>Declining isn&apos;t dodging.</b> &ldquo;We don&apos;t guide to that, because…&rdquo; gets the head-tilt
            cat (you decide), not the side-eye.
          </li>
          <li>
            <b>Good answers get a cat too.</b> If the tool only ever flagged problems, it would assume management is
            guilty.
          </li>
          <li>
            <b>The analyst is a second judge.</b> When an analyst pushes back (&ldquo;just to clarify…&rdquo;), that
            independently confirms the previous answer fell short.
          </li>
        </ul>
      </div>
    </div>
  );
}

// ───────────────────────── summary ─────────────────────────
export function SummarySheet({ m, onClose, jump }: { m: Monitor; onClose: () => void; jump: (t: number) => void }) {
  const judged = m.exchanges.filter((e) => e.judgment);
  const count = (v: string) => judged.filter((e) => e.judgment!.verdict === v).length;
  const events = m.events.filter((e) => e.type !== "call_end" && e.type !== "qa_start");
  const byType = new Map<EventType, number>();
  for (const e of events) byType.set(e.type, (byType.get(e.type) || 0) + 1);
  const voted = events.filter((e) => e.feedback);
  const agree = voted.filter((e) => e.feedback!.vote === "agree").length;
  const llmVsRules = judged.filter((e) => e.judgment!.source === "llm" && e.ruleJudgment);
  const agreeRules = llmVsRules.filter((e) => e.ruleJudgment!.verdict === e.judgment!.verdict).length;
  const pushed = judged.filter((e) => (e as any).pushedBack);

  const tiles: { k: string; n: number; gif: string }[] = [
    { k: "answered directly", n: count("answered"), gif: PATTERNS.direct.gif },
    { k: "partly answered", n: count("partial"), gif: PATTERNS.partial.gif },
    { k: "not answered", n: count("non_answer"), gif: PATTERNS.nonanswer.gif },
    { k: "declined w/ reason", n: count("declined"), gif: PATTERNS.decline.gif },
  ];

  function markdown() {
    const lines = [
      `# ${m.title}: earnings call monitor report`,
      ``,
      `Monitored ${fmtTime(m.playhead)} · ${judged.length} questions judged · ${events.length} flags`,
      ``,
      `## Summary`,
      m.summary || "(pending)",
      ``,
      `## Questions`,
      `| Time | Analyst | Asked for | Verdict | Why |`,
      `|---|---|---|---|---|`,
      ...judged.map(
        (e) =>
          `| ${fmtTime(e.qStart)} | ${m.speaker(e.analystId)?.name ?? ""} | ${(e.judgment!.asks || []).map((a) => `${ASK_ICON[a.status ?? ""] ?? ""} ${a.item}`).join("; ")} | ${e.judgment!.verdict} | ${e.judgment!.rationale.replace(/\|/g, "/")} |`,
      ),
      ``,
      `## Timestamped events`,
      ...events.map(
        (e) =>
          `- **${fmtTime(e.t)}** ${PATTERNS[e.type].label}: ${e.title}. ${e.detail}${e.feedback ? ` _(reviewer: ${e.feedback.vote}${e.feedback.note ? ` · ${e.feedback.note}` : ""})_` : ""}`,
      ),
      ``,
      `## Validation`,
      `- Reviewer agreed with ${agree}/${voted.length} reviewed flags.`,
      `- LLM judge and rule judge agreed on ${agreeRules}/${llmVsRules.length} answers.`,
    ];
    return lines.join("\n");
  }

  function json() {
    return JSON.stringify(
      {
        title: m.title,
        monitored_sec: Math.round(m.playhead),
        speakers: [...m.speakers.values()],
        exchanges: judged.map((e) => ({
          t: Math.round(e.qStart),
          analyst: m.speaker(e.analystId)?.name,
          question: m.questionText(e),
          judgment: e.judgment,
          rule_verdict: e.ruleJudgment?.verdict,
          pause_before_s: e.pauseBefore,
          analyst_pushed_back: !!(e as any).pushedBack,
        })),
        events: events.map((e) => ({ ...e })),
        summary: m.summary,
      },
      null,
      2,
    );
  }

  const fname = m.title.replace(/[^\w]+/g, "_").slice(0, 40);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <img src={PATTERNS.call_end.gif} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: "cover" }} />
          <div>
            <h2>Call summary</h2>
            <div className="muted" style={{ fontSize: 13 }}>
              {m.title} · monitored {fmtTime(m.playhead)} · {judged.length} questions judged · {events.length} flags
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => download(`${fname}_report.md`, markdown(), "text/markdown")}>
            ⬇ Markdown
          </button>
          <button className="btn" onClick={() => download(`${fname}_session.json`, json(), "application/json")}>
            ⬇ JSON
          </button>
          <button className="btn" onClick={onClose}>
            Back to call
          </button>
        </div>

        <div className="tiles">
          {tiles.map((t) => (
            <div className="tile" key={t.k}>
              <img src={t.gif} alt="" />
              <div>
                <div className="n">{t.n}</div>
                <div className="k">{t.k}</div>
              </div>
            </div>
          ))}
        </div>

        <h3>What happened</h3>
        <div className="narrative">
          {m.summary ?? (
            <span className="muted">
              <span className="spinner" /> writing the summary…
            </span>
          )}
        </div>

        {judged.length > 0 && (
          <>
            <h3>Question by question</h3>
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Time</th>
                  <th style={{ width: 150 }}>Analyst</th>
                  <th>What was asked → what happened</th>
                  <th style={{ width: 110 }}>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {judged.map((e) => (
                  <tr key={e.id} className="click" onClick={() => jump(e.qStart)}>
                    <td className="mono">{fmtTime(e.qStart)}</td>
                    <td>
                      {m.speaker(e.analystId)?.name}
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {m.speaker(e.analystId)?.org}
                        {e.parentId ? " · follow-up" : ""}
                      </div>
                    </td>
                    <td>
                      {(e.judgment!.asks || []).map((a, i) => (
                        <div key={i} style={{ fontSize: 12.5 }}>
                          <span className="mono">{ASK_ICON[a.status ?? ""] ?? "·"}</span> {a.item}
                          {a.evidence && <span className="muted"> · {a.evidence}</span>}
                        </div>
                      ))}
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        {e.judgment!.rationale}
                        {(e as any).pushedBack && <span style={{ color: "var(--caution)" }}> · analyst pushed back afterwards</span>}
                        {e.pauseBefore !== undefined && e.pauseBefore >= 2.5 && <span> · {e.pauseBefore.toFixed(1)} s pause first</span>}
                      </div>
                    </td>
                    <td>
                      <VerdictBadge verdict={e.judgment!.verdict} />
                      {e.ruleJudgment && e.judgment!.source === "llm" && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                          rules: {e.ruleJudgment.verdict.replace("_", " ")}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h3>Timeline of flags</h3>
        <table className="grid">
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="click" onClick={() => jump(e.t)}>
                <td className="mono" style={{ width: 60 }}>
                  {fmtTime(e.t)}
                </td>
                <td style={{ width: 150, color: toneColor(e.type), fontWeight: 600, fontSize: 12.5 }}>{PATTERNS[e.type].label}</td>
                <td style={{ fontSize: 13 }}>
                  <b>{e.title}</b> <span className="muted">· {e.detail}</span>
                </td>
                <td style={{ width: 90, fontSize: 12 }}>
                  {e.feedback ? (e.feedback.vote === "agree" ? "👍 fair" : "👎 misfire") : <span className="muted">-</span>}
                </td>
              </tr>
            ))}
            {!events.length && (
              <tr>
                <td className="muted">No flags.</td>
              </tr>
            )}
          </tbody>
        </table>

        <h3>How do we know it works?</h3>
        <div className="tiles">
          <div className="tile" style={{ gridTemplateColumns: "1fr" }}>
            <div>
              <div className="n">
                {voted.length ? `${Math.round((agree / voted.length) * 100)}%` : "-"}
              </div>
              <div className="k">
                you agreed with {agree}/{voted.length} reviewed flags
              </div>
            </div>
          </div>
          <div className="tile" style={{ gridTemplateColumns: "1fr" }}>
            <div>
              <div className="n">{llmVsRules.length ? `${agreeRules}/${llmVsRules.length}` : "-"}</div>
              <div className="k">LLM judge vs. simple rules agree</div>
            </div>
          </div>
          <div className="tile" style={{ gridTemplateColumns: "1fr" }}>
            <div>
              <div className="n">
                {pushed.length ? `${pushed.filter((e) => e.judgment!.verdict !== "answered").length}/${pushed.length}` : "-"}
              </div>
              <div className="k">answers the analyst pushed back on that we had flagged</div>
            </div>
          </div>
        </div>
        {voted.length > 0 && (
          <table className="grid" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Pattern</th>
                <th>Flags</th>
                <th>Reviewed</th>
                <th>👍 fair</th>
                <th>Precision (your call)</th>
              </tr>
            </thead>
            <tbody>
              {[...byType.entries()].map(([t, n]) => {
                const v = events.filter((e) => e.type === t && e.feedback);
                const a = v.filter((e) => e.feedback!.vote === "agree").length;
                return (
                  <tr key={t}>
                    <td style={{ color: toneColor(t) }}>{PATTERNS[t].label}</td>
                    <td className="mono">{n}</td>
                    <td className="mono">{v.length}</td>
                    <td className="mono">{a}</td>
                    <td className="mono">{v.length ? `${Math.round((a / v.length) * 100)}%` : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
