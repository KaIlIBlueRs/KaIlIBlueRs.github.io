// Validation helper: replays a transcript through the same engine + judge the app uses
// (transcript track, so no audio signals) and writes one CSV row per analyst question.
// You then fill in `my_label` by hand and run `npm run score` to compare the tool's calls against yours.
//
// Usage: npx tsx scripts/eval-transcript.ts samples/CMG_FY2025Q3/transcript.txt [base=http://localhost:3000]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Monitor, fmtTime } from "../lib/engine";
import { makeApi } from "../lib/client";
import { buildScript } from "../lib/transcript";

const [file, base = "http://localhost:3000"] = process.argv.slice(2);
if (!file) {
  console.error("usage: eval-transcript.ts <transcript.txt> [baseUrl]");
  process.exit(1);
}
const name = basename(dirname(file)) || basename(file);
const script = buildScript(readFileSync(file, "utf8"));
const api = makeApi({ base, accessCode: () => process.env.ACCESS_CODE || null });
const m = new Monitor({ title: name, api, script, live: "strict" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\s+/g, " ").trim()}"`;

(async () => {
  for (let t = 0; t <= m.duration; t += 2) {
    m.tick(t);
    if (Math.floor(t) % 120 === 0) await sleep(5); // let requests start
  }
  m.tick(m.duration);
  for (let i = 0; i < 900 && m.exchanges.some((e) => e.judgePending || e.asksPending); i++) await sleep(200);
  m.finish();

  const judged = m.exchanges.filter((e) => e.judgment);
  const rows = [
    ["call", "time", "analyst", "follow_up", "question", "answer", "tool_verdict", "rule_verdict", "model_overall", "asks", "rationale", "deflection", "my_label", "my_note"].join(","),
    ...judged.map((e) => {
      const answer = e.aSegIds.map((id) => m.segments.find((s) => s.id === id)?.text).join(" ");
      return [
        name,
        fmtTime(e.qStart),
        m.speaker(e.analystId)?.name,
        e.parentId ? "yes" : "",
        m.questionText(e),
        answer.length > 1500 ? answer.slice(0, 1500) + " …" : answer,
        e.judgment!.verdict,
        e.ruleJudgment?.verdict,
        e.judgment!.modelVerdict ?? "",
        (e.judgment!.asks || []).map((a) => `[${a.status}${a.primary ? "*" : ""}] ${a.item}`).join(" | "),
        e.judgment!.rationale,
        e.judgment!.deflection ? e.judgment!.deflectedTo || "yes" : "",
        "",
        "",
      ]
        .map(csv)
        .join(",");
    }),
  ];
  mkdirSync("validation", { recursive: true });
  const out = join("validation", `${name}_exchanges.csv`);
  writeFileSync(out, rows.join("\n") + "\n");

  const dist = (k: "verdict") => {
    const c: Record<string, number> = {};
    for (const e of judged) c[e.judgment![k]] = (c[e.judgment![k]] || 0) + 1;
    return c;
  };
  const agree = judged.filter((e) => e.ruleJudgment?.verdict === e.judgment!.verdict).length;
  console.log(`${name}: ${judged.length} questions judged → ${out}`);
  console.log("  tool verdicts:", dist("verdict"));
  console.log(`  rules agree with LLM judge: ${agree}/${judged.length}`);
  const ev: Record<string, number> = {};
  for (const e of m.events) ev[e.type] = (ev[e.type] || 0) + 1;
  console.log("  events:", ev);
  process.exit(0);
})();
