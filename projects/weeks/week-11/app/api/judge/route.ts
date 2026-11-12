// The non-answer judge: was each thing the analyst asked for actually answered?
import { chatJSON, errorResponse, guard } from "@/lib/server/openai";
import type { JudgeRequest } from "@/lib/engine";
import { verdictFromAsks } from "@/lib/lexicon";

export const runtime = "nodejs";
export const maxDuration = 60;

const STATUS = { type: "string", enum: ["answered", "partial", "not_answered", "declined"] };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "asks", "deflection", "deflectedTo", "quote", "rationale", "confidence"],
  properties: {
    verdict: { type: "string", enum: ["answered", "partial", "non_answer", "declined"] },
    asks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "wantsNumber", "primary", "status", "evidence"],
        properties: {
          item: { type: "string" },
          wantsNumber: { type: "boolean" },
          primary: { type: "boolean" },
          status: STATUS,
          evidence: { type: "string" },
        },
      },
    },
    deflection: { type: "boolean" },
    deflectedTo: { type: "string" },
    quote: { type: "string" },
    rationale: { type: "string" },
    confidence: { type: "number" },
  },
};

const SYSTEM = `You are a careful, fair equity analyst reviewing one question-and-answer exchange from an earnings call (speech-to-text; ignore transcription glitches).
List the items the analyst asked for (merge trivially-related sub-questions; 1–4 items). Mark exactly one as primary: the core thing the analyst most wants to learn (usually the first substantive ask, or the one the preamble builds up to).
Judge like a fair sell-side analyst writing up the call: would you say management answered you? For each item decide its status:
- "answered": the answer provides the requested information (the figure/range/direction if a number was asked; a substantive explanation if a "why/how" was asked). Pointing precisely to a number given earlier on the call counts.
- "partial": some relevant information but clearly short of what was asked (e.g. only a direction when an explicit figure was requested; one region of two). If the analyst asked for "color", "how to think about" or a qualitative view, a substantive qualitative answer is "answered", not partial. A range or a bracket counts as a number.
- "not_answered": the answer talks around it, changes the subject, restates prepared talking points, or ignores it, without saying it won't be answered.
- "declined": management explicitly says it will not or cannot provide it AND gives a reason or policy (e.g. "we don't guide by segment", "too early given input-cost volatility; we'll update at investor day"). An explicit decline is NOT evasion.
verdict: your overall call (answered / partial / non_answer / declined). The app also derives a verdict from the item statuses: primary answered → answered; primary declined → declined; nothing answered → non_answer; else partial.
deflection: true only if the answer pivots from the specific ask to something broader or different (long-term vision, a different metric, general strategy talk). deflectedTo names what it pivoted to (≤ 8 words), else "".
quote: the single most telling sentence from the ANSWER, verbatim (≤ 30 words): the evasive line for a non-answer, the key figure for an answer.
rationale: ≤ 25 words, concrete, plain English, no accusations of lying. Describe what was and wasn't provided.
evidence: ≤ 15 words per item, quoting or pointing to the relevant answer part, or "nothing on this".
confidence: 0–1.
Be fair to management: an answer can be brief and still complete; long-term context followed by the actual number is "answered".

Examples:
Q: "What are you expecting for gross margin next quarter?" A: "We feel very good about the long-term trajectory of the business and our strategy is working." → not_answered, deflection to "long-term trajectory".
Q: "Can you give a margin forecast for next quarter?" A: "We're not providing a quarterly margin forecast right now because raw-material prices are swinging too much; we'll update at our March investor day." → declined (explicit, with reason).
Q: "How much did pricing contribute, and do you expect it to continue?" A: "Pricing was about 3 points of the 7% growth. Going forward, we'll see." → partial (first answered with a figure, second not).`;

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const b = (await req.json()) as JudgeRequest;
    const answer = (b.answer || []).map((t) => `${t.speaker}: ${t.text}`).join("\n");
    if (!b.question || answer.length > 30000) return Response.json({ error: "bad request" }, { status: 400 });
    const user = [
      `ANALYST: ${b.analyst}`,
      `QUESTION: ${b.question}`,
      b.asks?.length ? `ITEMS ASKED FOR (pre-parsed; refine if needed): ${b.asks.map((a) => a.item).join(" | ")}` : "",
      b.earlier ? `EARLIER ANSWERS ON THIS CALL (for "as I said" checks): ${b.earlier}` : "",
      `ANSWER:\n${answer}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const out = await chatJSON<any>({ name: "judgment", schema: SCHEMA, system: SYSTEM, user, effort: "low", maxTokens: 3000 });
    // headline verdict is derived deterministically from the per-item statuses
    const verdict = out.asks?.length ? verdictFromAsks(out.asks) : out.verdict;
    return Response.json({ ...out, verdict, modelVerdict: out.verdict, source: "llm" });
  } catch (e) {
    return errorResponse(e);
  }
}
