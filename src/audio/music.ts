import { addInto, createRng, makeLoop, peakOf, samples, scale, reverb } from "./dsp";
import { drone, flute, lute, psaltery, tabor } from "./instruments";

export interface MusicTrack {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

export const MUSIC_SAMPLE_RATE = 22050;
/** Negra con puntillo = 72; compás de 6/8 (seis corcheas). */
export const EIGHTH = 60 / 72 / 3;
export const BAR_SECONDS = EIGHTH * 6;
export const TOTAL_BARS = 60;

/** Clases de altura del modo dórico en re: re mi fa sol la si do. */
export const DORIAN_PITCH_CLASSES: readonly number[] = [2, 4, 5, 7, 9, 11, 0];

const NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** `A4 - - G4 - .`: nota, `-` prolonga la anterior y `.` es silencio; seis corcheas por compás. */
export function parseBar(bar: string): { midi: number; start: number; length: number }[] {
  const tokens = bar.trim().split(/\s+/);
  if (tokens.length !== 6) throw new Error(`Compás con ${tokens.length} corcheas: "${bar}"`);
  const notes: { midi: number; start: number; length: number }[] = [];
  tokens.forEach((token, i) => {
    if (token === "-") {
      const last = notes[notes.length - 1];
      if (last && last.start + last.length === i) last.length += 1;
    } else if (token !== ".") {
      const m = /^([A-G])(\d)$/.exec(token);
      if (!m) throw new Error(`Nota inválida: ${token}`);
      notes.push({ midi: 12 * (Number(m[2]) + 1) + NAMES[m[1]!]!, start: i, length: 1 });
    }
  });
  return notes;
}

type Melody = readonly string[];

export const MELODIES: Record<"A" | "A2" | "B" | "C", Melody> = {
  A: ["A4 - - G4 - F4", "E4 - - D4 - -", "F4 - G4 A4 - C5", "A4 - - - - .", "D5 - - C5 - A4", "B4 - A4 G4 - F4", "E4 - F4 G4 - E4", "D4 - - - - ."],
  A2: ["A4 - A4 G4 - F4", "E4 - F4 D4 - -", "F4 - G4 A4 - C5", "D5 - - A4 - .", "C5 - D5 E5 - D5", "C5 - A4 B4 - G4", "A4 - G4 F4 - E4", "D4 - - - - ."],
  B: ["A4 - C5 D5 - E5", "F5 - E5 D5 - C5", "B4 - D5 C5 - A4", "G4 - - A4 - .", "A4 - C5 D5 - E5", "G5 - F5 E5 - D5", "C5 - B4 A4 - G4", "A4 - - - - ."],
  C: ["D4 F4 A4 D5 A4 F4", "C4 E4 G4 C5 G4 E4", "D4 F4 A4 D5 A4 F4", "G3 B3 D4 G4 D4 B3", "D4 F4 A4 D5 A4 F4", "C4 E4 G4 C5 G4 E4", "G3 B3 D4 G4 B4 D5", "D4 - - - - ."],
};

/** Acordes (raíz, tercera, quinta) del modo dórico en re. */
export const CHORDS = {
  Dm: [50, 53, 57],
  C: [48, 52, 55],
  G: [55, 59, 62],
} as const;
type ChordName = keyof typeof CHORDS;

const PROG_A: readonly ChordName[] = ["Dm", "Dm", "Dm", "C", "Dm", "G", "C", "Dm"];
const PROG_B: readonly ChordName[] = ["Dm", "Dm", "G", "Dm", "Dm", "C", "G", "Dm"];
const PROG_CODA: readonly ChordName[] = ["Dm", "Dm", "C", "Dm", "Dm", "Dm", "C", "Dm"];

interface Section {
  name: string;
  bars: number;
  flute?: Melody;
  lute?: "arp" | Melody;
  psaltery?: "sparse" | "dense";
  drone: boolean;
  tabor: "none" | "light" | "full";
  prog: readonly ChordName[];
  /** Ganancia inicial y final (descenso lineal en la sección). */
  fade?: [number, number];
}

/** Forma de 60 compases: introducción, A, A′, B, A, C, A′ y coda (§4.6 del SDD). */
export const SECTIONS: readonly Section[] = [
  { name: "Introducción", bars: 4, drone: true, tabor: "light", prog: PROG_A },
  { name: "A", bars: 8, flute: MELODIES.A, drone: true, tabor: "light", prog: PROG_A },
  { name: "A′", bars: 8, flute: MELODIES.A2, lute: "arp", drone: true, tabor: "light", prog: PROG_A },
  { name: "B", bars: 8, flute: MELODIES.B, lute: "arp", psaltery: "dense", drone: true, tabor: "full", prog: PROG_B },
  { name: "A", bars: 8, flute: MELODIES.A, lute: "arp", psaltery: "sparse", drone: true, tabor: "full", prog: PROG_A },
  { name: "C", bars: 8, lute: MELODIES.C, drone: true, tabor: "light", prog: PROG_A },
  { name: "A′", bars: 8, flute: MELODIES.A2, lute: "arp", psaltery: "sparse", drone: true, tabor: "full", prog: PROG_A },
  { name: "Coda", bars: 8, lute: "arp", drone: true, tabor: "none", prog: PROG_CODA, fade: [1, 0.4] },
];

export interface ScoreNote {
  track: "flute" | "lute" | "psaltery" | "drone";
  midi: number;
  /** Segundos desde el inicio de la pieza. */
  at: number;
  seconds: number;
  gain: number;
}

export interface TaborHit {
  at: number;
  gain: number;
  soft: boolean;
}

/** Partitura como datos: notas por instrumento y golpes de tamboril. */
export function buildScore(maxBars = TOTAL_BARS): { notes: ScoreNote[]; hits: TaborHit[]; bars: number } {
  const notes: ScoreNote[] = [];
  const hits: TaborHit[] = [];
  let bar = 0;
  for (const section of SECTIONS) {
    const sectionStart = bar;
    for (let b = 0; b < section.bars && bar < maxBars; b++, bar++) {
      const t0 = bar * BAR_SECONDS;
      const level = section.fade ? section.fade[0] + ((section.fade[1] - section.fade[0]) * b) / section.bars : 1;
      const chord = CHORDS[section.prog[b % section.prog.length]!];

      if (section.flute) {
        for (const n of parseBar(section.flute[b % 8]!)) notes.push({ track: "flute", midi: n.midi, at: t0 + n.start * EIGHTH, seconds: n.length * EIGHTH + 0.08, gain: 0.8 * level });
      }
      if (section.lute === "arp") {
        const pattern = [chord[0], chord[2], chord[1] + 12, chord[2], chord[1] + 12, chord[2]];
        pattern.forEach((midi, i) => notes.push({ track: "lute", midi, at: t0 + i * EIGHTH, seconds: 1.1, gain: (i === 0 ? 0.75 : 0.55) * level }));
      } else if (section.lute) {
        for (const n of parseBar(section.lute[b % 8]!)) notes.push({ track: "lute", midi: n.midi, at: t0 + n.start * EIGHTH, seconds: 1.1, gain: 0.8 * level });
      }
      if (section.psaltery) {
        const steps = section.psaltery === "dense" ? [0, 2, 3, 5] : [0, 3];
        steps.forEach((s, i) => notes.push({ track: "psaltery", midi: chord[i % 2 === 0 ? 2 : 1] + 12, at: t0 + s * EIGHTH, seconds: 1.3, gain: 0.42 * level }));
      }
      if (section.tabor !== "none") {
        const pattern = section.tabor === "full" ? [[0, 1], [3, 0.7], [5, 0.4]] : [[0, 0.7], [3, 0.4]];
        for (const [s, g] of pattern) hits.push({ at: t0 + s! * EIGHTH, gain: g! * 0.5, soft: section.tabor === "light" });
      }
    }
    // El bordón se renueva cada cuatro compases con solape para no abrirse nunca.
    if (section.drone) {
      for (let b = 0; b < section.bars; b += 4) {
        const first = sectionStart + b;
        if (first >= maxBars) break;
        const len = Math.min(4, section.bars - b, maxBars - first);
        for (const midi of [50, 57]) notes.push({ track: "drone", midi, at: first * BAR_SECONDS - 0.5, seconds: len * BAR_SECONDS + 1, gain: 0.3 });
      }
    }
  }
  return { notes, hits, bars: Math.min(bar, maxBars) };
}

const PAN: Record<ScoreNote["track"], number> = { flute: 0.1, lute: -0.35, psaltery: 0.4, drone: 0 };
const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * Sintetiza la pieza en estéreo y en bucle. Determinista: solo usa el PRNG de `dsp.ts`.
 * `maxBars` permite renderizar un fragmento (pruebas).
 */
export function renderMusic(seed = 7, maxBars = TOTAL_BARS): MusicTrack {
  const sr = MUSIC_SAMPLE_RATE;
  const rng = createRng(seed);
  const { notes, hits, bars } = buildScore(maxBars);
  const tail = 3.5;
  const length = samples(bars * BAR_SECONDS + 2, sr);
  const dryL = new Float32Array(length);
  const dryR = new Float32Array(length);
  const mixIn = (buf: Float32Array, at: number, gain: number, pan: number): void => {
    const angle = ((pan + 1) * Math.PI) / 4;
    const offset = Math.round(Math.max(0, at) * sr);
    addInto(dryL, buf, offset, gain * Math.cos(angle));
    addInto(dryR, buf, offset, gain * Math.sin(angle));
  };

  for (const n of notes) {
    const inst = n.track === "flute" ? flute : n.track === "lute" ? lute : n.track === "psaltery" ? psaltery : drone;
    mixIn(inst(hz(n.midi), n.seconds, sr, rng), n.at, n.gain * (n.track === "drone" ? 1 : 0.8), PAN[n.track]);
  }
  for (const h of hits) mixIn(tabor(sr, rng, h.soft), h.at, h.gain, 0.15);

  const wetL = reverb(dryL, sr, 0.18, 0, tail);
  const wetR = reverb(dryR, sr, 0.18, 23, tail);
  const overlap = samples(tail + 2, sr);
  let left = makeLoop(wetL, Math.min(overlap, wetL.length - 1));
  let right = makeLoop(wetR, Math.min(overlap, wetR.length - 1));
  const peak = Math.max(peakOf(left), peakOf(right), 1e-9);
  left = scale(left, 0.8 / peak);
  right = scale(right, 0.8 / peak);
  return { left, right, sampleRate: sr };
}
