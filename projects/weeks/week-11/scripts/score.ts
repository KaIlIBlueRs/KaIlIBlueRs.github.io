// Compare the tool's verdicts with your hand labels in validation/*_exchanges.csv.
// Labels: answered | partial | non_answer | declined (blank rows are skipped).
// Usage: npx tsx scripts/score.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

const V = ["answered", "partial", "non_answer", "declined"];
const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_").replace("nonanswer", "non_answer");
const pairs: { tool: string; rule: string; me: string }[] = [];
for (const f of readdirSync("validation").filter((f) => f.endsWith("_exchanges.csv"))) {
  const [head, ...rows] = parseCsv(readFileSync(join("validation", f), "utf8"));
  const ix = (k: string) => head.indexOf(k);
  for (const r of rows) {
    const me = norm(r[ix("my_label")] || "");
    if (!V.includes(me)) continue;
    pairs.push({ tool: r[ix("tool_verdict")], rule: r[ix("rule_verdict")], me });
  }
}
if (!pairs.length) {
  console.log("No labelled rows yet: fill the my_label column (answered / partial / non_answer / declined).");
  process.exit(0);
}
const acc = (k: "tool" | "rule") => pairs.filter((p) => p[k] === p.me).length;
console.log(`labelled questions: ${pairs.length}`);
console.log(`LLM judge agrees with you: ${acc("tool")}/${pairs.length} (${Math.round((acc("tool") / pairs.length) * 100)}%)`);
console.log(`rules-only judge agrees with you: ${acc("rule")}/${pairs.length} (${Math.round((acc("rule") / pairs.length) * 100)}%)`);
// "evasion" as a binary flag: non_answer vs everything else
const tp = pairs.filter((p) => p.tool === "non_answer" && p.me === "non_answer").length;
const fp = pairs.filter((p) => p.tool === "non_answer" && p.me !== "non_answer").length;
const fn = pairs.filter((p) => p.tool !== "non_answer" && p.me === "non_answer").length;
console.log(`non-answer flag: precision ${tp + fp ? Math.round((tp / (tp + fp)) * 100) : "-"}%, recall ${tp + fn ? Math.round((tp / (tp + fn)) * 100) : "-"}% (tp ${tp}, fp ${fp}, fn ${fn})`);
console.log("\nconfusion (rows = you, cols = tool):");
console.log("".padEnd(12) + V.map((v) => v.slice(0, 10).padStart(11)).join(""));
for (const a of V) console.log(a.padEnd(12) + V.map((b) => String(pairs.filter((p) => p.me === a && p.tool === b).length).padStart(11)).join(""));
