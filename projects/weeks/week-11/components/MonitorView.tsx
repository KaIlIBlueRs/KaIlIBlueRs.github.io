"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { fmtTime, type Monitor } from "@/lib/engine";
import { IDLE_GIF, PATTERNS } from "@/lib/patterns";
import { lsGet, lsSet } from "@/lib/cache";
import type { EventType, MonitorEvent, Segment } from "@/lib/types";
import type { Session } from "./App";
import { ASK_ICON, Highlighted, VerdictBadge, toneColor } from "./bits";
import { RulebookSheet, SummarySheet } from "./Sheets";

// ───────────────────────── clock ─────────────────────────
// Audio mode: the <audio> element is the clock. Transcript mode: a virtual clock.
function useClock(session: Session) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const v = useRef({ t: 0, playing: false, rate: 1, last: 0 });
  const [, force] = useState(0);
  const get = useCallback(() => {
    if (session.mode === "audio") return audioRef.current?.currentTime ?? 0;
    const c = v.current;
    if (c.playing) {
      const now = performance.now();
      c.t = Math.min(session.monitor.duration, c.t + ((now - c.last) / 1000) * c.rate);
      c.last = now;
      if (c.t >= session.monitor.duration) c.playing = false;
    }
    return c.t;
  }, [session]);
  const playing = () => (session.mode === "audio" ? !!audioRef.current && !audioRef.current.paused : v.current.playing);
  const play = () => {
    if (session.mode === "audio") audioRef.current?.play();
    else {
      v.current.playing = true;
      v.current.last = performance.now();
    }
    force((x) => x + 1);
  };
  const pause = () => {
    if (session.mode === "audio") audioRef.current?.pause();
    else {
      get();
      v.current.playing = false;
    }
    force((x) => x + 1);
  };
  const seek = (t: number) => {
    const tt = Math.max(0, Math.min(session.monitor.duration - 0.05, t));
    if (session.mode === "audio" && audioRef.current) audioRef.current.currentTime = tt;
    else {
      v.current.t = tt;
      v.current.last = performance.now();
    }
    session.monitor.seek(tt);
  };
  const setRate = (r: number) => {
    if (session.mode === "audio" && audioRef.current) audioRef.current.playbackRate = r;
    v.current.rate = r;
    force((x) => x + 1);
  };
  // stable identity so effects that depend on the clock don't restart every frame
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ audioRef, get, playing, play, pause, seek, setRate, rate: () => v.current.rate }), [session]);
}

// Live analyser for the scope (created on first play — browsers require a user gesture).
function useAnalyser(audioRef: React.RefObject<HTMLAudioElement | null>) {
  const an = useRef<AnalyserNode | null>(null);
  const init = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || an.current) return;
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(audio);
      const a = ctx.createAnalyser();
      a.fftSize = 1024;
      src.connect(a);
      a.connect(ctx.destination);
      an.current = a;
      ctx.resume();
    } catch {
      /* scope is optional */
    }
  }, [audioRef]);
  return { an, init };
}

export default function MonitorView({ session, onExit }: { session: Session; onExit: () => void }) {
  const m = session.monitor;
  useSyncExternalStore(m.subscribe, m.getVersion, m.getVersion);
  const clock = useClock(session);
  const [now, setNow] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const { an, init } = useAnalyser(clock.audioRef);
  const fbKey = `ww:fb:${session.fileKey}`;

  // drive the engine
  useEffect(() => {
    let raf = 0;
    let lastTick = 0;
    let lastUi = 0;
    const loop = (ts: number) => {
      const t = clock.get();
      if (ts - lastTick > 100) {
        m.tick(t);
        lastTick = ts;
      }
      if (ts - lastUi > 66) {
        setNow(t);
        lastUi = ts;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [m, clock]);

  // auto-open the summary when the call ends
  const endedRef = useRef(false);
  useEffect(() => {
    if (m.ended && !endedRef.current) {
      endedRef.current = true;
      setTimeout(() => setShowSummary(true), 1800);
    }
  });

  // restore earlier human votes for the same file (keyed by type + rounded time)
  useEffect(() => {
    let store: Record<string, { vote: "agree" | "disagree"; note?: string }> = {};
    try {
      store = JSON.parse(lsGet(fbKey) || "{}");
    } catch {}
    for (const e of m.events) {
      const k = `${e.type}@${Math.round(e.t)}`;
      if (!e.feedback && store[k] && !(e as any)._restored) {
        (e as any)._restored = true;
        m.setFeedback(e.id, store[k].vote, store[k].note);
      }
    }
  }, [m.events.length, m, fbKey]);

  const vote = (e: MonitorEvent, v: "agree" | "disagree" | null, note?: string) => {
    m.setFeedback(e.id, v, note);
    let store: Record<string, unknown> = {};
    try {
      store = JSON.parse(lsGet(fbKey) || "{}");
    } catch {}
    const k = `${e.type}@${Math.round(e.t)}`;
    if (v) store[k] = { vote: v, note: note ?? e.feedback?.note };
    else delete store[k];
    lsSet(fbKey, JSON.stringify(store));
  };

  const jump = (t: number) => {
    clock.seek(Math.max(0, t - 2));
    if (!clock.playing()) {
      init();
      clock.play();
    }
    setToast(`Replaying from ${fmtTime(Math.max(0, t - 2))}`);
    setTimeout(() => setToast(null), 1800);
  };

  // keyboard: space play/pause, ←/→ 5 s
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        if (clock.playing()) clock.pause();
        else {
          init();
          clock.play();
        }
      } else if (e.code === "ArrowRight") clock.seek(clock.get() + 5);
      else if (e.code === "ArrowLeft") clock.seek(clock.get() - 5);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clock, init]);

  const ready = m.chunks.filter((c) => c.state === "resolved").reduce((t, c) => (c.start <= t + 0.5 ? Math.max(t, c.end) : t), m.procTime);
  const pending = m.chunks.filter((c) => c.state === "pending").length;
  const errored = m.chunks.filter((c) => c.state === "error").length;

  return (
    <div className="app">
      {session.audioUrl && (
        <audio
          ref={clock.audioRef}
          src={session.audioUrl}
          preload="auto"
          onEnded={() => m.tick(m.duration)}
          onPlay={() => setNow(clock.get())}
        />
      )}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" style={{ width: 32, height: 32, fontSize: 17, borderRadius: 10 }}>
            🐾
          </div>
        </div>
        <div className="title" title={m.title}>
          {m.title}
        </div>
        <span className="pill">
          {clock.playing() && <span className="dot live-dot" />}
          {session.mode === "transcript" ? "Transcript replay" : m.live === "lyric" ? "Audio · lyric sync" : "Audio · strict live"}
        </span>
        {session.mode === "audio" && (
          <span className="pill" title="How far ahead speech-to-text has gotten">
            {pending ? <span className="spinner" /> : <span className="dot" style={{ background: "var(--good)" }} />}
            captions to {fmtTime(ready)}
            {errored ? <span style={{ color: "var(--alert)" }}> · {errored} retrying</span> : null}
          </span>
        )}
        <span className="pill">
          <span className="dot" style={{ background: m.api ? "var(--good)" : "var(--dim)" }} />
          {m.api ? "Judge: LLM + rules" : "Judge: rules only"}
        </span>
        <div className="spacer" />
        <button className="btn" onClick={() => setShowRules(true)}>
          📖 Rulebook
        </button>
        {m.ended ? (
          <button className="btn primary" onClick={() => setShowSummary(true)}>
            Summary
          </button>
        ) : (
          <button
            className="btn"
            onClick={() => {
              clock.pause();
              m.finish();
            }}
          >
            ⏹ End &amp; summarize
          </button>
        )}
        <button className="btn ghost" onClick={onExit}>
          New call
        </button>
      </header>

      <Player m={m} now={now} clock={clock} onPlay={init} jump={jump} />

      <div className="main">
        <div className="left">
          <QuestionCard m={m} />
          <Lyrics m={m} now={now} onSeek={(t) => clock.seek(t)} jump={jump} />
        </div>
        <div className="right">
          <CatStage m={m} now={now} />
          <Meters m={m} now={now} analyser={an} mode={session.mode} />
          <Feed m={m} jump={jump} vote={vote} />
        </div>
      </div>

      {showRules && <RulebookSheet onClose={() => setShowRules(false)} />}
      {showSummary && <SummarySheet m={m} onClose={() => setShowSummary(false)} jump={(t) => (setShowSummary(false), jump(t))} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// ───────────────────────── player + timeline ─────────────────────────
function Player({
  m,
  now,
  clock,
  onPlay,
  jump,
}: {
  m: Monitor;
  now: number;
  clock: ReturnType<typeof useClock>;
  onPlay: () => void;
  jump: (t: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const D = m.duration || 1;
  const pct = (t: number) => `${(Math.max(0, Math.min(D, t)) / D) * 100}%`;
  const tAt = (x: number) => {
    const r = ref.current!.getBoundingClientRect();
    return ((x - r.left) / r.width) * D;
  };
  // speaker turns already heard
  const turns = useMemo(() => {
    const out: { s: number; e: number; c: string }[] = [];
    for (const s of m.segments) {
      if (s.start > m.procTime) break;
      const c = m.speaker(s.speakerId)?.color ?? "#444";
      const last = out[out.length - 1];
      if (last && last.c === c && s.start - last.e < 3) last.e = s.end;
      else out.push({ s: s.start, e: s.end, c });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.version, m.segments.length]);
  return (
    <div className="player panel">
      <button
        className="play"
        aria-label={clock.playing() ? "Pause" : "Play"}
        onClick={() => {
          if (clock.playing()) clock.pause();
          else {
            onPlay();
            clock.play();
          }
        }}
      >
        {clock.playing() ? "❚❚" : "▶"}
      </button>
      <div className="time mono">
        <b>{fmtTime(now)}</b> / {fmtTime(m.duration)}
      </div>
      <div
        className="timeline"
        ref={ref}
        onMouseMove={(e) => setHover(tAt(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => clock.seek(tAt(e.clientX))}
      >
        <div className="track">
          {m.chunks.map((c) =>
            c.state === "resolved" || c.state === "pending" ? (
              <div
                key={c.index}
                className="cov"
                style={{
                  left: pct(c.start),
                  width: `calc(${pct(c.end)} - ${pct(c.start)})`,
                  background: c.state === "pending" ? "rgba(255,200,87,0.12)" : "rgba(255,255,255,0.07)",
                }}
              />
            ) : null,
          )}
          {turns.map((t, i) => (
            <div key={i} className="turn" style={{ left: pct(t.s), width: `calc(${pct(t.e)} - ${pct(t.s)})`, background: t.c }} />
          ))}
        </div>
        {m.events
          .filter((e) => e.type !== "call_end")
          .map((e) => (
            <div
              key={e.id}
              className="marker"
              title={`${fmtTime(e.t)} · ${PATTERNS[e.type].label}: ${e.title}`}
              style={{ left: pct(e.t), background: toneColor(e.type) }}
              onClick={(ev) => {
                ev.stopPropagation();
                jump(e.t);
              }}
            />
          ))}
        <div className="head" style={{ left: pct(now) }} />
        {hover !== null && (
          <div className="hover-time mono" style={{ left: pct(hover) }}>
            {fmtTime(hover)}
          </div>
        )}
      </div>
      <select className="speed" value={clock.rate()} onChange={(e) => clock.setRate(+e.target.value)} title="Playback speed">
        {[1, 1.25, 1.5, 2].map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>
      <span className="pill mono" title="Flags so far">
        🐱 {m.events.filter((e) => e.type !== "call_end" && e.type !== "qa_start").length}
      </span>
    </div>
  );
}

// ───────────────────────── question card ─────────────────────────
function QuestionCard({ m }: { m: Monitor }) {
  const ex = m.currentExchange();
  const [open, setOpen] = useState(false);
  if (!ex)
    return (
      <div className="qcard panel">
        <div className="label">Current question</div>
        <div className="qtext muted" style={{ marginTop: 6 }}>
          {m.qaStarted ? "Waiting for the next analyst…" : "Prepared remarks. These set each speaker's baseline (pitch, pace, hedging) for the Q&A."}
        </div>
      </div>
    );
  const analyst = m.speaker(ex.analystId);
  const answerer = m.speaker(m.segments.find((s) => s.id === ex.aSegIds[0])?.speakerId);
  const asks = ex.judgment?.asks ?? ex.asks;
  const elapsed = ex.status === "answering" && ex.aStart !== undefined ? m.playhead - ex.aStart : null;
  return (
    <div className="qcard panel" style={{ borderColor: ex.judgment ? undefined : "rgba(255,200,87,0.25)" }}>
      <div className="qhead">
        <span className="label">{ex.parentId ? "Follow-up" : "Question"}</span>
        <span className="chip" style={{ color: analyst?.color }}>
          <span className="dot" style={{ background: analyst?.color }} />
          {analyst?.name ?? "Analyst"}
          {analyst?.org && <span className="muted" style={{ fontWeight: 500 }}>· {analyst.org}</span>}
        </span>
        <span className="mono muted" style={{ fontSize: 12 }}>
          {fmtTime(ex.qStart)}
        </span>
        <div className="spacer" />
        {ex.status === "asking" && <span className="pill">🎙 asking…</span>}
        {ex.status === "answering" && (
          <span className="pill">
            <span className="dot" style={{ background: answerer?.color ?? "var(--accent)" }} />
            {answerer?.name.split(" ")[0] ?? "Management"} answering · {fmtTime(Math.max(0, elapsed ?? 0))}
          </span>
        )}
        {ex.judgePending && (
          <span className="pill">
            <span className="spinner" /> judging the answer…
          </span>
        )}
        {ex.judgment && <VerdictBadge verdict={ex.judgment.verdict} />}
      </div>
      <div className={`qtext ${open ? "open" : ""}`} onClick={() => setOpen((o) => !o)} title="Click to expand">
        {m.questionText(ex)}
      </div>
      <div className="asks">
        {ex.asksPending && (
          <span className="ask">
            <span className="spinner" /> reading the question…
          </span>
        )}
        {asks?.map((a, i) => (
          <span key={i} className={`ask ${a.status ?? ""}`} title={a.evidence || (a.wantsNumber ? "asks for a number" : "")}>
            <span className="ic">{a.status ? ASK_ICON[a.status] : ex.status === "answering" ? "…" : "?"}</span>
            {a.item}
            {a.wantsNumber && <span className="mono muted" style={{ fontSize: 11 }}>#</span>}
          </span>
        ))}
      </div>
      {ex.judgment && (
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
          {ex.judgment.rationale}
          {ex.ruleJudgment && ex.judgment.source === "llm" && ex.ruleJudgment.verdict !== ex.judgment.verdict && (
            <span style={{ color: "var(--dim)" }}> · rules alone said “{ex.ruleJudgment.verdict.replace("_", " ")}”</span>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── lyrics ─────────────────────────
function Lyrics({ m, now, onSeek, jump }: { m: Monitor; now: number; onSeek: (t: number) => void; jump: (t: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const [userScroll, setUserScroll] = useState(0);
  // segments the playhead has reached
  let lastIdx = -1;
  for (let i = 0; i < m.segments.length; i++) {
    if (m.segments[i].start <= now + 0.05) lastIdx = i;
    else break;
  }
  const from = Math.max(0, lastIdx - 80);
  const visible = m.segments.slice(from, lastIdx + 1);
  const active = visible.length && now < visible[visible.length - 1].end + 1.2 ? visible[visible.length - 1] : null;

  // event tags at the line where they happened
  const tags = useMemo(() => {
    const map = new Map<string, MonitorEvent[]>();
    for (const e of m.events) {
      if (e.type === "call_end") continue;
      const seg = m.segments.find((s) => e.t >= s.start - 0.2 && e.t < s.end) ?? m.segments.find((s) => s.start >= e.t);
      if (!seg) continue;
      map.set(seg.id, [...(map.get(seg.id) || []), e]);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.events.length, m.segments.length, m.version]);

  useEffect(() => {
    if (Date.now() - userScroll < 5000) return;
    const el = activeRef.current ?? (box.current?.lastElementChild as HTMLElement | null);
    const c = box.current;
    if (el && c) c.scrollTo({ top: el.offsetTop - c.clientHeight * 0.42, behavior: "smooth" });
  }, [active?.id, visible.length, userScroll]);

  const following = Date.now() - userScroll >= 5000;
  const waiting = m.audio && (m.chunks.find((c) => now >= c.start && now < c.end)?.state ?? "resolved") !== "resolved";

  let prevSpeaker: string | null | undefined = undefined;
  return (
    <div className="lyrics panel">
      {!following && (
        <button className="btn follow" onClick={() => setUserScroll(0)}>
          ↓ Follow live
        </button>
      )}
      <div className="lyrics-scroll" ref={box} onWheel={() => setUserScroll(Date.now())} onTouchMove={() => setUserScroll(Date.now())}>
        {!visible.length && !waiting && (
          <div className="buffering">Press ▶ (or space). Captions will roll here.</div>
        )}
        {visible.map((s) => {
          const sp = m.speaker(s.speakerId);
          const header = s.speakerId !== prevSpeaker && !(s as any)._backchannel;
          if (!(s as any)._backchannel) prevSpeaker = s.speakerId;
          const isActive = s === active;
          const p = isActive ? Math.min(100, Math.max(0, ((now - s.start) / Math.max(0.3, s.end - s.start)) * 100)) : 100;
          return (
            <div key={s.id}>
              {header && (
                <div className="who" style={{ color: sp?.color }}>
                  <span className="dot" style={{ background: sp?.color }} />
                  {sp?.name ?? "…"}
                  <span className="role">
                    {sp?.role === "unknown" ? "" : sp?.role}
                    {sp?.org ? ` · ${sp.org}` : ""}
                  </span>
                </div>
              )}
              <div
                ref={isActive ? activeRef : undefined}
                className={`line ${isActive ? "active" : "past"}`}
                onClick={() => onSeek(s.start)}
                title={`${fmtTime(s.start)}${s.f0 ? ` · ${Math.round(s.f0)} Hz` : ""}${s.wps ? ` · ${Math.round(s.wps * 60)} wpm` : ""}`}
              >
                <span className={isActive ? "fill" : (s as any)._backchannel ? "bc" : ""} style={{ ["--p" as any]: `${p}%` }}>
                  <Highlighted text={s.text} spans={s.spans} />
                </span>
                {tags.get(s.id)?.map((e) => (
                  <span
                    key={e.id}
                    className="evtag"
                    style={{ color: toneColor(e.type), background: `color-mix(in srgb, ${toneColor(e.type)} 15%, transparent)` }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      jump(e.t);
                    }}
                  >
                    🐱 {PATTERNS[e.type].label}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
        {waiting && (
          <div className="buffering">
            <span className="spinner" /> {m.live === "strict" ? "listening… captions follow once this stretch has played" : "transcribing this stretch…"}
          </div>
        )}
      </div>
      <div className="legend">
        <span>
          <span className="hl-hedge">hedge</span>
        </span>
        <span>
          <span className="hl-number">number</span>
        </span>
        <span>
          <span className="hl-deflect">pivot</span>
        </span>
        <span>
          <span className="hl-refusal">refusal</span>
        </span>
        <span style={{ marginLeft: "auto" }}>click a line to jump · space to play/pause</span>
      </div>
    </div>
  );
}

// ───────────────────────── cat stage ─────────────────────────
function CatStage({ m, now }: { m: Monitor; now: number }) {
  const [cur, setCur] = useState<{ ev: MonitorEvent; until: number; ms: number } | null>(null);
  const curRef = useRef(cur);
  useEffect(() => {
    const id = setInterval(() => {
      const t = performance.now();
      const c = curRef.current;
      if (c && t < c.until) return;
      let next: typeof c = null;
      if (m.catQueue.length) {
        const ev = m.nextCat()!;
        const ms = m.catQueue.length > 0 ? 4200 : 6500;
        next = { ev, until: t + ms, ms };
      } else if (c && t < c.until + 400) return;
      curRef.current = next;
      setCur(next);
    }, 200);
    return () => clearInterval(id);
  }, [m]);
  const ev = cur?.ev;
  const p = ev ? PATTERNS[ev.type] : null;
  const color = ev ? toneColor(ev.type) : "var(--line)";
  return (
    <div
      className={`stage panel ${ev ? "pop" : ""}`}
      key={ev?.id ?? "idle"}
      style={ev ? { borderColor: color, boxShadow: `0 0 0 1px ${color}, 0 10px 40px color-mix(in srgb, ${color} 22%, transparent)` } : undefined}
    >
      <div className="frame">
        <img src={p ? p.gif : IDLE_GIF} alt={p ? p.cat : "Cat loafing, listening"} />
      </div>
      <div className="cap">
        {ev && p ? (
          <>
            <div className="kind" style={{ color }}>
              {p.label} · <span className="mono">{fmtTime(ev.t)}</span>
            </div>
            <h3>{ev.title}</h3>
            <p>{ev.detail}</p>
            <div className="why">
              🐱 {p.cat}
              {ev.source === "llm" ? " · judged by LLM" : ev.source === "audio" ? " · measured from audio" : " · rule"}
            </div>
          </>
        ) : (
          <>
            <div className="kind" style={{ color: "var(--muted)" }}>
              Listening
            </div>
            <h3>{m.ended ? "Call over. See the summary." : now > 0 ? "Nothing odd right now" : "Ready when you are"}</h3>
            <p className="muted">One cat at a time. Each cat stands for one pattern, and the Rulebook says which.</p>
          </>
        )}
      </div>
      {ev && cur && <div className="timer" style={{ color, animationDuration: `${cur.ms}ms` }} />}
      {m.catQueue.length > 0 && <span className="pill queue-badge">+{m.catQueue.length} waiting</span>}
    </div>
  );
}

// ───────────────────────── meters ─────────────────────────
function Meters({
  m,
  now,
  analyser,
  mode,
}: {
  m: Monitor;
  now: number;
  analyser: React.MutableRefObject<AnalyserNode | null>;
  mode: "audio" | "transcript";
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // oscilloscope
  useEffect(() => {
    let raf = 0;
    const buf = new Uint8Array(1024);
    const draw = () => {
      const c = canvas.current;
      const a = analyser.current;
      if (c) {
        const g = c.getContext("2d")!;
        const w = (c.width = c.clientWidth * devicePixelRatio);
        const h = (c.height = c.clientHeight * devicePixelRatio);
        g.clearRect(0, 0, w, h);
        g.lineWidth = 1.5 * devicePixelRatio;
        g.strokeStyle = "rgba(255,200,87,0.85)";
        g.beginPath();
        if (a) {
          a.getByteTimeDomainData(buf);
          for (let i = 0; i < buf.length; i++) {
            const x = (i / (buf.length - 1)) * w;
            const y = h / 2 + ((buf[i] - 128) / 128) * h * 0.9;
            if (i) g.lineTo(x, y);
            else g.moveTo(x, y);
          }
        } else {
          g.moveTo(0, h / 2);
          g.lineTo(w, h / 2);
        }
        g.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  // the speaker on the floor now, and their latest fully-heard sentence
  let cur: Segment | undefined;
  for (let i = m.segments.length - 1; i >= 0; i--) {
    const s = m.segments[i];
    if (s.start <= now && !(s as any)._backchannel) {
      cur = s;
      break;
    }
  }
  const sp = m.speaker(cur?.speakerId);
  const done = cur ? [...m.segments].reverse().find((s) => s.speakerId === cur!.speakerId && (s as any)._done && s.f0 !== undefined) : undefined;
  const base = m.baselineOf(cur?.speakerId);
  // hedges in this speaker's last ~80 heard words
  let words = 0;
  let hedges = 0;
  for (let i = m.segments.length - 1; i >= 0 && words < 80; i--) {
    const s = m.segments[i];
    if (s.start > now || s.speakerId !== cur?.speakerId) continue;
    words += s.words;
    hedges += s.spans.filter((x) => x.kind === "hedge").length;
  }
  const silence = m.liveSilence();
  const pitch = done?.f0 ?? null;
  const wpm = done?.wps ? done.wps * 60 : null;
  const bar = (v: number | null, b: number | null | undefined, max: number, color: string) => (
    <div className="bar">
      <i style={{ width: `${Math.min(100, ((v ?? 0) / max) * 100)}%`, background: color }} />
      {b && Number.isFinite(b) ? <b style={{ left: `${Math.min(100, (b / max) * 100)}%` }} title="this speaker's baseline" /> : null}
    </div>
  );
  return (
    <div className="meters panel">
      <div className="meter">
        <div className="label">Pitch</div>
        <div className="v">
          {mode === "audio" && pitch ? Math.round(pitch) : "—"}
          <small>Hz</small>
        </div>
        {bar(pitch, base?.f0, 300, "var(--info)")}
        <div className="b">base {base?.f0 && Number.isFinite(base.f0) ? Math.round(base.f0) : "…"}</div>
      </div>
      <div className="meter">
        <div className="label">Pace</div>
        <div className="v">
          {mode === "audio" && wpm ? Math.round(wpm) : "—"}
          <small>wpm</small>
        </div>
        {bar(wpm, base?.wpm, 280, "var(--good)")}
        <div className="b">base {base?.wpm && Number.isFinite(base.wpm) ? Math.round(base.wpm) : "…"}</div>
      </div>
      <div className="meter">
        <div className="label">Hedges</div>
        <div className="v">
          {words ? ((hedges / words) * 100).toFixed(1) : "—"}
          <small>/100w</small>
        </div>
        {bar(words ? (hedges / words) * 100 : 0, base?.hedgeRate, 10, "var(--hedge)")}
        <div className="b">{hedges} in last {words} words</div>
      </div>
      <div className="meter">
        <div className="label">Silence</div>
        <div className="v" style={{ color: silence >= 2.5 ? "var(--caution)" : undefined }}>
          {mode === "audio" ? silence.toFixed(1) : "—"}
          <small>s</small>
        </div>
        {bar(silence, 2.5, 6, silence >= 2.5 ? "var(--caution)" : "var(--muted)")}
        <div className="b" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {sp ? <span style={{ color: sp.color }}>● {sp.name}</span> : "no speaker yet"}
        </div>
      </div>
      {mode === "audio" && <canvas className="scope" ref={canvas} />}
    </div>
  );
}

// ───────────────────────── event feed ─────────────────────────
const FILTERS: { key: string; label: string; types: EventType[] | null }[] = [
  { key: "all", label: "All", types: null },
  { key: "ans", label: "Answers", types: ["nonanswer", "partial", "deflect", "decline", "direct", "followup"] },
  { key: "voice", label: "Voice", types: ["pause", "vocal"] },
  { key: "words", label: "Words", types: ["hedge", "negative", "positive"] },
  { key: "fb", label: "Unreviewed", types: null },
];

function Feed({
  m,
  jump,
  vote,
}: {
  m: Monitor;
  jump: (t: number) => void;
  vote: (e: MonitorEvent, v: "agree" | "disagree" | null, note?: string) => void;
}) {
  const [f, setF] = useState("all");
  const filter = FILTERS.find((x) => x.key === f)!;
  const list = [...m.events]
    .filter((e) => e.type !== "call_end")
    .filter((e) => (f === "fb" ? !e.feedback && e.type !== "qa_start" : !filter.types || filter.types.includes(e.type)))
    .sort((a, b) => b.firedAt - a.firedAt || b.t - a.t);
  const reviewed = m.events.filter((e) => e.feedback).length;
  return (
    <div className="feed panel">
      <div className="feed-head">
        <span className="label">Flags</span>
        <span className="muted" style={{ fontSize: 12 }}>
          · newest first · click a time to replay
        </span>
        <div className="spacer" />
        <span className="pill" title="Your agree/disagree votes. They feed the validation table in the summary.">
          ✍️ {reviewed} reviewed
        </span>
      </div>
      <div className="filters">
        {FILTERS.map((x) => (
          <button key={x.key} className={f === x.key ? "on" : ""} onClick={() => setF(x.key)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="feed-list">
        {!list.length && <div className="empty">No flags yet. The cats are listening.</div>}
        {list.map((e) => (
          <EventRow key={e.id} e={e} m={m} jump={jump} vote={vote} />
        ))}
      </div>
    </div>
  );
}

function EventRow({
  e,
  m,
  jump,
  vote,
}: {
  e: MonitorEvent;
  m: Monitor;
  jump: (t: number) => void;
  vote: (e: MonitorEvent, v: "agree" | "disagree" | null, note?: string) => void;
}) {
  const p = PATTERNS[e.type];
  const sp = m.speaker(e.speakerId);
  const [note, setNote] = useState(e.feedback?.note ?? "");
  const lag = e.firedAt - e.t;
  return (
    <div className="ev">
      <img className="thumb" src={p.gif} alt={p.cat} loading="lazy" />
      <div>
        <div className="row1">
          <button className="t" onClick={() => jump(e.t)} title="Play from here">
            ▶ {fmtTime(e.t)}
          </button>
          <span style={{ color: toneColor(e.type), fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>
            {p.label}
          </span>
          {sp && (
            <span className="muted" style={{ fontSize: 12 }}>
              {sp.name}
            </span>
          )}
        </div>
        <div className="ttl">{e.title}</div>
        <div className="det">
          {e.detail}
          {lag > 1.5 && <span style={{ color: "var(--dim)" }}> · flagged {Math.round(lag)} s later</span>}
        </div>
        {e.quote && <div className="quote">“{e.quote}”</div>}
        {e.type !== "qa_start" && (
          <div className="votes">
            <button className={`vote agree ${e.feedback?.vote === "agree" ? "on" : ""}`} onClick={() => vote(e, e.feedback?.vote === "agree" ? null : "agree", note)}>
              👍 fair flag
            </button>
            <button
              className={`vote disagree ${e.feedback?.vote === "disagree" ? "on" : ""}`}
              onClick={() => vote(e, e.feedback?.vote === "disagree" ? null : "disagree", note)}
            >
              👎 misfire
            </button>
            {e.feedback && (
              <input
                className="note"
                placeholder="why? (optional)"
                value={note}
                onChange={(ev) => setNote(ev.target.value)}
                onBlur={() => vote(e, e.feedback!.vote, note)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
