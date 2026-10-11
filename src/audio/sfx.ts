import {
  addInto,
  brownNoise,
  chirp,
  createRng,
  expEnv,
  fadeEdges,
  filter,
  filterSweep,
  makeBuffer,
  makeLoop,
  multiply,
  normalize,
  pluckEnv,
  reverb,
  samples,
  sine,
  whiteNoise,
  type Rng,
} from "./dsp";
import { drone, horn, place, shawm, tabor, trumpet } from "./instruments";
import type { CueId } from "./voices";

export interface SfxEntry {
  sampleRate: number;
  variants: Float32Array[];
}
export type SfxBank = Record<CueId, SfxEntry>;

const HI = 32000;
const LO = 22050;

const lowNoise = (rng: Rng, n: number, sr: number, cutoff: number, tau: number): Float32Array => multiply(filter("lowpass", whiteNoise(rng, n), sr, cutoff), expEnv(n, sr, tau));
const bandNoise = (rng: Rng, n: number, sr: number, freq: number, q: number, tau: number): Float32Array => multiply(filter("bandpass", whiteNoise(rng, n), sr, freq, q), expEnv(n, sr, tau));
const thump = (f0: number, f1: number, seconds: number, sr: number, tau: number): Float32Array => multiply(chirp(f0, f1, seconds, sr), expEnv(samples(seconds, sr), sr, tau));
const finish = (buf: Float32Array, sr: number, peak = 0.9): Float32Array => fadeEdges(normalize(buf, peak), Math.round(sr * 0.002), Math.round(sr * 0.02));

/** Impacto metálico breve: ráfaga de ruido de banda más parciales inarmónicos. */
function sword(variant: number, rng: Rng): Float32Array {
  const sr = HI;
  const out = makeBuffer(0.4, sr);
  const n = out.length;
  addInto(out, bandNoise(rng, n, sr, 2600 + variant * 900, 1.2, 0.012), 0, 0.8);
  const base = 1000 + variant * 170;
  for (const [ratio, amp, tau] of [[1, 0.5, 0.09], [2.76, 0.35, 0.06], [5.4, 0.2, 0.04]] as const) {
    addInto(out, multiply(sine(base * ratio, 0.4, sr), expEnv(n, sr, tau)), 0, amp);
  }
  return finish(out, sr);
}

/** Cuerda y silbido descendente de la flecha. */
function arrow(variant: number, rng: Rng): Float32Array {
  const sr = HI;
  const out = makeBuffer(0.45, sr);
  const n = out.length;
  addInto(out, multiply(sine(140 * (1 + 0.12 * variant), 0.05, sr), expEnv(samples(0.05, sr), sr, 0.02)), 0, 0.6);
  const whoosh = multiply(filterSweep("bandpass", whiteNoise(rng, n), sr, (t) => (3000 + 400 * variant) * Math.pow(0.5, Math.min(1, t / 0.18)), 2), pluckEnv(n, sr, 0.01, 0.07));
  addInto(out, whoosh, Math.round(0.02 * sr), 1);
  return finish(out, sr);
}

/** Golpe sordo del aldeano: sin resonancia metálica. */
function blow(variant: number, rng: Rng): Float32Array {
  const sr = HI;
  const out = makeBuffer(0.3, sr);
  const n = out.length;
  addInto(out, thump(170 - variant * 25, 90, 0.2, sr, 0.05), 0, 1);
  addInto(out, lowNoise(rng, n, sr, 700, 0.02), 0, 0.7);
  addInto(out, bandNoise(rng, n, sr, 1500, 1, 0.005), 0, 0.2);
  return finish(out, sr);
}

/** Lamento breve con formantes de vocal abierta; el aldeano es más agudo. */
function death(variant: number, rng: Rng): Float32Array {
  const sr = LO;
  const villager = variant < 2;
  const seconds = 0.7;
  const n = samples(seconds, sr);
  const pitch = (villager ? 1.25 : 1) * (1 + (variant % 2) * 0.07);
  const src = makeBuffer(seconds, sr);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = (330 - 150 * Math.min(1, t / 0.45)) * pitch * (1 + 0.02 * Math.sin(2 * Math.PI * 5.5 * t));
    phase += f / sr;
    if (phase >= 1) phase -= 1;
    src[i] = 2 * phase - 1;
  }
  const voiced = new Float32Array(n);
  addInto(voiced, filter("bandpass", src, sr, 700 * pitch ** 0.5, 6), 0, 1);
  addInto(voiced, filter("bandpass", src, sr, 1100 * pitch ** 0.5, 6), 0, 0.7);
  addInto(voiced, filter("bandpass", whiteNoise(rng, n), sr, 900, 1.5), 0, 0.12);
  return finish(multiply(voiced, pluckEnv(n, sr, 0.05, 0.3)), sr, 0.7);
}

/** Dos campanadas con parciales inarmónicos; la segunda una cuarta más grave. */
function bell(): Float32Array {
  const sr = HI;
  const out = makeBuffer(3.5, sr);
  const strike = (f0: number, offset: number, gain: number): void => {
    const parts: readonly (readonly [number, number, number])[] = [[0.5, 0.5, 2.5], [1, 1, 2.2], [1.2, 0.6, 1.6], [1.5, 0.5, 1.3], [2, 0.4, 0.9], [2.5, 0.25, 0.6], [3, 0.2, 0.4]];
    for (const [ratio, amp, tau] of parts) {
      addInto(out, multiply(sine(f0 * ratio, 3.2, sr), pluckEnv(samples(3.2, sr), sr, 0.002, tau)), Math.round(offset * sr), amp * gain);
    }
  };
  strike(220, 0, 1);
  strike(165, 0.45, 0.85);
  return finish(out, sr);
}

function hammer(variant: number, rng: Rng): Float32Array {
  const sr = HI;
  const out = makeBuffer(0.3, sr);
  const n = out.length;
  addInto(out, thump(1000 - variant * 100, 700, 0.25, sr, 0.03), 0, 0.8);
  addInto(out, bandNoise(rng, n, sr, 1800, 1.5, 0.008), 0, 0.6);
  addInto(out, multiply(sine(180, 0.3, sr), expEnv(n, sr, 0.05)), 0, 0.5);
  return finish(out, sr);
}

function axe(variant: number, rng: Rng): Float32Array {
  const sr = HI;
  const out = makeBuffer(0.35, sr);
  const n = out.length;
  addInto(out, thump(140 - variant * 12, 90, 0.3, sr, 0.08), 0, 1);
  addInto(out, lowNoise(rng, n, sr, 900, 0.03), 0, 0.6);
  addInto(out, bandNoise(rng, n, sr, 2500, 2, 0.004), Math.round(0.015 * sr), 0.3);
  addInto(out, bandNoise(rng, n, sr, 700, 4, 0.015), Math.round(0.06 * sr), 0.25);
  return finish(out, sr);
}

function pick(variant: number, rng: Rng): Float32Array {
  const sr = HI;
  const out = makeBuffer(0.3, sr);
  const n = out.length;
  const k = 1 + variant * 0.08;
  addInto(out, bandNoise(rng, n, sr, 3000, 1.5, 0.01), 0, 0.7);
  addInto(out, multiply(sine(1800 * k, 0.3, sr), expEnv(n, sr, 0.12)), 0, 0.6);
  addInto(out, multiply(sine(2900 * k, 0.3, sr), expEnv(n, sr, 0.07)), 0, 0.4);
  addInto(out, bandNoise(rng, n, sr, 400, 2, 0.01), 0, 0.3);
  return finish(out, sr);
}

/** Roce de follaje y chasquido de rama; el más discreto de los trabajos. */
function forage(variant: number, rng: Rng): Float32Array {
  const sr = HI;
  const out = makeBuffer(0.3, sr);
  const rustle = filter("lowpass", filter("highpass", whiteNoise(rng, samples(0.16, sr)), sr, 1000), sr, 4000 - variant * 600);
  addInto(out, multiply(rustle, pluckEnv(rustle.length, sr, 0.04, 0.06)), 0, 0.8);
  addInto(out, thump(700 - variant * 80, 400, 0.03, sr, 0.006), Math.round(0.12 * sr), 0.5);
  return finish(out, sr, 0.7);
}

/** Crujido de bisagra: sierra con barrido de banda y envolvente en joroba. */
function creak(f0: number, f1: number, b0: number, b1: number, seconds: number, sr: number, rng: Rng): Float32Array {
  const n = samples(seconds, sr);
  const src = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    phase += (f0 + (f1 - f0) * k) / sr;
    if (phase >= 1) phase -= 1;
    src[i] = (2 * phase - 1) * (0.7 + 0.3 * rng.next());
  }
  const swept = filterSweep("bandpass", src, sr, (t) => b0 + (b1 - b0) * (t / seconds), 5);
  for (let i = 0; i < n; i++) swept[i]! *= Math.sin((Math.PI * i) / n) ** 2;
  return swept;
}

function latch(sr: number, rng: Rng, gain = 1): Float32Array {
  const n = samples(0.1, sr);
  const out = thump(75, 55, 0.1, sr, 0.04);
  addInto(out, lowNoise(rng, n, sr, 500, 0.02), 0, 0.6);
  return multiply(out, new Float32Array(n).fill(gain));
}

/** Apertura con chirrido, golpe de pestillo y cierre con segundo golpe (≤ 1,2 s). */
function door(rng: Rng): Float32Array {
  const sr = LO;
  const out = makeBuffer(1.2, sr);
  addInto(out, creak(90, 140, 400, 900, 0.35, sr, rng), 0, 1);
  addInto(out, latch(sr, rng, 0.7), Math.round(0.37 * sr), 1);
  addInto(out, creak(130, 80, 700, 350, 0.25, sr, rng), Math.round(0.6 * sr), 0.8);
  addInto(out, latch(sr, rng, 1), Math.round(0.87 * sr), 1);
  return finish(out, sr);
}

/** Rumor, crujidos de madera, lluvia de escombros y golpe final; la variante grande es más larga y grave. */
function collapse(variant: number, rng: Rng): Float32Array {
  const sr = LO;
  const big = variant === 1;
  const d = big ? 1.9 : 1.3;
  const out = makeBuffer(d, sr);
  const n = out.length;
  const rumble = multiply(filter("lowpass", brownNoise(rng, n), sr, big ? 120 : 200), pluckEnv(n, sr, 0.1, d * 0.35));
  addInto(out, rumble, 0, 1);
  const creaks = big ? 6 : 3;
  for (let i = 0; i < creaks; i++) {
    const at = rng.range(0, d * 0.6);
    const len = samples(0.15, sr);
    const c = multiply(filter("bandpass", whiteNoise(rng, len), sr, rng.range(200, 800), 8), pluckEnv(len, sr, 0.02, 0.05));
    addInto(out, c, Math.round(at * sr), 0.9);
  }
  for (let i = 0; i < 8; i++) {
    const at = rng.range(d * 0.2, d * 0.9);
    const len = samples(0.2, sr);
    addInto(out, multiply(filter("highpass", whiteNoise(rng, len), sr, 1500), expEnv(len, sr, 0.04)), Math.round(at * sr), 0.3);
  }
  const hit = samples(0.4, sr);
  const thud = thump(big ? 55 : 70, big ? 38 : 50, 0.4, sr, 0.15);
  addInto(thud, lowNoise(rng, hit, sr, 120, 0.1), 0, 0.5);
  addInto(out, thud, Math.round(d * 0.7 * sr), 1.2);
  return finish(out, sr);
}

/** Bucle de 4 s: rumor, siseo modulado y chasquidos de impulsos. */
function fire(rng: Rng): Float32Array {
  const sr = LO;
  const overlap = 0.3;
  const total = 4 + overlap;
  const n = samples(total, sr);
  const out = filter("lowpass", brownNoise(rng, n), sr, 400);
  for (let i = 0; i < n; i++) out[i]! *= 0.5;
  const lfo = filter("lowpass", whiteNoise(rng, n), sr, 8);
  const hiss = filter("bandpass", whiteNoise(rng, n), sr, 3000, 0.5);
  let lfoPeak = 1e-9;
  for (let i = 0; i < n; i++) lfoPeak = Math.max(lfoPeak, Math.abs(lfo[i]!));
  for (let i = 0; i < n; i++) out[i]! += hiss[i]! * Math.abs(lfo[i]! / lfoPeak) * 0.5;
  for (let i = 0; i < total * 12; i++) {
    const len = samples(0.02, sr);
    const crackle = multiply(filter("bandpass", whiteNoise(rng, len), sr, rng.range(2000, 5000), 2), expEnv(len, sr, 0.004));
    addInto(out, crackle, Math.floor(rng.next() * (n - len)), rng.range(0.2, 1) * 0.9);
  }
  return normalize(makeLoop(out, Math.round(overlap * sr)), 0.8);
}

/** Fanfarria ascendente de trompeta y chirimía sobre quintas abiertas, con tamboril (≈ 4 s). */
function victory(rng: Rng): Float32Array {
  const sr = LO;
  const out = makeBuffer(3.9, sr);
  const hz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
  const melody: readonly (readonly [number, number, number])[] = [[62, 0, 0.3], [69, 0.35, 0.3], [74, 0.7, 0.3], [81, 1.05, 0.3]];
  for (const [midi, at, len] of melody) {
    place(out, trumpet(hz(midi), len, sr, rng), at, sr, 0.9);
    place(out, shawm(hz(midi), len, sr, rng), at, sr, 0.5);
  }
  for (const midi of [74, 69, 81]) {
    place(out, trumpet(hz(midi), 2.2, sr, rng), 1.5, sr, 0.7);
    place(out, shawm(hz(midi), 2.2, sr, rng), 1.5, sr, 0.35);
  }
  place(out, drone(hz(50), 2.4, sr, rng), 1.4, sr, 0.5);
  for (const at of [0, 0.7, 1.5]) place(out, tabor(sr, rng), at, sr, 0.9);
  return finish(reverb(out, sr, 0.25, 0, 0.5), sr);
}

/** Tema grave y lento descendente de cuerno y bordón que se apaga (≈ 5 s). */
function defeat(rng: Rng): Float32Array {
  const sr = LO;
  const out = makeBuffer(5, sr);
  const hz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
  const line: readonly (readonly [number, number, number])[] = [[62, 0, 0.9], [60, 0.8, 0.9], [57, 1.6, 0.9], [53, 2.4, 1.1], [50, 3.4, 1.4]];
  for (const [midi, at, len] of line) place(out, horn(hz(midi), len, sr, rng), at, sr, 0.9);
  place(out, drone(hz(38), 4.8, sr, rng), 0, sr, 0.6);
  place(out, drone(hz(45), 4.8, sr, rng), 0, sr, 0.35);
  for (const at of [0, 1.6]) place(out, tabor(sr, rng, true, 0.4), at, sr, 0.8);
  const wet = reverb(out, sr, 0.3, 0, 0.8);
  for (let i = 0; i < wet.length; i++) wet[i]! *= Math.max(0, 1 - Math.max(0, i / sr - 3.4) / 1.8);
  return finish(wet, sr);
}

const variantsOf = (count: number, make: (variant: number, rng: Rng) => Float32Array, seed: number): Float32Array[] =>
  Array.from({ length: count }, (_, v) => make(v, createRng(seed + v * 101)));

/** Sintetiza todos los efectos una vez; determinista para una semilla dada. */
export function buildSfxBank(seed = 1): SfxBank {
  const rng = createRng(seed);
  const entry = (sampleRate: number, variants: Float32Array[]): SfxEntry => ({ sampleRate, variants });
  return {
    sword: entry(HI, variantsOf(3, sword, seed + 1)),
    arrow: entry(HI, variantsOf(3, arrow, seed + 2)),
    blow: entry(HI, variantsOf(2, blow, seed + 3)),
    death: entry(LO, variantsOf(4, death, seed + 4)),
    bell: entry(HI, [bell()]),
    hammer: entry(HI, variantsOf(2, hammer, seed + 5)),
    axe: entry(HI, variantsOf(2, axe, seed + 6)),
    pick: entry(HI, variantsOf(2, pick, seed + 7)),
    forage: entry(HI, variantsOf(2, forage, seed + 8)),
    door: entry(LO, [door(createRng(seed + 9))]),
    collapse: entry(LO, variantsOf(2, collapse, seed + 10)),
    victory: entry(LO, [victory(createRng(seed + 11))]),
    defeat: entry(LO, [defeat(createRng(seed + 12))]),
    fire: entry(LO, [fire(rng)]),
  };
}
