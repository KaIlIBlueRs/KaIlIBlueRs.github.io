// One audio chunk (≤ ~75 s, 16 kHz WAV) → speaker-labelled, timestamped segments.
// Voice reference clips of already-known speakers keep labels consistent across chunks.
import { errorResponse, guard } from "@/lib/server/openai";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 4_400_000;

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob)) return Response.json({ error: "missing audio" }, { status: 400 });
    if (audio.size > MAX_BYTES) return Response.json({ error: "chunk too large" }, { status: 413 });

    const out = new FormData();
    out.append("file", audio, "chunk.wav");
    out.append("model", "gpt-4o-transcribe-diarize");
    out.append("response_format", "diarized_json");
    out.append("chunking_strategy", "auto");
    const names = form.getAll("refName").map(String).slice(0, 4);
    const clips = form.getAll("refAudio").slice(0, 4);
    for (let i = 0; i < Math.min(names.length, clips.length); i++) {
      const clip = clips[i];
      if (!(clip instanceof Blob)) continue;
      const b64 = Buffer.from(await clip.arrayBuffer()).toString("base64");
      out.append("known_speaker_names[]", names[i]);
      out.append("known_speaker_references[]", `data:audio/wav;base64,${b64}`);
    }

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: out,
    });
    if (!r.ok) return Response.json({ error: `transcription ${r.status}: ${(await r.text()).slice(0, 300)}` }, { status: 502 });
    const d = await r.json();
    const segments = (d.segments || [])
      .filter((s: any) => typeof s.text === "string" && s.text.trim())
      .map((s: any) => ({
        speaker: String(s.speaker ?? "?"),
        start: Number(s.start) || 0,
        end: Number(s.end) || Number(s.start) || 0,
        text: s.text.trim(),
      }));
    return Response.json({ segments });
  } catch (e) {
    return errorResponse(e);
  }
}
