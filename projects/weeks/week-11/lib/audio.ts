// In-browser audio analysis: decoding, energy, chunk planning, WAV encoding and pitch.
// The functions below take plain Float32Arrays, so the engine (and tests) don't depend on the DOM.

export const SR = 16000; // analysis + transcription sample rate
export const HOP = 320; // 20 ms energy frames

export interface AudioData {
  sr: number;
  samples: Float32Array; // mono, SR Hz
  rms: Float32Array; // one value per HOP frame
  duration: number;
  noiseFloor: number; // rms below this = silence
}

/** Decode any browser-playable file to 16 kHz mono and precompute frame energy. */
export async function decodeFile(file: Blob): Promise<AudioData> {
  const buf = await file.arrayBuffer();
  const Ctx: typeof OfflineAudioContext =
    (globalThis as any).OfflineAudioContext || (globalThis as any).webkitOfflineAudioContext;
  const ctx = new Ctx(1, SR, SR);
  const audio = await ctx.decodeAudioData(buf);
  let samples: Float32Array;
  if (audio.numberOfChannels === 1) {
    samples = audio.getChannelData(0);
  } else {
    samples = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const ch = audio.getChannelData(c);
      for (let i = 0; i < ch.length; i++) samples[i] += ch[i] / audio.numberOfChannels;
    }
  }
  return fromSamples(samples, audio.sampleRate);
}

export function fromSamples(samples: Float32Array, sr = SR): AudioData {
  const rms = frameRms(samples);
  return { sr, samples, rms, duration: samples.length / sr, noiseFloor: estimateNoiseFloor(rms) };
}

export function frameRms(x: Float32Array): Float32Array {
  const n = Math.floor(x.length / HOP);
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    const o = f * HOP;
    for (let i = 0; i < HOP; i++) s += x[o + i] * x[o + i];
    out[f] = Math.sqrt(s / HOP);
  }
  return out;
}

function percentile(arr: ArrayLike<number>, p: number) {
  const a = Array.from(arr).filter((v) => v > 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
}

/** Silence threshold: halfway (in log space) between the quiet floor and typical speech level. */
export function estimateNoiseFloor(rms: Float32Array) {
  const lo = Math.max(percentile(rms, 0.05), 1e-5);
  const hi = Math.max(percentile(rms, 0.6), lo * 2);
  return Math.exp(Math.log(lo) * 0.65 + Math.log(hi) * 0.35);
}

export const frameAt = (t: number, sr = SR) => Math.max(0, Math.floor((t * sr) / HOP));

/** Plan transcription chunks, cutting at the quietest moment near each target boundary. */
export function planChunks(a: AudioData, target = 60, slack = 12): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = 0;
  const fps = a.sr / HOP;
  while (start < a.duration - 0.5) {
    // the first chunk is short so captions can start sooner
    const tgt = out.length === 0 ? Math.min(target, 25) : target;
    if (a.duration - start <= tgt + slack) {
      out.push({ start, end: a.duration });
      break;
    }
    const lo = frameAt(start + tgt - Math.min(slack, tgt / 3), a.sr);
    const hi = Math.min(a.rms.length - 1, frameAt(start + tgt + Math.min(slack, tgt / 3), a.sr));
    // smallest 300 ms average energy in the window
    const W = 15;
    let best = lo;
    let bestE = Infinity;
    for (let f = lo; f < hi - W; f++) {
      let e = 0;
      for (let k = 0; k < W; k++) e += a.rms[f + k];
      if (e < bestE) {
        bestE = e;
        best = f + Math.floor(W / 2);
      }
    }
    const end = best / fps;
    out.push({ start, end });
    start = end;
  }
  return out;
}

/** 16-bit PCM WAV. 16 kHz mono ≈ 32 KB/s, so a 70 s chunk stays well under Vercel's 4.5 MB body limit. */
export function encodeWav(a: AudioData, t0: number, t1: number): Blob {
  const s0 = Math.max(0, Math.floor(t0 * a.sr));
  const s1 = Math.min(a.samples.length, Math.floor(t1 * a.sr));
  const n = Math.max(0, s1 - s0);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, a.sr, true);
  v.setUint32(28, a.sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, a.samples[s0 + i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

/**
 * Median F0 over [t0,t1] using a normalized autocorrelation (McLeod-style NSDF) on voiced frames.
 * Range 70–400 Hz covers adult speech on a phone line.
 */
export function pitchStats(a: AudioData, t0: number, t1: number): { f0: number | null; voicedRatio: number } {
  const N = 640; // 40 ms
  const step = 640; // every 40 ms is plenty for a median
  const minLag = Math.floor(a.sr / 400);
  const maxLag = Math.floor(a.sr / 70);
  const s0 = Math.max(0, Math.floor(t0 * a.sr));
  const s1 = Math.min(a.samples.length - N - maxLag, Math.floor(t1 * a.sr));
  const f0s: number[] = [];
  let frames = 0;
  const thr = a.noiseFloor * 1.5;
  for (let o = s0; o < s1; o += step) {
    frames++;
    const fi = Math.floor(o / HOP);
    if ((a.rms[fi] ?? 0) < thr) continue;
    let bestLag = -1;
    let best = 0;
    const nsdf: number[] = [];
    for (let lag = minLag; lag <= maxLag; lag++) {
      let ac = 0;
      let m = 0;
      for (let i = 0; i < N; i++) {
        const x = a.samples[o + i];
        const y = a.samples[o + i + lag];
        ac += x * y;
        m += x * x + y * y;
      }
      nsdf.push(m > 0 ? (2 * ac) / m : 0);
    }
    // first peak above 0.8 × global max (avoids octave errors)
    const gmax = Math.max(...nsdf);
    if (gmax < 0.55) continue;
    for (let k = 1; k < nsdf.length - 1; k++) {
      if (nsdf[k] > nsdf[k - 1] && nsdf[k] >= nsdf[k + 1] && nsdf[k] >= 0.8 * gmax) {
        bestLag = k + minLag;
        best = nsdf[k];
        break;
      }
    }
    if (bestLag > 0 && best > 0.55) f0s.push(a.sr / bestLag);
  }
  if (f0s.length < 5) return { f0: null, voicedRatio: frames ? f0s.length / frames : 0 };
  f0s.sort((x, y) => x - y);
  return { f0: f0s[Math.floor(f0s.length / 2)], voicedRatio: f0s.length / frames };
}

/** Longest stretch of silence (seconds) inside [t0,t1], and when it starts. */
export function longestSilence(a: AudioData, t0: number, t1: number) {
  const f0 = frameAt(t0, a.sr);
  const f1 = Math.min(a.rms.length, frameAt(t1, a.sr));
  // smooth over 100 ms so a click doesn't break a silence
  let bestLen = 0;
  let bestStart = f0;
  let run = 0;
  let runStart = f0;
  for (let f = f0; f < f1; f++) {
    let e = 0;
    let k = 0;
    for (let j = Math.max(f0, f - 2); j <= Math.min(f1 - 1, f + 2); j++, k++) e += a.rms[j];
    const silent = e / k < a.noiseFloor;
    if (silent) {
      if (run === 0) runStart = f;
      run++;
      if (run > bestLen) {
        bestLen = run;
        bestStart = runStart;
      }
    } else run = 0;
  }
  const fps = a.sr / HOP;
  return { seconds: bestLen / fps, at: bestStart / fps };
}

/** How long it has been silent right up to time t (for the live "silence" counter). */
export function silenceUpTo(a: AudioData, t: number) {
  let f = Math.min(a.rms.length - 1, frameAt(t, a.sr));
  let n = 0;
  while (f >= 0 && a.rms[f] < a.noiseFloor) {
    n++;
    f--;
  }
  return n / (a.sr / HOP);
}
