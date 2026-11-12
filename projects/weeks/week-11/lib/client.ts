// Browser/Node client for the API routes. Implements the engine's Api interface.
import type { Api, JudgeRequest, SummaryRequest } from "./engine";
import type { Ask, Judgment, SpeakersRequest, SpeakersResponse, TranscribeResponse } from "./types";

export class ApiError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

export function makeApi(opts: { base?: string; accessCode?: () => string | null }): Api {
  const base = opts.base ?? "";
  const headers = (json: boolean): Record<string, string> => {
    const h: Record<string, string> = {};
    if (json) h["Content-Type"] = "application/json";
    const code = opts.accessCode?.();
    if (code) h["x-access-code"] = code;
    return h;
  };
  async function post<T>(path: string, body: unknown, timeoutMs = 45000): Promise<T> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const isForm = typeof FormData !== "undefined" && body instanceof FormData;
      const r = await fetch(base + path, {
        method: "POST",
        headers: headers(!isForm),
        body: isForm ? (body as FormData) : JSON.stringify(body),
        signal: ctl.signal,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new ApiError(r.status, d.error || `${path} ${r.status}`);
      return d as T;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    transcribe(chunk, refs) {
      const f = new FormData();
      f.append("audio", chunk, "chunk.wav");
      for (const r of refs) {
        f.append("refName", r.name);
        f.append("refAudio", r.audio, `${r.name}.wav`);
      }
      return post<TranscribeResponse>("/api/transcribe", f, 90000);
    },
    speakers: (req: SpeakersRequest) => post<SpeakersResponse>("/api/speakers", req),
    question: (q) => post<{ asks: Ask[] }>("/api/question", q, 25000),
    judge: (req: JudgeRequest) => post<Judgment>("/api/judge", req),
    summary: (req: SummaryRequest) => post<{ summary: string }>("/api/summary", req),
  };
}
