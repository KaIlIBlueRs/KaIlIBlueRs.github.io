"use client";
// Setup screen → monitor. Everything heavy (decoding, analysis) happens in the browser;
// the server only proxies paid API calls so the key stays secret.
import { useEffect, useRef, useState } from "react";
import { decodeFile } from "@/lib/audio";
import { cacheGet, cachePut, lsGet, lsSet, sha256 } from "@/lib/cache";
import { makeApi } from "@/lib/client";
import { Monitor, type Api } from "@/lib/engine";
import { PATTERNS } from "@/lib/patterns";
import { buildScript } from "@/lib/transcript";
import MonitorView from "./MonitorView";

export interface Session {
  monitor: Monitor;
  audioUrl?: string;
  fileKey: string;
  mode: "audio" | "transcript";
}

interface Health {
  llm: boolean;
  model: string;
  accessCode: boolean;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  if (session)
    return (
      <MonitorView
        session={session}
        onExit={() => {
          if (session.audioUrl) URL.revokeObjectURL(session.audioUrl);
          setSession(null);
        }}
      />
    );
  return <Setup onReady={setSession} />;
}

function Setup({ onReady }: { onReady: (s: Session) => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [live, setLive] = useState<"lyric" | "strict">("lyric");
  const [useLLM, setUseLLM] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCode(lsGet("ww:code") || "");
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ llm: false, model: "", accessCode: false }));
  }, []);

  const llmOn = !!health?.llm && useLLM;

  function apiFor(fileKey: string): Api | null {
    if (!llmOn) return null;
    const real = makeApi({ accessCode: () => lsGet("ww:code") });
    return {
      ...real,
      async transcribe(chunk, refs) {
        const key = `${fileKey}:${await sha256(chunk)}:${refs.map((r) => r.name).join(",")}`;
        const hit = await cacheGet<any>(key);
        if (hit) return hit;
        const res = await real.transcribe(chunk, refs);
        cachePut(key, res);
        return res;
      },
    };
  }

  async function startAudio(file: File) {
    setErr(null);
    if (!llmOn) {
      setErr(
        health?.llm
          ? "Audio needs speech-to-text, so the API has to be on. Turn it back on, or use a transcript for rules-only mode."
          : "The server has no OpenAI key, so audio can't be transcribed. Paste a transcript instead (rules-only mode), or add OPENAI_API_KEY.",
      );
      return;
    }
    try {
      setBusy("Fingerprinting the file…");
      const fileKey = (await sha256(file)).slice(0, 16);
      setBusy("Decoding audio in your browser…");
      const audio = await decodeFile(file);
      setBusy(null);
      const title = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
      const monitor = new Monitor({ title, api: apiFor(fileKey), audio, live });
      monitor.tick(0); // start transcribing the opening right away
      onReady({ monitor, audioUrl: URL.createObjectURL(file), fileKey, mode: "audio" });
    } catch (e: any) {
      setBusy(null);
      setErr(`Couldn't decode that file (${e?.message || e}). Try an MP3, M4A or WAV.`);
    }
  }

  async function startTranscript(text: string, name: string) {
    setErr(null);
    const script = buildScript(text);
    if (script.segments.length < 3) {
      setErr("That transcript didn't parse. Expected lines like “Jane Doe -- CFO: text” or “Operator: text”.");
      return;
    }
    const fileKey = (await sha256(new TextEncoder().encode(text).buffer as ArrayBuffer)).slice(0, 16);
    const monitor = new Monitor({ title: name, api: apiFor(fileKey), script, live: "strict" });
    onReady({ monitor, fileKey, mode: "transcript" });
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (/\.(txt|md)$/i.test(f.name) || f.type.startsWith("text/")) startTranscript(await f.text(), f.name.replace(/\.[^.]+$/, ""));
    else startAudio(f);
  }

  const cats = Object.values(PATTERNS).map((p) => p.gif);

  return (
    <div className="setup">
      <div className="setup-card panel">
        <div className="brand">
          <div className="brand-mark">🐾</div>
          <h1>Whisker Watch</h1>
          <span className="pill" style={{ marginLeft: "auto" }}>
            <span className="dot" style={{ background: health?.llm ? "var(--good)" : "var(--dim)" }} />
            {health ? (health.llm ? `API ready · ${health.model}` : "Rules-only (no API key)") : "checking…"}
          </span>
        </div>
        <p className="lede">
          Replays an earnings call in real time and listens the way an analyst would. When management dodges a
          question, hedges, goes quiet or changes its voice, a cat reacts, and the evidence appears next to it.
        </p>

        <div
          className={`drop ${over ? "over" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            onFile(e.dataTransfer.files[0]);
          }}
        >
          {busy ? (
            <>
              <span className="spinner" /> <strong style={{ marginLeft: 8 }}>{busy}</strong>
              <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                The audio never leaves your browser in full; only short chunks go out for transcription.
              </div>
            </>
          ) : (
            <>
              <strong>Drop the earnings call here</strong>
              <div className="muted" style={{ marginTop: 6, fontSize: 14 }}>
                MP3 / M4A / WAV audio, or a .txt transcript · or click to choose
              </div>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.mp3,.m4a,.wav,.txt,text/plain"
            hidden
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>

        <div className="options">
          <button className={`opt ${live === "lyric" ? "on" : ""}`} onClick={() => setLive("lyric")}>
            <b>🎤 Lyric sync (default)</b>
            <span>
              Captions roll in time with the voice. Speech-to-text runs a minute ahead, like a broadcast caption buffer.
              The detectors still only see what has already been played.
            </span>
          </button>
          <button className={`opt ${live === "strict" ? "on" : ""}`} onClick={() => setLive("strict")}>
            <b>📡 Strict live</b>
            <span>
              Audio is sent for transcription only after it has played, exactly like a live call. Captions trail the
              voice by about 20–40 s.
            </span>
          </button>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
          {health?.llm && (
            <label className="pill" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={useLLM} onChange={(e) => setUseLLM(e.target.checked)} /> Use the API
              (speech-to-text + judge)
            </label>
          )}
          {health?.accessCode && (
            <input
              className="field"
              placeholder="Access code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                lsSet("ww:code", e.target.value);
              }}
              style={{ width: 150 }}
            />
          )}
          <button className="btn ghost" onClick={() => setShowPaste((v) => !v)}>
            {showPaste ? "Hide" : "Or paste a transcript"}
          </button>
        </div>

        {showPaste && (
          <div style={{ marginTop: 12 }}>
            <textarea
              className="textarea"
              placeholder={"Operator: Our first question comes from Jane Lee with Morgan Stanley.\nJane Lee -- Analyst: What's your Q4 margin guide?\nBob Smith -- CFO: We feel great about the long-term…"}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <button className="btn primary" style={{ marginTop: 8 }} disabled={!paste.trim()} onClick={() => startTranscript(paste, "Pasted transcript")}>
              Replay transcript (≈156 wpm, no audio signals)
            </button>
          </div>
        )}

        {err && (
          <div style={{ marginTop: 14, color: "var(--alert)", fontSize: 14 }}>
            {err}
          </div>
        )}

        <div className="cat-strip" aria-hidden>
          {cats.map((g) => (
            <img key={g} src={g} alt="" />
          ))}
        </div>
      </div>
    </div>
  );
}
