import { beforeAll, describe, expect, it } from "vitest";
import { CueTranslator, type AudioFrame } from "../../src/audio/cues";
import { filter, goertzel } from "../../src/audio/dsp";
import { buildSfxBank, type SfxBank } from "../../src/audio/sfx";
import { CUES } from "../../src/audio/voices";
import { createEmptyState } from "../../src/core/state";
import type { DeathEvent } from "../../src/core/types";

const project = (x: number, z: number): { x: number; y: number } => ({ x: (x - 20) / 20, y: (z - 20) / 20 });
const IN = { x: 20, z: 20 };

const frame = (deaths: (DeathEvent & { seq: number })[]): AudioFrame => ({ state: createEmptyState(1, 40), strikes: [], deaths, spawns: [], works: [], destroyed: [], project });
const death = (kind: DeathEvent["kind"], owner: 0 | 1): DeathEvent & { seq: number } => ({ seq: 1, tick: 1, id: 3, owner, kind, gender: "male", pos: IN });

describe("P10 ajustes de audio: la muerte de la caballería suena humana", () => {
  it.each(["knight", "commander"] as const)("la muerte de %s emite el grito humano y no el relincho", (kind) => {
    for (const owner of [0, 1] as const) {
      const out = new CueTranslator(1).process(frame([death(kind, owner)]));
      expect(out.map((r) => r.cue)).not.toContain("neigh");
      const voice = out.filter((r) => r.cue === "death");
      expect(voice).toHaveLength(1);
      // Mismas variantes masculinas que el resto de combatientes (3 a 5).
      expect(voice[0]!.variant).toBeGreaterThanOrEqual(3);
      expect(voice[0]!.variant).toBeLessThanOrEqual(5);
    }
  });

  it("el comandante propio conserva el cuerno grave al morir", () => {
    const out = new CueTranslator(1).process(frame([death("commander", 0)]));
    expect(out.map((r) => r.cue)).toEqual(["horn", "death"]);
    expect(out[0]!.variant).toBe(1);
    expect(new CueTranslator(1).process(frame([death("commander", 1)])).map((r) => r.cue)).toEqual(["death"]);
  });
});

describe("P10 ajustes de audio: cañón y relincho", () => {
  let bank: SfxBank;
  beforeAll(() => {
    bank = buildSfxBank(1);
  }, 60000);

  const energy = (a: Float32Array): number => a.reduce((s, x) => s + x * x, 0);
  const bassShare = (a: Float32Array, sr: number, cutoff: number): number => energy(filter("lowpass", filter("lowpass", a, sr, cutoff), sr, cutoff)) / energy(a);
  const centroid = (a: Float32Array, sr: number): number => {
    let num = 0;
    let den = 0;
    for (let f = 25; f < 8000; f *= 1.1) {
      const p = goertzel(a, sr, f) ** 2;
      num += f * p;
      den += p;
    }
    return num / den;
  };
  const peak = (a: Float32Array): number => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

  it("el disparo del cañón es más grave que antes (antes: <100 Hz ≈ 13-20 %, centroide ≈ 107-126 Hz)", () => {
    const sr = bank.cannon.sampleRate;
    for (const v of bank.cannon.variants) {
      expect(bassShare(v, sr, 100)).toBeGreaterThan(0.4);
      expect(bassShare(v, sr, 200)).toBeGreaterThan(0.88);
      expect(centroid(v, sr)).toBeLessThan(85);
    }
  });

  it("el cañón tiene transitorio explosivo, retumbo largo y no satura", () => {
    const sr = bank.cannon.sampleRate;
    for (const v of bank.cannon.variants) {
      expect(peak(v)).toBeLessThanOrEqual(0.98);
      expect(v.length / sr).toBeGreaterThan(1.2);
      expect(v.length / sr).toBeLessThanOrEqual(1.6);
      const window = (from: number, to: number): number => energy(v.subarray(Math.round(from * sr), Math.round(to * sr)));
      // El ataque (primeros 60 ms) es mucho más fuerte que la cola, que aún retumba a los 0,6 s.
      expect(window(0, 0.06) / 0.06).toBeGreaterThan((window(0.9, 1.2) / 0.3) * 20);
      expect(window(0.6, 0.9)).toBeGreaterThan(0);
    }
  });

  it("el relincho tiene 4 variantes distintas, de 0,9 a 1,3 s, con tono agudo y sin graves", () => {
    expect(CUES.neigh.variants).toBe(4);
    expect(bank.neigh.variants).toHaveLength(4);
    const sr = bank.neigh.sampleRate;
    const lengths = new Set<number>();
    bank.neigh.variants.forEach((v, i) => {
      lengths.add(v.length);
      expect(v.length / sr).toBeGreaterThanOrEqual(0.9);
      expect(v.length / sr).toBeLessThanOrEqual(1.3);
      expect(peak(v)).toBeLessThanOrEqual(0.98);
      expect(v.every(Number.isFinite)).toBe(true);
      expect(bassShare(v, sr, 200)).toBeLessThan(0.02);
      expect(centroid(v, sr)).toBeGreaterThan(600);
      for (let j = i + 1; j < bank.neigh.variants.length; j++) expect(bank.neigh.variants[j]).not.toEqual(v);
    });
    expect(lengths.size).toBe(4);
  });

  it("el relincho sube y luego cae de tono: el pico del chillido supera al del descenso", () => {
    const sr = bank.neigh.sampleRate;
    const dominant = (v: Float32Array, from: number, to: number): number => {
      const seg = v.subarray(Math.round(from * sr), Math.round(to * sr));
      let best = 0;
      let freq = 0;
      for (let f = 200; f < 1400; f += 10) {
        const g = goertzel(seg, sr, f);
        if (g > best) {
          best = g;
          freq = f;
        }
      }
      return freq;
    };
    for (const v of bank.neigh.variants) {
      const len = v.length / sr;
      expect(dominant(v, 0.35, 0.45)).toBeGreaterThan(dominant(v, 0, 0.06) - 1);
      expect(dominant(v, 0.35, 0.45)).toBeGreaterThan(dominant(v, 0.62 * len, 0.72 * len));
    }
  });

  it("el banco sigue siendo determinista y cabe en 8,5 MB", () => {
    expect(buildSfxBank(1).cannon.variants[0]).toEqual(bank.cannon.variants[0]);
    expect(buildSfxBank(1).neigh.variants[2]).toEqual(bank.neigh.variants[2]);
    let bytes = 0;
    for (const id of Object.keys(CUES) as (keyof typeof CUES)[]) for (const v of bank[id].variants) bytes += v.byteLength;
    expect(bytes).toBeLessThan(8.5 * 1024 * 1024);
  });
});
