import { beforeAll, describe, expect, it } from "vitest";
import {
  BIRD_COMBAT_SILENCE,
  BIRD_MAX_INTERVAL,
  BIRD_MIN_INTERVAL,
  BirdScheduler,
  type BirdInput,
} from "../../src/audio/ambient";
import { createRng } from "../../src/audio/dsp";
import { buildSfxBank, type SfxBank } from "../../src/audio/sfx";
import { CUES } from "../../src/audio/voices";

let bank: SfxBank;
beforeAll(() => {
  bank = buildSfxBank();
}, 60000);

const peak = (a: Float32Array): number => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** Centroide espectral con una DFT por bloques de 2048 muestras (suficiente para distinguir agudos de graves). */
function centroid(a: Float32Array, sr: number): number {
  const size = 1024;
  let num = 0;
  let den = 0;
  for (let from = 0; from + size <= a.length; from += size) {
    for (let k = 4; k < size / 2; k += 2) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < size; i++) {
        const w = (2 * Math.PI * k * i) / size;
        const s = a[from + i]!;
        re += s * Math.cos(w);
        im -= s * Math.sin(w);
      }
      const mag = re * re + im * im;
      num += ((k * sr) / size) * mag;
      den += mag;
    }
  }
  return den > 0 ? num / den : 0;
}

/** Tramo más largo (s) de ventanas de 25 ms con RMS mayor que el 20 % de la ventana más fuerte. */
function longestRun(a: Float32Array, sr: number): number {
  const win = Math.round(0.025 * sr);
  const rms: number[] = [];
  for (let from = 0; from + win <= a.length; from += win) {
    let s = 0;
    for (let i = 0; i < win; i++) s += a[from + i]! ** 2;
    rms.push(Math.sqrt(s / win));
  }
  const top = Math.max(...rms);
  let best = 0;
  let run = 0;
  for (const r of rms) {
    run = r > top * 0.2 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return (best * win) / sr;
}

describe("P7 cantos de ave: señal", () => {
  it("hay 12 variantes finitas, sin saturar, con silencio en los extremos", () => {
    const entry = bank.bird;
    expect(entry.variants).toHaveLength(CUES.bird.variants);
    for (const v of entry.variants) {
      expect(v.every(Number.isFinite)).toBe(true);
      expect(peak(v)).toBeLessThanOrEqual(0.98);
      expect(peak(v)).toBeGreaterThan(0.5);
      expect(Math.abs(v[0]!)).toBeLessThan(0.02);
      expect(Math.abs(v[v.length - 1]!)).toBeLessThan(0.02);
    }
  });

  it("duran como mucho 1,4 s y ningún tramo sonoro continuo supera 0,5 s (no es un silbido sostenido)", () => {
    const sr = bank.bird.sampleRate;
    for (const v of bank.bird.variants) {
      expect(v.length / sr).toBeLessThanOrEqual(1.4);
      expect(longestRun(v, sr)).toBeLessThanOrEqual(0.5);
    }
  });

  it("la energía es aguda (centroide ≥ 1,8 kHz) salvo el arrullo, que es grave pero audible (≥ 350 Hz)", () => {
    const sr = bank.bird.sampleRate;
    bank.bird.variants.forEach((v, i) => {
      const c = centroid(v, sr);
      if (i % 4 === 3) expect(c, `arrullo ${i}`).toBeGreaterThanOrEqual(350);
      else expect(c, `canto ${i}`).toBeGreaterThanOrEqual(1800);
      expect(c).toBeLessThan(8000);
    });
  });

  it("es determinista para la misma semilla y distinto con otra", () => {
    const again = buildSfxBank();
    bank.bird.variants.forEach((v, i) => expect(again.bird.variants[i]).toEqual(v));
    expect(buildSfxBank(2).bird.variants[1]).not.toEqual(bank.bird.variants[1]);
  });

  it("las cuatro especies se distinguen entre sí", () => {
    const sr = bank.bird.sampleRate;
    const c = [0, 1, 2, 3].map((i) => centroid(bank.bird.variants[i]!, sr));
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(Math.abs(c[i]! - c[j]!)).toBeGreaterThan(80);
  });
});

const trees = [{ x: 10, z: 10 }];
const onScreen = (): { x: number; y: number } => ({ x: 0.2, y: 0.1 });
const offScreen = (): { x: number; y: number } => ({ x: 3, y: 3 });

const input = (over: Partial<BirdInput> = {}): BirdInput => ({ dt: 0.05, active: true, combatVisible: false, trees, project: onScreen, ...over });

/** Avanza `seconds` de reloj en pasos de 50 ms y devuelve el segundo de cada canto. */
function run(scheduler: BirdScheduler, seconds: number, make: (t: number) => Partial<BirdInput> = () => ({})): { at: number; request: NonNullable<ReturnType<BirdScheduler["update"]>> }[] {
  const out: { at: number; request: NonNullable<ReturnType<BirdScheduler["update"]>> }[] = [];
  for (let t = 0; t < seconds; t += 0.05) {
    const request = scheduler.update(input({ dt: 0.05, ...make(t) }));
    if (request) out.push({ at: t, request });
  }
  return out;
}

describe("P7 cantos de ave: planificador", () => {
  it("canta entre 3 y 11 s si hay árboles a la vista, en el rango de variantes y sin repetir la anterior", () => {
    const calls = run(new BirdScheduler(createRng(1)), 600);
    expect(calls.length).toBeGreaterThan(40);
    for (let i = 1; i < calls.length; i++) {
      const gap = calls[i]!.at - calls[i - 1]!.at;
      expect(gap).toBeGreaterThanOrEqual(BIRD_MIN_INTERVAL - 0.06);
      expect(gap).toBeLessThanOrEqual(BIRD_MAX_INTERVAL + 0.06);
      expect(calls[i]!.request.variant).not.toBe(calls[i - 1]!.request.variant);
    }
    for (const { request } of calls) {
      expect(request.cue).toBe("bird");
      expect(request.variant).toBeGreaterThanOrEqual(0);
      expect(request.variant).toBeLessThan(CUES.bird.variants);
      expect(Math.abs(request.pan)).toBeLessThanOrEqual(0.7);
    }
  });

  it("sin árboles a la vista canta la mitad de a menudo y más lejano, apagado y reverberado", () => {
    const near = run(new BirdScheduler(createRng(2)), 1200);
    const far = run(new BirdScheduler(createRng(2)), 1200, () => ({ project: offScreen }));
    expect(far.length).toBeLessThan(near.length * 0.65);
    expect(far.length).toBeGreaterThan(near.length * 0.3);
    const meanGain = (calls: typeof near): number => calls.reduce((s, c) => s + c.request.gain, 0) / calls.length;
    expect(meanGain(far)).toBeLessThan(meanGain(near) * 0.75);
    for (const { request } of far) {
      expect(request.lowpass).toBeLessThan(18000);
      expect(request.wet!).toBeGreaterThan(CUES.bird.wet);
    }
  });

  it("con un mapa sin árboles también canta, a distancia", () => {
    const calls = run(new BirdScheduler(createRng(3)), 300, () => ({ trees: [] }));
    expect(calls.length).toBeGreaterThan(5);
  });

  it("calla 6 s tras un combate visible y se reanuda después", () => {
    const s = new BirdScheduler(createRng(4));
    run(s, 20);
    s.update(input({ combatVisible: true }));
    const after = run(s, 40);
    expect(after.length).toBeGreaterThan(0);
    expect(after[0]!.at).toBeGreaterThanOrEqual(BIRD_COMBAT_SILENCE - 0.15);
  });

  it("un combate continuo mantiene el silencio", () => {
    expect(run(new BirdScheduler(createRng(5)), 120, () => ({ combatVisible: true }))).toHaveLength(0);
  });

  it("en pausa, terminada la partida, sin sonido o silenciado el reloj se detiene y no canta", () => {
    const s = new BirdScheduler(createRng(6));
    expect(run(s, 120, () => ({ active: false }))).toHaveLength(0);
    // Al reanudar, el temporizador sigue donde estaba: el primer canto llega dentro del intervalo normal.
    const resumed = run(s, 12);
    expect(resumed.length).toBeGreaterThan(0);
    expect(resumed[0]!.at).toBeLessThanOrEqual(BIRD_MAX_INTERVAL + 0.1);
  });

  it("un cuadro enorme no adelanta los cantos (dt acotado a 0,25 s)", () => {
    const s = new BirdScheduler(createRng(7));
    expect(s.update(input({ dt: 60 }))).toBeNull();
  });

  it("es determinista con el mismo azar y reiniciable", () => {
    const a = run(new BirdScheduler(createRng(8)), 200).map((c) => [c.at, c.request.variant]);
    const b = run(new BirdScheduler(createRng(8)), 200).map((c) => [c.at, c.request.variant]);
    expect(a).toEqual(b);
    const s = new BirdScheduler(createRng(9));
    run(s, 30);
    s.reset();
    expect(s.update(input({ combatVisible: false }))).toBeNull();
  });
});
