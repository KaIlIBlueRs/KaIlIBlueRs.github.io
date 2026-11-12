// End-of-call narrative. The timestamped event list is built client-side; this writes the prose.
import { chatJSON, errorResponse, guard } from "@/lib/server/openai";
import type { SummaryRequest } from "@/lib/engine";

export const runtime = "nodejs";
export const maxDuration = 60;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: { summary: { type: "string" } },
};

const SYSTEM = `Write the wrap-up of an earnings-call monitoring session for a classroom audience.
You get the judged analyst exchanges and the flagged events (with seconds from the start). Write 120–200 words in 2 short paragraphs:
1) What the Q&A was about and how forthcoming management was overall (count answered / partial / not answered / declined).
2) The 2–3 moments most worth replaying, with timestamps written as m:ss, and why. Mention if vocal or hedging signals coincided with a non-answer.
Plain, neutral language. Never claim anyone lied; say "did not answer" or "declined". No headings, no bullet points.`;

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const b = (await req.json()) as SummaryRequest;
    const user = JSON.stringify(b).slice(0, 40000);
    const out = await chatJSON<{ summary: string }>({ name: "summary", schema: SCHEMA, system: SYSTEM, user, effort: "low", maxTokens: 3000 });
    return Response.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
