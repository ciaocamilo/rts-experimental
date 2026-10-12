import {
  addInto,
  brownNoise,
  chirp,
  createRng,
  expEnv,
  fadeEdges,
  filter,
  filterSweep,
  formantFilter,
  glottalSource,
  makeBuffer,
  makeLoop,
  modalBank,
  multiply,
  normalize,
  pluckEnv,
  reverb,
  samples,
  sine,
  softClip,
  whiteNoise,
  type Rng,
} from "./dsp";
import { drone, horn, place, shawm, tabor, trumpet } from "./instruments";
import { CUES, type CueId } from "./voices";

export interface SfxEntry {
  sampleRate: number;
  variants: Float32Array[];
}
export type SfxBank = Record<CueId, SfxEntry>;

const HI = 32000;
const LO = 22050;

const lowNoise = (rng: Rng, n: number, sr: number, cutoff: number, tau: number): Float32Array => multiply(filter("lowpass", whiteNoise(rng, n), sr, cutoff), expEnv(n, sr, tau));
const bandNoise = (rng: Rng, n: number, sr: number, freq: number, q: number, tau: number): Float32Array => multiply(filter("bandpass", whiteNoise(rng, n), sr, freq, q), expEnv(n, sr, tau));
const highNoise = (rng: Rng, n: number, sr: number, cutoff: number, tau: number): Float32Array => multiply(filter("highpass", whiteNoise(rng, n), sr, cutoff), expEnv(n, sr, tau));
const thump = (f0: number, f1: number, seconds: number, sr: number, tau: number): Float32Array => multiply(chirp(f0, f1, seconds, sr), expEnv(samples(seconds, sr), sr, tau));
const finish = (buf: Float32Array, sr: number, peak = 0.9): Float32Array => fadeEdges(normalize(buf, peak), Math.round(sr * 0.002), Math.round(sr * 0.02));
const smooth = (x: number): number => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};

/** Choque de espadas: transitorio agudo, resonancia metálica inarmónica doble y "shing" de rozamiento. */
function sword(variant: number, rng: Rng): Float32Array {
  const sr = HI;
  const seconds = 0.5;
  const out = makeBuffer(seconds, sr);
  const n = out.length;
  addInto(out, highNoise(rng, n, sr, 3000, 0.003), 0, 1);
  const f0 = 700 + variant * 175;
  const ratios = [1, 2.76, 5.4, 8.93];
  const amps = [0.5, 0.55, 0.4, 0.25];
  const taus = [0.1, 0.06, 0.04, 0.025];
  addInto(out, modalBank(ratios.map((r) => f0 * r), amps, taus, seconds, sr), 0, 1);
  addInto(out, modalBank(ratios.map((r) => f0 * 1.034 * r), amps, taus.map((t) => t * 0.8), seconds, sr), Math.round(0.004 * sr), 0.55);
  const shing = multiply(filterSweep("bandpass", whiteNoise(rng, n), sr, (t) => 2000 + 4000 * Math.min(1, t / 0.12), 1.5), pluckEnv(n, sr, 0.01, 0.05));
  addInto(out, shing, 0, 0.7);
  addInto(out, thump(180 - variant * 10, 90, 0.1, sr, 0.03), 0, 0.6);
  softClip(out, 1.4);
  return finish(out, sr);
}

/** Flecha en vuelo: silbido de viento que sube y baja con el paso, vibración de la pluma y chasquido de cuerda. */
function arrow(variant: number, rng: Rng): Float32Array {
  const sr = HI;
  const seconds = 0.75;
  const out = makeBuffer(seconds, sr);
  const n = out.length;
  const pass = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.min(1, i / sr / seconds);
    pass[i] = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 1.6);
  }
  const whoosh = multiply(filterSweep("bandpass", whiteNoise(rng, n), sr, (t) => (3800 + 300 * variant) * Math.pow(0.32, Math.min(1, t / seconds)), 0.7), pass);
  addInto(out, whoosh, 0, 1);
  addInto(out, multiply(filter("lowpass", whiteNoise(rng, n), sr, 600), pass), 0, 0.7);
  const flutter = multiply(filter("highpass", whiteNoise(rng, n), sr, 2500), pass);
  for (let i = 0; i < n; i++) flutter[i]! *= 0.7 + 0.3 * Math.sin(2 * Math.PI * (55 + 8 * variant) * (i / sr));
  addInto(out, flutter, 0, 0.35);
  addInto(out, multiply(sine(140 * (1 + 0.12 * variant), 0.05, sr), expEnv(samples(0.05, sr), sr, 0.02)), 0, 0.5);
  return finish(out, sr);
}

/** Golpe sordo del aldeano: carne y tela con un cuerpo de madera, sin resonancia metálica. */
function blow(variant: number, rng: Rng): Float32Array {
  const sr = HI;
  const out = makeBuffer(0.3, sr);
  const n = out.length;
  addInto(out, thump(170 - variant * 25, 90, 0.2, sr, 0.05), 0, 1);
  addInto(out, lowNoise(rng, n, sr, 700, 0.02), 0, 0.7);
  addInto(out, bandNoise(rng, n, sr, 1500, 1, 0.005), 0, 0.2);
  addInto(out, modalBank([140 - variant * 12, 260, 410], [0.4, 0.25, 0.15], [0.05, 0.035, 0.025], 0.3, sr), 0, 0.5);
  return finish(out, sr);
}

/** Grito de muerte: fuente glotal con contorno de tono, formantes /a/ a /o/, soplo y jadeo final; el aldeano es más agudo. */
function death(variant: number, rng: Rng): Float32Array {
  const sr = LO;
  const villager = variant < 3;
  const k = variant % 3;
  const seconds = 0.95 + 0.18 * k;
  const n = samples(seconds, sr);
  const base = (villager ? 1.3 : 1) * (130 + 20 * k);
  const f0At = (t: number): number => {
    const rise = 1 + 0.9 * smooth(t / 0.15);
    const fall = 1 - 0.5 * Math.pow(Math.max(0, (t - 0.25) / (seconds - 0.25)), 1.2);
    return base * rise * fall * (1 + 0.03 * Math.sin(2 * Math.PI * 6.5 * t) * Math.min(1, t / 0.3));
  };
  const shift = villager ? 1.12 : 1;
  const formantsAt = (t: number): readonly number[] => {
    const m = smooth((t - 0.1) / 0.5);
    return [(700 - 250 * m) * shift, (1100 - 300 * m) * shift, 2500 * shift];
  };
  const voiced = normalize(formantFilter(glottalSource(rng, f0At, seconds, sr, 0.015, 0.04), sr, formantsAt, [1, 0.7, 0.35], 6), 1);
  addInto(voiced, filter("bandpass", whiteNoise(rng, n), sr, 900, 1.5), 0, 0.1);
  const fadeAt = seconds - 0.3;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const fade = t > fadeAt ? 0.5 * (1 + Math.cos((Math.PI * (t - fadeAt)) / 0.3)) : 1;
    voiced[i]! *= Math.min(1, t / 0.02) * fade * (1 - 0.3 * (t / seconds));
  }
  const gaspLen = samples(0.25, sr);
  addInto(voiced, multiply(filter("bandpass", whiteNoise(rng, gaspLen), sr, 1600, 1), pluckEnv(gaspLen, sr, 0.04, 0.08)), Math.round(fadeAt * sr), 0.25);
  softClip(voiced, 1.6);
  return finish(voiced, sr, 0.85);
}

/** Alarma: seis campanadas agudas seguidas (tres y tres) sobre parciales inarmónicos de bronce, sin graves. */
function bell(): Float32Array {
  const sr = HI;
  const out = makeBuffer(1.8, sr);
  const f0 = 1050;
  const ratios = [1, 1.006, 2, 2.76, 4.07, 5.43];
  const amps = [1, 0.4, 0.6, 0.5, 0.35, 0.25];
  const taus = [0.9, 0.7, 0.6, 0.4, 0.25, 0.15];
  const rng = createRng(31);
  const ring = modalBank(ratios.map((r) => f0 * r), amps, taus, 1.7, sr);
  for (const [at, gain] of [[0, 1], [0.13, 0.85], [0.26, 0.7], [0.51, 1], [0.64, 0.85], [0.77, 0.7]] as const) {
    addInto(out, ring, Math.round(at * sr), gain * 0.6);
    addInto(out, highNoise(rng, samples(0.02, sr), sr, 4000, 0.004), Math.round(at * sr), gain * 0.4);
  }
  return finish(out, sr);
}

function hammer(variant: number, rng: Rng): Float32Array {
  const sr = HI;
  const out = makeBuffer(0.3, sr);
  const n = out.length;
  addInto(out, thump(1000 + variant * 110, 700, 0.25, sr, 0.03), 0, 0.8);
  addInto(out, thump(900 + variant * 90, 650, 0.2, sr, 0.02), Math.round(0.06 * sr), 0.4);
  addInto(out, bandNoise(rng, n, sr, 1800, 1.5, 0.008), 0, 0.6);
  addInto(out, modalBank([180, 310, 520], [0.5, 0.35, 0.2], [0.06, 0.04, 0.03], 0.3, sr), 0, 0.5);
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
  addInto(out, modalBank([110, 200, 340], [0.4, 0.3, 0.2], [0.08, 0.05, 0.03], 0.35, sr), 0, 0.5);
  return finish(out, sr);
}

function pick(variant: number, rng: Rng): Float32Array {
  const sr = HI;
  const out = makeBuffer(0.3, sr);
  const n = out.length;
  const k = 1 + variant * 0.08;
  addInto(out, bandNoise(rng, n, sr, 1600, 1, 0.01), 0, 0.7);
  addInto(out, multiply(sine(600 * k, 0.3, sr), expEnv(n, sr, 0.04)), 0, 0.5);
  addInto(out, multiply(sine(1050 * k, 0.3, sr), expEnv(n, sr, 0.025)), 0, 0.25);
  addInto(out, thump(260, 130, 0.1, sr, 0.03), 0, 0.8);
  addInto(out, bandNoise(rng, n, sr, 400, 2, 0.01), 0, 0.3);
  for (let i = 0; i < 4; i++) {
    const grain = multiply(filter("lowpass", filter("highpass", whiteNoise(rng, samples(0.02, sr)), sr, 1500), sr, 3000), expEnv(samples(0.02, sr), sr, 0.005));
    addInto(out, grain, Math.round(rng.range(0.05, 0.2) * sr), 0.12);
  }
  return finish(out, sr);
}

/** Roce de follaje y chasquido de rama; el más discreto de los trabajos. */
function forage(variant: number, rng: Rng): Float32Array {
  const sr = HI;
  const out = makeBuffer(0.3, sr);
  const rustle = filter("lowpass", filter("highpass", whiteNoise(rng, samples(0.16, sr)), sr, 1000), sr, 4000 - variant * 600);
  addInto(out, multiply(rustle, pluckEnv(rustle.length, sr, 0.04, 0.06)), 0, 0.8);
  addInto(out, multiply(rustle, pluckEnv(rustle.length, sr, 0.02, 0.04)), Math.round(0.1 * sr), 0.4);
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
    phase += (f0 + (f1 - f0) * k + 6 * Math.sin((2 * Math.PI * 9 * i) / sr)) / sr;
    if (phase >= 1) phase -= 1;
    src[i] = (2 * phase - 1) * (0.7 + 0.3 * rng.next());
  }
  const swept = filterSweep("bandpass", src, sr, (t) => b0 + (b1 - b0) * (t / seconds), 5);
  const upper = filterSweep("bandpass", src, sr, (t) => 2 * (b0 + (b1 - b0) * (t / seconds)), 8);
  for (let i = 0; i < n; i++) swept[i] = (swept[i]! + 0.5 * upper[i]!) * Math.sin((Math.PI * i) / n) ** 2;
  return swept;
}

function latch(sr: number, rng: Rng, gain = 1): Float32Array {
  const n = samples(0.1, sr);
  const out = thump(75, 55, 0.1, sr, 0.04);
  addInto(out, lowNoise(rng, n, sr, 500, 0.02), 0, 0.6);
  addInto(out, modalBank([95, 170], [0.5, 0.3], [0.08, 0.05], 0.1, sr), 0, 0.5);
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

/**
 * Derrumbe: oleada de rumor, crujidos de vigas, lluvia de escombros que se densifica, un golpe final
 * que coincide con el momento en que la estructura termina de caer, polvo y asentamiento.
 * La paridad de la variante indica el tamaño (0 pequeño, 1 grande); el cociente, el timbre.
 */
function collapse(variant: number, rng: Rng): Float32Array {
  const sr = LO;
  const big = variant % 2 === 1;
  const timbre = Math.floor(variant / 2);
  const d = (big ? 3.4 : 2.2) + (big ? 0.4 : 0.3) * timbre;
  const hitAt = big ? 1.4 : 0.85;
  const out = makeBuffer(d, sr);
  const n = out.length;
  const color = timbre === 0 ? 1 : 0.85;

  const swell = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    swell[i] = t < 0.25 ? t / 0.25 : t < hitAt ? 1 : Math.exp(-(t - hitAt) / (d * 0.3));
  }
  addInto(out, multiply(filter("lowpass", brownNoise(rng, n), sr, (big ? 100 : 160) * color), swell), 0, 1);

  const beams = (big ? 10 : 5) + timbre * 2;
  for (let i = 0; i < beams; i++) {
    const len = samples(0.2, sr);
    const beam = multiply(filter("bandpass", whiteNoise(rng, len), sr, rng.range(250, 1200), 8), pluckEnv(len, sr, 0.005, 0.06));
    addInto(out, beam, Math.round(rng.range(0.05, hitAt) * sr), 0.8);
  }

  const pieces = big ? 40 : 22;
  const from = hitAt * 0.3;
  const span = d * 0.9 - from;
  for (let i = 0; i < pieces; i++) {
    const len = samples(0.12, sr);
    const at = from + span * Math.pow(rng.next(), 1.5);
    addInto(out, highNoise(rng, len, sr, 1200 * color, 0.03), Math.round(at * sr), rng.range(0.15, 0.35));
  }

  const hit = samples(0.6, sr);
  const thud = thump((big ? 62 : 80) * color, (big ? 32 : 42) * color, 0.6, sr, 0.22);
  addInto(thud, lowNoise(rng, hit, sr, 150, 0.12), 0, 0.6);
  addInto(out, thud, Math.round(hitAt * sr), 1.6);
  const dust = multiply(filter("bandpass", whiteNoise(rng, n), sr, 600, 0.5), expEnv(n, sr, 0.4));
  addInto(out, dust.subarray(0, n - Math.round(hitAt * sr)), Math.round(hitAt * sr), 0.35);
  addInto(out, thump(55 * color, 38, 0.3, sr, 0.1), Math.round((hitAt + 0.35) * sr), 0.35);
  softClip(out, 1.3);
  return finish(out, sr);
}

/** Bucle de 6 s: rumor con ráfagas lentas, siseo modulado y chasquidos graves, medios y agudos. */
function fire(rng: Rng): Float32Array {
  const sr = LO;
  const overlap = 0.4;
  const total = 6 + overlap;
  const n = samples(total, sr);
  const out = filter("lowpass", brownNoise(rng, n), sr, 400);
  const gust = filter("lowpass", whiteNoise(rng, n), sr, 1.5);
  let gustPeak = 1e-9;
  for (let i = 0; i < n; i++) gustPeak = Math.max(gustPeak, Math.abs(gust[i]!));
  for (let i = 0; i < n; i++) out[i]! *= 0.5 * (0.8 + 0.4 * Math.abs(gust[i]! / gustPeak));
  const lfo = filter("lowpass", whiteNoise(rng, n), sr, 8);
  const hiss = filter("bandpass", whiteNoise(rng, n), sr, 3000, 0.5);
  let lfoPeak = 1e-9;
  for (let i = 0; i < n; i++) lfoPeak = Math.max(lfoPeak, Math.abs(lfo[i]!));
  for (let i = 0; i < n; i++) out[i]! += hiss[i]! * Math.abs(lfo[i]! / lfoPeak) * 0.5;
  const bands: readonly (readonly [number, number])[] = [[400, 900], [1500, 3000], [3000, 6000]];
  for (let i = 0; i < total * 10; i++) {
    const [lo, hi] = bands[i % 3]!;
    const len = samples(0.02, sr);
    const crackle = multiply(filter("bandpass", whiteNoise(rng, len), sr, rng.range(lo, hi), 2), expEnv(len, sr, 0.004));
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

/** Sintetiza todos los efectos una vez; determinista para una semilla dada. El número de variantes sale de `CUES`. */
export function buildSfxBank(seed = 1): SfxBank {
  const rng = createRng(seed);
  const entry = (sampleRate: number, variants: Float32Array[]): SfxEntry => ({ sampleRate, variants });
  return {
    sword: entry(HI, variantsOf(CUES.sword.variants, sword, seed + 1)),
    arrow: entry(HI, variantsOf(CUES.arrow.variants, arrow, seed + 2)),
    blow: entry(HI, variantsOf(CUES.blow.variants, blow, seed + 3)),
    death: entry(LO, variantsOf(CUES.death.variants, death, seed + 4)),
    bell: entry(HI, [bell()]),
    hammer: entry(HI, variantsOf(CUES.hammer.variants, hammer, seed + 5)),
    axe: entry(HI, variantsOf(CUES.axe.variants, axe, seed + 6)),
    pick: entry(HI, variantsOf(CUES.pick.variants, pick, seed + 7)),
    forage: entry(HI, variantsOf(CUES.forage.variants, forage, seed + 8)),
    door: entry(LO, [door(createRng(seed + 9))]),
    collapse: entry(LO, variantsOf(CUES.collapse.variants, collapse, seed + 10)),
    victory: entry(LO, [victory(createRng(seed + 11))]),
    defeat: entry(LO, [defeat(createRng(seed + 12))]),
    fire: entry(LO, [fire(rng)]),
  };
}
