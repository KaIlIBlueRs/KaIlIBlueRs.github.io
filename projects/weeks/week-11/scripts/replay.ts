// Headless end-to-end check: feeds a real call through the same engine + API routes the UI uses.
// Usage: npx tsx scripts/replay.ts <audio> <startSec> <lengthSec> [speed=6] [lyric|strict] [base=http://localhost:3000]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fromSamples } from "../lib/audio";
import { Monitor, fmtTime, type Api } from "../lib/engine";
import { makeApi } from "../lib/client";

const [audioPath, startArg = "0", lenArg = "300", speedArg = "6", live = "lyric", base = "http://localhost:3000"] =
  process.argv.slice(2);
const start = +startArg, len = +lenArg, speed = +speedArg;
const cacheDir = process.env.REPLAY_CACHE || join(process.cwd(), ".replay-cache");
mkdirSync(cacheDir, { recursive: true });

const pcm = execFileSync("ffmpeg", ["-loglevel", "error", "-i", audioPath, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], {
  maxBuffer: 1 << 30,
});
const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
const audio = fromSamples(new Float32Array(samples));
console.log(`decoded ${fmtTime(audio.duration)}; noise floor ${audio.noiseFloor.toExponential(2)}`);

const real = makeApi({ base, accessCode: () => process.env.ACCESS_CODE || null });
let calls = { transcribe: 0, cached: 0, speakers: 0, question: 0, judge: 0 };
const api: Api = {
  ...real,
  async transcribe(chunk, refs) {
    const buf = Buffer.from(await chunk.arrayBuffer());
    const key = createHash("sha1").update(buf).update(refs.map((r) => r.name).join(",")).digest("hex");
    const f = join(cacheDir, key + ".json");
    if (existsSync(f)) {
      calls.cached++;
      return JSON.parse(readFileSync(f, "utf8"));
    }
    calls.transcribe++;
    const t0 = Date.now();
    const r = await real.transcribe(chunk, refs);
    console.log(`  · transcribed ${(buf.length / 32000).toFixed(0)}s chunk in ${((Date.now() - t0) / 1000).toFixed(1)}s (refs: ${refs.map((r) => r.name).join(",") || "-"})`);
    writeFileSync(f, JSON.stringify(r));
    return r;
  },
  speakers: (q) => (calls.speakers++, real.speakers(q)),
  question: (q) => (calls.question++, real.question(q)),
  judge: (q) => (calls.judge++, real.judge(q)),
};

const m = new Monitor({ title: audioPath.split("/").slice(-2, -1)[0], api, audio, live: live as any });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seen = 0;
const printNew = () => {
  for (; seen < m.log.length; seen++) console.log(m.log[seen]);
};

(async () => {
  m.seek(start);
  const end = Math.min(audio.duration, start + len);
  for (let t = start; t < end; t += 0.1 * speed) {
    m.tick(t);
    printNew();
    await sleep(100);
  }
  m.tick(end);
  // let pending chunks / judges finish (playhead held at end)
  for (let i = 0; i < 600 && (m.chunks.some((c) => c.state === "pending" || c.state === "transcribed") || m.exchanges.some((e) => e.judgePending || e.asksPending)); i++) {
    await sleep(200);
    m.tick(end);
    printNew();
  }
  m.finish();
  for (let i = 0; i < 300 && !m.summary; i++) await sleep(200);
  printNew();

  console.log("\n=== SPEAKERS");
  for (const s of m.speakers.values()) console.log(`${s.id}  ${s.role.padEnd(9)} ${s.name}${s.org ? " | " + s.org : ""}`);
  console.log("\n=== EXCHANGES");
  for (const e of m.exchanges) {
    const j = e.judgment;
    console.log(`\n[${fmtTime(e.qStart)}] ${m.speaker(e.analystId)?.name}${e.parentId ? " (follow-up)" : ""}  pause=${e.pauseBefore?.toFixed(1) ?? "-"}s`);
    console.log(`  Q: ${m.questionText(e).slice(0, 260)}`);
    if (j) {
      console.log(`  → ${j.verdict.toUpperCase()} (${j.source}, conf ${j.confidence})  rule says: ${e.ruleJudgment?.verdict}`);
      for (const a of j.asks) console.log(`     - [${a.status}] ${a.item} :: ${a.evidence ?? ""}`);
      console.log(`  why: ${j.rationale}${j.deflection ? `  | deflected to: ${j.deflectedTo}` : ""}`);
    } else console.log(`  (no judgment: ${e.status})`);
  }
  console.log("\n=== EVENTS");
  for (const e of m.events)
    console.log(`${fmtTime(e.t).padStart(6)} (+${(e.firedAt - e.t).toFixed(0)}s) ${e.type.padEnd(9)} ${e.title} — ${e.detail.slice(0, 160)}`);
  console.log("\n=== SUMMARY\n" + m.summary);
  console.log(`procTime ${fmtTime(m.procTime)}; chunks: ${m.chunks.filter((c) => c.start >= start - 60).map((c) => c.state[0]).join("")}`);
  if (process.env.DUMP)
    for (const s of m.segments.filter((s) => s.start >= start))
      console.log(`${fmtTime(s.start)} ${(m.speaker(s.speakerId)?.id ?? "?").padEnd(3)} ${(m.speaker(s.speakerId)?.role ?? "").padEnd(9)} ${(s as any)._backchannel ? "[bc] " : ""}${s.text.slice(0, 100)}`);
  console.log("\nAPI calls:", calls);
  const segs = m.segments.filter((s) => s.start >= start);
  console.log(`segments: ${segs.length}, with pitch: ${segs.filter((s) => s.f0).length}`);
  process.exit(0);
})();
