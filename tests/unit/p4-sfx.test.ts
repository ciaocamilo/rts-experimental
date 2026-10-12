import { beforeAll, describe, expect, it } from "vitest";
import { buildSfxBank, type SfxBank } from "../../src/audio/sfx";
import { CUES, type CueId } from "../../src/audio/voices";

let bank: SfxBank;
beforeAll(() => {
  bank = buildSfxBank();
}, 60000);

const peak = (a: Float32Array): number => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const seconds = (id: CueId, v = 0): number => bank[id].variants[v]!.length / bank[id].sampleRate;

/** Potencia de la frecuencia `f` en `a[from, to)` (algoritmo de Goertzel). */
function goertzel(a: Float32Array, sr: number, f: number, from: number, to: number): number {
  const w = (2 * Math.PI * f) / sr;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = from; i < to; i++) {
    const s = a[i]! + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

describe("banco de efectos", () => {
  it("tiene todos los cues con el número de variantes previsto", () => {
    for (const id of Object.keys(CUES) as CueId[]) expect(bank[id].variants).toHaveLength(CUES[id].variants);
  });

  it("es finito, no satura y no es silencio", () => {
    for (const id of Object.keys(CUES) as CueId[]) {
      for (const v of bank[id].variants) {
        expect(v.every(Number.isFinite), id).toBe(true);
        expect(peak(v), id).toBeLessThanOrEqual(0.98);
        expect(peak(v), id).toBeGreaterThan(0.2);
      }
    }
  });

  it("es determinista para la misma semilla", () => {
    const again = buildSfxBank();
    for (const id of ["sword", "death", "collapse", "bell"] as const) expect(again[id].variants[0]).toEqual(bank[id].variants[0]);
  });

  it("empieza y acaba en silencio (sin clics) salvo el bucle de fuego", () => {
    for (const id of Object.keys(CUES) as CueId[]) {
      if (id === "fire") continue;
      for (const v of bank[id].variants) {
        expect(Math.abs(v[0]!), id).toBeLessThan(0.02);
        expect(Math.abs(v[v.length - 1]!), id).toBeLessThan(0.02);
      }
    }
  });

  it("la pica no suena a campanilla: la cola tiene más energía grave que aguda", () => {
    for (const id of ["pick"] as const) {
      const sr = bank[id].sampleRate;
      for (const v of bank[id].variants) {
        const from = Math.round(0.03 * sr);
        const to = Math.round(0.25 * sr);
        const band = (lo: number, hi: number): number => {
          let sum = 0;
          let count = 0;
          for (let f = lo; f <= hi; f += 100) {
            sum += goertzel(v, sr, f, from, to);
            count += 1;
          }
          return sum / count;
        };
        expect(band(200, 1400), id).toBeGreaterThan(band(2000, 4000) * 4);
      }
    }
  });

  it("respeta las duraciones del SDD", () => {
    for (const id of ["hammer", "axe", "pick", "forage"] as const) for (let v = 0; v < CUES[id].variants; v++) expect(seconds(id, v), id).toBeLessThanOrEqual(id === "hammer" ? 0.45 : 0.35);
    expect(seconds("door")).toBeLessThanOrEqual(1.2);
    expect(seconds("victory")).toBeGreaterThan(3.5);
    expect(seconds("victory")).toBeLessThan(5.2);
    expect(seconds("defeat")).toBeGreaterThan(4.5);
    expect(seconds("defeat")).toBeLessThan(6.2);
    expect(seconds("collapse", 1)).toBeGreaterThan(seconds("collapse", 0));
  });

  it("la campana tiene su fundamental cerca de 1050 Hz y el bucle de fuego enlaza", () => {
    const sr = bank.bell.sampleRate;
    const b = bank.bell.variants[0]!;
    const end = Math.round(0.4 * sr);
    const at = goertzel(b, sr, 1050, 0, end);
    expect(at).toBeGreaterThan(goertzel(b, sr, 900, 0, end) * 3);
    expect(at).toBeGreaterThan(goertzel(b, sr, 1200, 0, end) * 3);

    const f = bank.fire.variants[0]!;
    // El salto entre la última y la primera muestra es comparable al de dos muestras contiguas.
    let typical = 0;
    for (let i = 1; i < 2000; i++) typical = Math.max(typical, Math.abs(f[i]! - f[i - 1]!));
    expect(Math.abs(f[0]! - f[f.length - 1]!)).toBeLessThanOrEqual(typical * 2 + 0.01);
    expect(seconds("fire")).toBeGreaterThanOrEqual(5.5);
  });

  it("la memoria total del banco queda por debajo de 7,5 MB (presupuesto de P6)", () => {
    let bytes = 0;
    for (const id of Object.keys(CUES) as CueId[]) for (const v of bank[id].variants) bytes += v.byteLength;
    expect(bytes).toBeLessThan(7.5 * 1024 * 1024);
  });
});
