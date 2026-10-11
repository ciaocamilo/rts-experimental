import { addInto, chirp, expEnv, filter, filterSweep, karplusStrong, makeBuffer, modalBank, multiply, samples, whiteNoise, type Rng } from "./dsp";

/** Instrumentos de época sintetizados; comparten efectos de victoria/derrota y música. `velocity` (0 a 1) cambia el timbre. */
export type Instrument = (freq: number, seconds: number, sr: number, rng: Rng, velocity?: number) => Float32Array;

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

interface Vibrato {
  rate: number;
  depth: number;
  delay: number;
}

/** Sierra con polyBLEP; `detuneCents` y vibrato opcional con entrada tardía. */
function saw(freq: number, seconds: number, sr: number, vibrato?: Vibrato, detuneCents = 0, phase0 = 0): Float32Array {
  const out = makeBuffer(seconds, sr);
  const base = freq * Math.pow(2, detuneCents / 1200);
  let phase = phase0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let f = base;
    if (vibrato && t > vibrato.delay) f *= 1 + vibrato.depth * Math.sin(2 * Math.PI * vibrato.rate * (t - vibrato.delay)) * Math.min(1, (t - vibrato.delay) / 0.4);
    const dt = Math.min(0.45, f / sr);
    phase += dt;
    if (phase >= 1) phase -= 1;
    out[i] = 2 * phase - 1 - polyBlep(phase, dt);
  }
  return out;
}

/** Envolvente con ataque y liberación lineales y sostenido plano. */
function shape(buf: Float32Array, sr: number, attack: number, release: number): Float32Array {
  const a = Math.max(1, Math.round(attack * sr));
  const r = Math.max(1, Math.round(release * sr));
  for (let i = 0; i < buf.length; i++) {
    const up = Math.min(1, i / a);
    const down = Math.min(1, (buf.length - 1 - i) / r);
    buf[i]! *= up * down;
  }
  return buf;
}

export const trumpet: Instrument = (freq, seconds, sr) => {
  const raw = saw(freq, seconds, sr, { rate: 5.5, depth: 0.004, delay: 0.3 });
  const open = filterSweep("lowpass", raw, sr, (t) => 1200 + 2300 * (1 - Math.exp(-t / 0.05)), 0.9);
  return shape(open, sr, 0.04, Math.min(0.2, seconds / 2));
};

export const shawm: Instrument = (freq, seconds, sr) => {
  const a = saw(freq, seconds, sr);
  const b = saw(freq, seconds, sr, undefined, 0, 0.35);
  const pulse = new Float32Array(a.length);
  for (let i = 0; i < pulse.length; i++) pulse[i] = a[i]! - b[i]!;
  const nasal = filter("bandpass", pulse, sr, 1300, 1.5);
  for (let i = 0; i < nasal.length; i++) nasal[i] = nasal[i]! * 1.2 + pulse[i]! * 0.3;
  return shape(nasal, sr, 0.03, Math.min(0.12, seconds / 2));
};

export const horn: Instrument = (freq, seconds, sr) => {
  const raw = saw(freq, seconds, sr, { rate: 4.5, depth: 0.003, delay: 0.4 });
  const dark = filterSweep("lowpass", raw, sr, (t) => 600 + 500 * (1 - Math.exp(-t / 0.3)), 0.8);
  return shape(dark, sr, 0.15, Math.min(0.45, seconds / 2));
};

/** Bordón de zanfona: dos sierras desafinadas ±6 cents con deriva lenta, ruedecilla que zumba y paso bajo. */
export const drone: Instrument = (freq, seconds, sr, rng) => {
  const drift = { rate: 0.3, depth: 0.0017, delay: 0 };
  const a = saw(freq, seconds, sr, drift, -6);
  const b = saw(freq, seconds, sr, { ...drift, rate: 0.23 }, 6, 0.3);
  const mix = new Float32Array(a.length);
  for (let i = 0; i < mix.length; i++) mix[i] = (a[i]! + b[i]!) * 0.5;
  const out = filter("lowpass", mix, sr, 520, 0.8);
  const wheel = filter("bandpass", whiteNoise(rng, out.length), sr, 700, 2);
  for (let i = 0; i < out.length; i++) {
    const pulse = 0.5 + 0.5 * Math.sin((2 * Math.PI * 6 * i) / sr);
    out[i]! += wheel[i]! * pulse * pulse * 0.05;
  }
  return shape(out, sr, Math.min(0.5, seconds / 3), Math.min(0.5, seconds / 3));
};

/** Flauta dulce: casi senoidal, armónicos que crecen con la dinámica, soplido de ataque y vibrato tardío creciente. */
export const flute: Instrument = (freq, seconds, sr, rng, velocity = 0.8) => {
  const out = makeBuffer(seconds, sr);
  const h2 = 0.08 + 0.12 * velocity;
  const h3 = 0.05 + 0.12 * velocity;
  let p1 = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const depth = 0.004 + 0.005 * Math.min(1, t / 1.2);
    const vib = t > 0.25 ? 1 + depth * Math.sin(2 * Math.PI * 5 * (t - 0.25)) * Math.min(1, (t - 0.25) / 0.4) : 1;
    p1 += (2 * Math.PI * freq * vib) / sr;
    out[i] = Math.sin(p1) + h2 * Math.sin(2 * p1) + h3 * Math.sin(3 * p1);
  }
  const breath = filter("bandpass", whiteNoise(rng, out.length), sr, Math.min(freq * 2.5, sr * 0.4), 1.2);
  for (let i = 0; i < out.length; i++) out[i] = out[i]! * 0.8 + breath[i]! * (0.04 + 0.2 * Math.exp(-(i / sr) / 0.06));
  return shape(out, sr, 0.05, Math.min(0.12, seconds / 2));
};

/** Laúd: dos cuerdas por orden (3 cents), uña en el ataque y resonancia de la caja a ≈ 100 y 220 Hz. */
export const lute: Instrument = (freq, seconds, sr, rng) => {
  const a = karplusStrong(rng, freq, seconds, sr, 0.994, 0.5);
  const b = karplusStrong(rng, freq * Math.pow(2, 3 / 1200), seconds, sr, 0.994, 0.5);
  const strings = new Float32Array(a.length);
  for (let i = 0; i < strings.length; i++) strings[i] = (a[i]! + b[i]!) * 0.5;
  const body = filter("bandpass", strings, sr, 220, 3);
  const low = filter("bandpass", strings, sr, 100, 3);
  for (let i = 0; i < strings.length; i++) strings[i]! += body[i]! * 0.35 + low[i]! * 0.25;
  const nail = multiply(filter("highpass", whiteNoise(rng, samples(0.01, sr)), sr, 3000), expEnv(samples(0.01, sr), sr, 0.003));
  addInto(strings, nail, 0, 0.12);
  return multiply(strings, expEnv(samples(seconds, sr), sr, Math.max(0.4, seconds)));
};

/** Salterio: cuerda brillante y cuerdas simpáticas en la quinta y la octava. */
export const psaltery: Instrument = (freq, seconds, sr, rng) => {
  const out = multiply(karplusStrong(rng, freq, seconds, sr, 0.9965, 0.85), expEnv(samples(seconds, sr), sr, Math.max(0.5, seconds)));
  addInto(out, modalBank([freq * 1.5, freq * 2], [0.04, 0.05], [0.9, 0.9], seconds, sr), 0, 1);
  return out;
};

/** Tamboril (pandero de marco): golpe grave con soplo de piel, aro que resuena y rebote leve; `soft` apaga el tintineo. */
export function tabor(sr: number, rng: Rng, soft = false, seconds = 0.3): Float32Array {
  const n = samples(seconds, sr);
  const body = multiply(chirp(110, 70, seconds, sr), expEnv(n, sr, 0.08));
  const skin = multiply(filter("lowpass", whiteNoise(rng, n), sr, 2000), expEnv(n, sr, 0.02));
  addInto(body, skin, 0, soft ? 0.12 : 0.3);
  if (!soft) {
    addInto(body, multiply(filter("highpass", whiteNoise(rng, n), sr, 5000), expEnv(n, sr, 0.03)), 0, 0.06);
    addInto(body, modalBank([900], [0.25], [0.03], seconds, sr), 0, 1);
    addInto(body, multiply(chirp(100, 70, seconds, sr), expEnv(n, sr, 0.04)), Math.round(0.045 * sr), 0.25);
  }
  return body;
}

/** Coloca una nota ya sintetizada en el destino, en segundos. */
export function place(dst: Float32Array, note: Float32Array, startSec: number, sr: number, gain = 1): void {
  addInto(dst, note, Math.round(startSec * sr), gain);
}
