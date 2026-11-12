// Speaker naming: maps a chunk's diarization labels onto the running roster of call participants.
import { chatJSON, errorResponse, guard } from "@/lib/server/openai";
import type { SpeakersRequest, SpeakersResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ROLE = { type: "string", enum: ["operator", "executive", "analyst", "unknown"] };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["assignments", "newSpeakers", "updates"],
  properties: {
    assignments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["i", "speaker"],
        properties: { i: { type: "integer" }, speaker: { type: "string" } },
      },
    },
    newSpeakers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "name", "role", "org"],
        properties: { key: { type: "string" }, name: { type: "string" }, role: ROLE, org: { type: "string" } },
      },
    },
    updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "role", "org"],
        properties: { id: { type: "string" }, name: { type: "string" }, role: ROLE, org: { type: "string" } },
      },
    },
  },
};

const SYSTEM = `You track who is speaking in an earnings conference call transcript that arrives in chunks.
Roles: "operator" (conference moderator who introduces analysts), "executive" (company management or IR, including the IR host who reads the safe-harbor statement), "analyst" (sell-side/buy-side analyst asking questions).

For EVERY new segment i, assign a speaker: either an existing roster id (e.g. "S3") or a key ("N1","N2",...) that you define in newSpeakers.
Evidence, strongest first:
1. Text cues: the operator says "next question comes from Jane Lee with Morgan Stanley" → the next distinct voice is that analyst. Executives get introduced ("I'll turn it over to our CFO, Bob"). Answers start with "Thanks, Jane"; questions end with "?" or "thanks".
2. Diarization labels: segments sharing a label within this chunk are usually the same person, but labels can wrongly merge two people at a hand-off, so trust text cues over labels.
3. Labels that equal a roster id were matched by voice reference; keep them unless the text clearly contradicts it (e.g. the "CEO" label asking a question to management).
4. Executives are often addressed by name in a question ("Adam, ...", "And Scott, ..."); the next executive to speak is usually that person, or says who will take it ("I'll let Adam take that"). Different executives must have different ids. Never merge two named people into one id, even if the diarization label matches.
Do not create a new speaker for someone already on the roster. A new analyst gets a new speaker even if the diarization label was used before. If a name is unknown, use a descriptive name like "Analyst (Goldman Sachs)" or "Executive (CFO)" or "Operator".
org = analyst's firm, or executive's title (e.g. "CFO"). Use "" if unknown.
Use updates only to fill in generic names (e.g. an "Executive (CFO)" is now named "Adam Rymer") or fix a role/org. Never use updates to rename one named person to a different person; assign that person's lines to a new key instead.`;

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as SpeakersRequest;
    if (!Array.isArray(body.segments) || body.segments.length > 200)
      return Response.json({ error: "bad segments" }, { status: 400 });
    if (!body.segments.length) return Response.json({ assignments: [], newSpeakers: [], updates: [] });
    const user = [
      `ROSTER (so far):\n${body.roster.length ? body.roster.map((r) => `${r.id}: ${r.name} | ${r.role} | ${r.org || ""}`).join("\n") : "(empty: this is the start of the call)"}`,
      `VOICE-MATCHED LABELS IN THIS CHUNK: ${body.voiceMatched.join(", ") || "none"}`,
      `PREVIOUS LINES (already resolved):\n${body.context.map((c) => `[${c.speaker}] ${c.text}`).join("\n") || "(none)"}`,
      `NEW SEGMENTS:\n${body.segments.map((s) => `${s.i}. <${s.label}> ${s.text}`).join("\n")}`,
    ].join("\n\n");
    const out = await chatJSON<SpeakersResponse>({ name: "speakers", schema: SCHEMA, system: SYSTEM, user, effort: "low", maxTokens: 4000 });
    return Response.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
