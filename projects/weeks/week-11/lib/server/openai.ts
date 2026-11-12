// Server-only helpers. The API key never leaves the server.
import "server-only";

export const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const KEY = () => process.env.OPENAI_API_KEY || "";

export const hasKey = () => KEY().length > 0;

/** If ACCESS_CODE is set, every paid route requires the matching x-access-code header. */
export function guard(req: Request): Response | null {
  if (!hasKey()) return Response.json({ error: "Server has no OPENAI_API_KEY; running in rules-only mode." }, { status: 503 });
  const code = process.env.ACCESS_CODE;
  if (code && req.headers.get("x-access-code") !== code)
    return Response.json({ error: "Access code required" }, { status: 401 });
  return null;
}

export async function chatJSON<T>(opts: {
  name: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
  effort?: "none" | "low" | "medium";
  maxTokens?: number;
}): Promise<T> {
  const body = {
    model: MODEL,
    reasoning_effort: opts.effort ?? "low",
    max_completion_tokens: opts.maxTokens ?? 2500,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    response_format: { type: "json_schema", json_schema: { name: opts.name, strict: true, schema: opts.schema } },
  };
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const d = await r.json();
      const txt = d.choices?.[0]?.message?.content;
      if (txt) return JSON.parse(txt) as T;
      lastErr = "empty completion";
    } else {
      lastErr = `${r.status} ${(await r.text()).slice(0, 300)}`;
      if (r.status < 500 && r.status !== 429) break;
    }
    await new Promise((res) => setTimeout(res, 800));
  }
  throw new Error(`OpenAI: ${lastErr}`);
}

export const errorResponse = (e: unknown) =>
  Response.json({ error: String((e as Error)?.message || e).slice(0, 400) }, { status: 502 });
