import { beforeAll, describe, expect, it } from "vitest";
import { CueTranslator, flightSeconds, SALVO_GAP, type AudioFrame } from "../../src/audio/cues";
import { allFinite, peakOf } from "../../src/audio/dsp";
import { buildSfxBank, type SfxBank } from "../../src/audio/sfx";
import { CUES } from "../../src/audio/voices";
import { createEmptyState } from "../../src/core/state";
import type { StrikeEvent } from "../../src/core/types";

let bank: SfxBank;
beforeAll(() => {
  bank = buildSfxBank();
}, 60000);

/** Espectro de potencia (FFT radix-2; solo el 25 % final se atenúa para no ocultar el golpe inicial) de `a` entre `from` y `to` segundos. */
function spectrum(a: Float32Array, sr: number, from = 0, to = a.length / sr): { freqs: Float64Array; power: Float64Array } {
  const i0 = Math.round(from * sr);
  const i1 = Math.min(a.length, Math.round(to * sr));
  let size = 1;
  while (size < i1 - i0) size *= 2;
  size *= 2;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const len = i1 - i0;
  for (let i = 0; i < len; i++) re[i] = a[i0 + i]! * (i < 0.75 * len ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (i - 0.75 * len)) / (0.25 * len)));
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let m = 2; m <= size; m <<= 1) {
    const ang = (-2 * Math.PI) / m;
    for (let s = 0; s < size; s += m) {
      for (let k = 0; k < m / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a0 = s + k;
        const b0 = s + k + m / 2;
        const tr = re[b0]! * wr - im[b0]! * wi;
        const ti = re[b0]! * wi + im[b0]! * wr;
        re[b0] = re[a0]! - tr;
        im[b0] = im[a0]! - ti;
        re[a0]! += tr;
        im[a0]! += ti;
      }
    }
  }
  const half = size / 2;
  const freqs = new Float64Array(half);
  const power = new Float64Array(half);
  for (let k = 1; k < half; k++) {
    freqs[k] = (k * sr) / size;
    power[k] = re[k]! * re[k]! + im[k]! * im[k]!;
  }
  return { freqs, power };
}

const centroid = (a: Float32Array, sr: number): number => {
  const { freqs, power } = spectrum(a, sr);
  let num = 0;
  let den = 0;
  for (let k = 0; k < freqs.length; k++) {
    num += freqs[k]! * power[k]!;
    den += power[k]!;
  }
  return num / den;
};
const energy = (a: Float32Array, sr: number, from: number, to: number): number => {
  let sum = 0;
  for (let i = Math.round(from * sr); i < Math.min(a.length, Math.round(to * sr)); i++) sum += a[i]! * a[i]!;
  return sum;
};
const rms = (a: Float32Array, sr: number, from: number, to: number): number => Math.sqrt(energy(a, sr, from, to) / Math.max(1, Math.round((to - from) * sr)));
const peakIn = (a: Float32Array, sr: number, from: number, to: number): number => {
  let p = 0;
  for (let i = Math.round(from * sr); i < Math.min(a.length, Math.round(to * sr)); i++) p = Math.max(p, Math.abs(a[i]!));
  return p;
};
const db = (ratio: number): number => 20 * Math.log10(ratio);
/** Mayor fracción de la energía que cae en una banda de `fraction` de octava (barrido por octavas desde 100 Hz). */
function strongestBand(a: Float32Array, sr: number, from: number, to: number, fraction: number): number {
  const { freqs, power } = spectrum(a, sr, from, to);
  let total = 0;
  for (let k = 0; k < power.length; k++) total += power[k]!;
  let best = 0;
  const step = Math.pow(2, fraction / 4);
  for (let lo = 100; lo < sr / 2; lo *= step) {
    const hi = lo * Math.pow(2, fraction);
    let sum = 0;
    for (let k = 0; k < freqs.length; k++) if (freqs[k]! >= lo && freqs[k]! < hi) sum += power[k]!;
    best = Math.max(best, sum / total);
  }
  return best;
}
const bandShare = (a: Float32Array, sr: number, lo: number, hi: number): number => {
  const { freqs, power } = spectrum(a, sr);
  let part = 0;
  let total = 0;
  for (let k = 0; k < freqs.length; k++) {
    total += power[k]!;
    if (freqs[k]! >= lo && freqs[k]! < hi) part += power[k]!;
  }
  return part / total;
};

describe("P6 martillo", () => {
  it("seis variantes finitas, de 0,45 s como máximo y deterministas", () => {
    expect(bank.hammer.variants).toHaveLength(6);
    const again = buildSfxBank();
    bank.hammer.variants.forEach((v, i) => {
      expect(v.length / bank.hammer.sampleRate).toBeLessThanOrEqual(0.45 + 1e-6);
      expect(allFinite(v)).toBe(true);
      expect(peakOf(v)).toBeLessThanOrEqual(0.98);
      expect(v).toEqual(again.hammer.variants[i]);
    });
  });

  it("madera y metal: centroide entre 1,2 y 3,5 kHz, golpe temprano, cola apagada y espectro repartido", () => {
    const sr = bank.hammer.sampleRate;
    bank.hammer.variants.forEach((v, i) => {
      const c = centroid(v, sr);
      expect(c, `centroide ${i}`).toBeGreaterThan(1200);
      expect(c, `centroide ${i}`).toBeLessThan(3500);
      expect(energy(v, sr, 0, 0.06) / energy(v, sr, 0, 1), `energía temprana ${i}`).toBeGreaterThanOrEqual(0.4);
      expect(db(peakIn(v, sr, 0.35, 0.45) / peakOf(v)), `cola ${i}`).toBeLessThanOrEqual(-35);
      expect(strongestBand(v, sr, 0, v.length / sr, 1 / 3), `banda ${i}`).toBeLessThanOrEqual(0.45);
    });
  });
});

describe("P6 espada", () => {
  it("ocho variantes finitas, de 0,7 s como máximo y deterministas", () => {
    expect(bank.sword.variants).toHaveLength(8);
    const again = buildSfxBank();
    bank.sword.variants.forEach((v, i) => {
      expect(v.length / bank.sword.sampleRate).toBeLessThanOrEqual(0.7 + 1e-6);
      expect(allFinite(v)).toBe(true);
      expect(peakOf(v)).toBeLessThanOrEqual(0.98);
      expect(v).toEqual(again.sword.variants[i]);
    });
  });

  it("acero: brillante, sin tono sostenido y con cola que se apaga", () => {
    const sr = bank.sword.sampleRate;
    bank.sword.variants.forEach((v, i) => {
      expect(centroid(v, sr), `centroide ${i}`).toBeGreaterThanOrEqual(2500);
      expect(bandShare(v, sr, 2000, 10000), `2-10 kHz ${i}`).toBeGreaterThanOrEqual(0.35);
      expect(strongestBand(v, sr, 0.1, v.length / sr, 1 / 12), `banda tras 100 ms ${i}`).toBeLessThanOrEqual(0.3);
      expect(db(rms(v, sr, 0.5, 0.7) / rms(v, sr, 0, 0.05)), `cola ${i}`).toBeLessThanOrEqual(-40);
    });
  });
});

describe("P6 flecha", () => {
  it("seis variantes de 0,35 a 0,45 s", () => {
    expect(bank.arrow.variants).toHaveLength(6);
    for (const v of bank.arrow.variants) {
      const seconds = v.length / bank.arrow.sampleRate;
      expect(seconds).toBeGreaterThanOrEqual(0.35);
      expect(seconds).toBeLessThanOrEqual(0.45);
      expect(allFinite(v)).toBe(true);
      expect(peakOf(v)).toBeLessThanOrEqual(0.98);
    }
  });

  it("disparo: energía en los primeros 120 ms y cola 12 dB por debajo del pico", () => {
    const sr = bank.arrow.sampleRate;
    bank.arrow.variants.forEach((v, i) => {
      expect(energy(v, sr, 0, 0.12) / energy(v, sr, 0, 1), `energía ${i}`).toBeGreaterThanOrEqual(0.6);
      expect(db(peakIn(v, sr, 0.15, 0.4) / peakOf(v)), `cola ${i}`).toBeLessThanOrEqual(-12);
    });
  });

  it("impacto: tres variantes de 0,2 s como máximo, finitas y de poco peso", () => {
    expect(bank.arrowHit.variants).toHaveLength(3);
    expect(CUES.arrowHit).toMatchObject({ priority: 2, cap: 6, minGap: 0.05, gain: 0.5, wet: 0.1 });
    for (const v of bank.arrowHit.variants) {
      expect(v.length / bank.arrowHit.sampleRate).toBeLessThanOrEqual(0.2 + 1e-6);
      expect(allFinite(v)).toBe(true);
      expect(peakOf(v)).toBeLessThanOrEqual(0.98);
    }
  });
});

describe("P6 traductor de flechas", () => {
  const strike = (id: number, from: { x: number; z: number }, to: { x: number; z: number }, kind: StrikeEvent["attackerKind"], attackerId = id): StrikeEvent & { id: number } =>
    ({ id, tick: 5, attackerId, attackerKind: kind, attackerOwner: 0, targetOwner: 1, from, to }) as unknown as StrikeEvent & { id: number };
  // La vista proyecta x/40 e y 0: visible si |x| <= 1,05.
  const frame = (strikes: (StrikeEvent & { id: number })[]): AudioFrame => ({
    state: createEmptyState(1),
    strikes,
    deaths: [],
    spawns: [],
    works: [],
    destroyed: [],
    project: (x) => ({ x: x / 40, y: 0 }),
  });

  it("un arquero emite disparo e impacto con el retardo del vuelo y el panorama del blanco", () => {
    const out = new CueTranslator(7).process(frame([strike(1, { x: -20, z: 0 }, { x: 20, z: 0 }, "archer")]));
    expect(out.map((r) => r.cue)).toEqual(["arrow", "arrowHit"]);
    const [shot, hit] = out as [(typeof out)[number], (typeof out)[number]];
    expect(shot.delay).toBe(0);
    expect(hit.delay).toBeCloseTo(flightSeconds(40), 6);
    expect(shot.pan).toBeLessThan(0);
    expect(hit.pan).toBeGreaterThan(0);
  });

  it("el impacto solo suena si el blanco está en pantalla; el disparo depende del origen", () => {
    const t = new CueTranslator(7);
    expect(t.process(frame([strike(1, { x: 0, z: 0 }, { x: 80, z: 0 }, "archer")])).map((r) => r.cue)).toEqual(["arrow"]);
    expect(t.process(frame([strike(2, { x: 80, z: 0 }, { x: 0, z: 0 }, "archer")])).map((r) => r.cue)).toEqual([]);
  });

  it("la salva de la torre produce tres pares disparo e impacto separados por SALVO_GAP", () => {
    const out = new CueTranslator(3).process(frame([1, 2, 3].map((id) => strike(id, { x: 0, z: 0 }, { x: 10, z: 0 }, "tower", 9))));
    expect(out.filter((r) => r.cue === "arrow").map((r) => r.delay)).toEqual([0, SALVO_GAP, 2 * SALVO_GAP]);
    expect(out.filter((r) => r.cue === "arrowHit").map((r) => r.delay)).toEqual([0, SALVO_GAP, 2 * SALVO_GAP].map((d) => d + flightSeconds(10)));
  });
});
