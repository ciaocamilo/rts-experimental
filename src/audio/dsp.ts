/** Primitivas de síntesis sobre `Float32Array`: sin Web Audio ni DOM, deterministas y probables en Node. */

export interface Rng {
  /** Uniforme en [0, 1). */
  next(): number;
  /** Uniforme en [a, b). */
  range(a: number, b: number): number;
  /** Entero en [0, n). */
  int(n: number): number;
}

/** Generador con semilla (mulberry32), separado del de la simulación. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, range: (lo, hi) => lo + (hi - lo) * next(), int: (n) => Math.min(n - 1, Math.floor(next() * n)) };
}

export const samples = (seconds: number, sr: number): number => Math.max(1, Math.round(seconds * sr));

export const makeBuffer = (seconds: number, sr: number): Float32Array => new Float32Array(samples(seconds, sr));

export function whiteNoise(rng: Rng, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng.next() * 2 - 1;
  return out;
}

/** Ruido marrón (integración con fuga) normalizado a pico ≈ 1. */
export function brownNoise(rng: Rng, n: number): Float32Array {
  const out = new Float32Array(n);
  let acc = 0;
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    acc = acc * 0.995 + (rng.next() * 2 - 1) * 0.1;
    out[i] = acc;
    peak = Math.max(peak, Math.abs(acc));
  }
  for (let i = 0; i < n; i++) out[i]! /= peak;
  return out;
}

export function sine(freq: number, seconds: number, sr: number, phase = 0): Float32Array {
  const out = makeBuffer(seconds, sr);
  const w = (2 * Math.PI * freq) / sr;
  for (let i = 0; i < out.length; i++) out[i] = Math.sin(phase + w * i);
  return out;
}

/** Seno con frecuencia que va de `f0` a `f1` de forma exponencial. */
export function chirp(f0: number, f1: number, seconds: number, sr: number): Float32Array {
  const out = makeBuffer(seconds, sr);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const f = f0 * Math.pow(f1 / f0, i / out.length);
    phase += (2 * Math.PI * f) / sr;
    out[i] = Math.sin(phase);
  }
  return out;
}

/** Envolvente exponencial `e^(-t/tau)`. */
export function expEnv(n: number, sr: number, tau: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.exp(-i / sr / tau);
  return out;
}

/** Ataque lineal de `attack` s y caída exponencial con constante `tau`. */
export function pluckEnv(n: number, sr: number, attack: number, tau: number): Float32Array {
  const out = new Float32Array(n);
  const a = Math.max(1, Math.round(attack * sr));
  for (let i = 0; i < n; i++) out[i] = Math.min(1, i / a) * Math.exp(-i / sr / tau);
  return out;
}

export function multiply(buf: Float32Array, env: Float32Array): Float32Array {
  const n = Math.min(buf.length, env.length);
  for (let i = 0; i < n; i++) buf[i]! *= env[i]!;
  for (let i = n; i < buf.length; i++) buf[i] = 0;
  return buf;
}

/** Suma `src` en `dst` desde `offset` muestras; ignora lo que exceda el destino. */
export function addInto(dst: Float32Array, src: Float32Array, offset = 0, gain = 1): Float32Array {
  const start = Math.max(0, offset);
  for (let i = start; i < dst.length && i - offset < src.length; i++) {
    const j = i - offset;
    if (j >= 0) dst[i]! += src[j]! * gain;
  }
  return dst;
}

export function scale(buf: Float32Array, gain: number): Float32Array {
  for (let i = 0; i < buf.length; i++) buf[i]! *= gain;
  return buf;
}

/** Fundidos lineales de entrada y salida en muestras, contra clics. */
export function fadeEdges(buf: Float32Array, inSamples: number, outSamples: number): Float32Array {
  for (let i = 0; i < Math.min(inSamples, buf.length); i++) buf[i]! *= i / inSamples;
  for (let i = 0; i < Math.min(outSamples, buf.length); i++) buf[buf.length - 1 - i]! *= i / outSamples;
  return buf;
}

export function peakOf(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]!));
  return p;
}

export function allFinite(buf: Float32Array): boolean {
  for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i]!)) return false;
  return true;
}

/** Normaliza el pico a `peak`; un buffer silencioso queda igual. */
export function normalize(buf: Float32Array, peak = 0.9): Float32Array {
  const p = peakOf(buf);
  if (p > 1e-9) scale(buf, peak / p);
  return buf;
}

export type FilterKind = "lowpass" | "highpass" | "bandpass";

interface Coeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function coeffs(kind: FilterKind, sr: number, freq: number, q: number): Coeffs {
  const f = Math.min(Math.max(freq, 20), sr * 0.45);
  const w0 = (2 * Math.PI * f) / sr;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  let b0: number;
  let b1: number;
  let b2: number;
  if (kind === "lowpass") {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = b0;
  } else if (kind === "highpass") {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = b0;
  } else {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/** Filtro biquad de frecuencia fija (fórmulas RBJ). Devuelve un buffer nuevo. */
export function filter(kind: FilterKind, input: Float32Array, sr: number, freq: number, q = 0.707): Float32Array {
  return filterSweep(kind, input, sr, () => freq, q);
}

/** Filtro biquad cuya frecuencia sigue `freqAt(t)` (segundos); recalcula coeficientes cada 16 muestras. */
export function filterSweep(kind: FilterKind, input: Float32Array, sr: number, freqAt: (t: number) => number, q = 0.707): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  let c = coeffs(kind, sr, freqAt(0), q);
  for (let i = 0; i < input.length; i++) {
    if (i % 16 === 0) c = coeffs(kind, sr, freqAt(i / sr), q);
    const x0 = input[i]!;
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    out[i] = y0;
  }
  return out;
}

/**
 * Cuerda pulsada de Karplus–Strong con afinación fraccionaria (pasa-todo de primer orden).
 * `damping` cercano a 1 sostiene más; `brightness` (0 a 1) suaviza el ruido inicial.
 */
export function karplusStrong(rng: Rng, freq: number, seconds: number, sr: number, damping = 0.996, brightness = 0.6): Float32Array {
  const total = samples(seconds, sr);
  const exact = sr / freq - 0.5;
  const n = Math.max(2, Math.floor(exact));
  const frac = Math.max(0.1, exact - n);
  const c = (1 - frac) / (1 + frac);
  const line = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.next() * 2 - 1;
    prev = prev * (1 - brightness) + w * brightness;
    line[i] = prev;
  }
  const out = new Float32Array(total);
  let idx = 0;
  let apX = 0;
  let apY = 0;
  for (let i = 0; i < total; i++) {
    const cur = line[idx]!;
    const next = line[(idx + 1) % n]!;
    const averaged = damping * 0.5 * (cur + next);
    const tuned = c * averaged + apX - c * apY;
    apX = averaged;
    apY = tuned;
    line[idx] = tuned;
    out[i] = cur;
    idx = (idx + 1) % n;
  }
  return out;
}

/** Reverberación de Schroeder (4 peines con amortiguación y 2 pasa-todo). `spread` desplaza los retardos (canal derecho). */
export function reverb(input: Float32Array, sr: number, mix = 0.18, spread = 0, tail = 0): Float32Array {
  const k = sr / 44100;
  const combDelays = [1557, 1617, 1491, 1422].map((d) => Math.max(8, Math.round((d + spread) * k)));
  const length = input.length + Math.round(tail * sr);
  const wet = new Float32Array(length);
  const feedback = 0.82;
  const damp = 0.25;
  for (const delay of combDelays) {
    const line = new Float32Array(delay);
    let idx = 0;
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const x = i < input.length ? input[i]! : 0;
      const y = line[idx]!;
      lp = y * (1 - damp) + lp * damp;
      line[idx] = x + lp * feedback;
      idx = (idx + 1) % delay;
      wet[i]! += y * 0.25;
    }
  }
  let out = wet;
  for (const [d, g] of [[225, 0.5], [556, 0.5]] as const) {
    const delay = Math.max(4, Math.round((d + spread) * k));
    const line = new Float32Array(delay);
    let idx = 0;
    const next = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const buffered = line[idx]!;
      const v = out[i]! - g * buffered;
      line[idx] = v;
      next[i] = buffered + g * v;
      idx = (idx + 1) % delay;
    }
    out = next;
  }
  const result = new Float32Array(length);
  for (let i = 0; i < length; i++) result[i] = (i < input.length ? input[i]! : 0) * (1 - mix) + out[i]! * mix * 3;
  return result;
}

/** Amplitud normalizada de `freq` en `buf` (algoritmo de Goertzel); 1 es una senoidal de amplitud 1. */
export function goertzel(buf: Float32Array, sr: number, freq: number): number {
  const w = (2 * Math.PI * freq) / sr;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const s0 = buf[i]! + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return (2 * Math.sqrt(Math.max(0, power))) / buf.length;
}

/** Hace que el final enlace con el inicio: mezcla los últimos `overlap` muestras bajo el comienzo y recorta. */
export function makeLoop(buf: Float32Array, overlap: number): Float32Array {
  const n = buf.length - overlap;
  const out = buf.slice(0, n);
  for (let i = 0; i < overlap; i++) {
    const t = i / overlap;
    out[i] = out[i]! * Math.sqrt(t) + buf[n + i]! * Math.sqrt(1 - t);
  }
  return out;
}

/** Convierte semitonos respecto a la nota 69 (la 440 Hz) en frecuencia. */
export const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);
