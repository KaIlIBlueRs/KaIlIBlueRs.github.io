import { MODEL, hasKey } from "@/lib/server/openai";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ llm: hasKey(), model: MODEL, accessCode: !!process.env.ACCESS_CODE });
}
