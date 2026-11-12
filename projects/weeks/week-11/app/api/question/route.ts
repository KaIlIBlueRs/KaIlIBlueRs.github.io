// Break an analyst's question into the specific things asked for (shown live as a checklist).
import { chatJSON, errorResponse, guard } from "@/lib/server/openai";

export const runtime = "nodejs";
export const maxDuration = 30;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["asks"],
  properties: {
    asks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "wantsNumber"],
        properties: { item: { type: "string" }, wantsNumber: { type: "boolean" } },
      },
    },
  },
};

const SYSTEM = `An analyst just asked management a question on an earnings call (speech-to-text, may contain filler and transcription errors).
List the distinct things the analyst wants to know, 1–4 items, each ≤ 10 words, phrased as the information requested (e.g. "Q4 gross margin guidance", "why China demand slowed").
Skip pleasantries, congratulations and background the analyst gives. wantsNumber = true if the item asks for a figure, range, percentage, timing or magnitude.`;

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const { analyst, question } = await req.json();
    if (typeof question !== "string" || question.length > 8000) return Response.json({ error: "bad question" }, { status: 400 });
    const out = await chatJSON<{ asks: { item: string; wantsNumber: boolean }[] }>({
      name: "asks",
      schema: SCHEMA,
      system: SYSTEM,
      user: `Analyst: ${analyst}\nQuestion: ${question}`,
      effort: "low",
      maxTokens: 1500,
    });
    return Response.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
