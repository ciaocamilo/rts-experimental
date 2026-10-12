import { beforeAll, describe, expect, it } from "vitest";
import { AudioEngine, DUCK_LEVEL, MUSIC_LEVEL, SFX_LEVEL, type ContextLike } from "../../src/audio/engine";
import { AudioFrame, CueTranslator, collapseVariant, flightSeconds, lowpassOf, type CueRequest } from "../../src/audio/cues";
import { createRng, fdnReverb, filter, humanize, whiteNoise } from "../../src/audio/dsp";
import { MUSIC_SAMPLE_RATE } from "../../src/audio/music";
import { buildSfxBank, type SfxBank } from "../../src/audio/sfx";
import { CUES, type CueId } from "../../src/audio/voices";
import { createEmptyState } from "../../src/core/state";
import type { GameState, StrikeEvent } from "../../src/core/types";

let bank: SfxBank;
beforeAll(() => {
  bank = buildSfxBank();
}, 60000);

const rms = (a: Float32Array, sr: number, from: number, to: number): number => {
  const i0 = Math.round(from * sr);
  const i1 = Math.min(a.length, Math.round(to * sr));
  let sum = 0;
  for (let i = i0; i < i1; i++) sum += a[i]! * a[i]!;
  return Math.sqrt(sum / Math.max(1, i1 - i0));
};
/** RMS de la banda [lo, hi] Hz dentro de la ventana [from, to). */
const bandRms = (a: Float32Array, sr: number, lo: number, hi: number, from: number, to: number): number => rms(filter("lowpass", filter("highpass", a, sr, lo), sr, hi), sr, from, to);
/** Tono dominante por autocorrelación en [from, to) entre 80 y 800 Hz. */
function pitchOf(a: Float32Array, sr: number, from: number, to: number): number {
  const i0 = Math.round(from * sr);
  const i1 = Math.round(to * sr);
  let best = 0;
  let bestLag = 0;
  for (let lag = Math.floor(sr / 800); lag <= Math.floor(sr / 80); lag++) {
    let sum = 0;
    for (let i = i0; i + lag < i1; i++) sum += a[i]! * a[i + lag]!;
    if (sum > best) {
      best = sum;
      bestLag = lag;
    }
  }
  return sr / bestLag;
}

describe("P5 efectos: señales pedidas por el autor", () => {

  it("grito de muerte: se oye (0,9 a 1,4 s), con tono sostenido y el aldeano más agudo que el soldado", () => {
    for (let k = 0; k < 3; k++) {
      const villager = bank.death.variants[k]!;
      const soldier = bank.death.variants[3 + k]!;
      const sr = bank.death.sampleRate;
      expect(villager.length / sr).toBeGreaterThanOrEqual(0.9);
      expect(soldier.length / sr).toBeLessThanOrEqual(1.4);
      const pv = pitchOf(villager, sr, 0.2, 0.35);
      const ps = pitchOf(soldier, sr, 0.2, 0.35);
      expect(ps).toBeGreaterThan(180);
      expect(ps).toBeLessThan(450);
      expect(pv).toBeGreaterThan(ps);
      expect(rms(soldier, sr, 0.15, 0.6)).toBeGreaterThan(0.1);
    }
  });

  it("derrumbe: el golpe final coincide con el fin visual y es lo más fuerte", () => {
    const cases: readonly [number, number, number, number][] = [[0, 2.2, 0.85, 0.15], [2, 2.5, 0.85, 0.15], [1, 3.4, 1.4, 0.15], [3, 3.8, 1.4, 0.15]];
    for (const [variant, seconds, hitAt] of cases) {
      const v = bank.collapse.variants[variant]!;
      const sr = bank.collapse.sampleRate;
      expect(v.length / sr).toBeCloseTo(seconds, 1);
      let peakAt = 0;
      let peak = 0;
      for (let i = 0; i < v.length; i++) {
        if (Math.abs(v[i]!) > peak) {
          peak = Math.abs(v[i]!);
          peakAt = i / sr;
        }
      }
      expect(peakAt).toBeGreaterThan(hitAt - 0.1);
      expect(peakAt).toBeLessThan(hitAt + 0.35);
      expect(rms(v, sr, hitAt, hitAt + 0.3)).toBeGreaterThan(rms(v, sr, 0.3, hitAt - 0.1));
    }
  });

  it("campana de alarma: seis campanadas agudas, sin graves y de 1,8 s", () => {
    const v = bank.bell.variants[0]!;
    const sr = bank.bell.sampleRate;
    expect(v.length / sr).toBeCloseTo(1.8, 1);
    expect(bandRms(v, sr, 800, 5000, 0, 1.2)).toBeGreaterThan(bandRms(v, sr, 60, 500, 0, 1.2) * 3);
    expect(rms(v, sr, 0.51, 0.56)).toBeGreaterThan(rms(v, sr, 0.44, 0.49));
  });

  it("fuego: bucle de 5,5 s o más, finito", () => {
    const v = bank.fire.variants[0]!;
    expect(v.length / bank.fire.sampleRate).toBeGreaterThanOrEqual(5.5);
    expect(v.every(Number.isFinite)).toBe(true);
  });

  it("cada cue tiene en el banco el número de variantes de la tabla", () => {
    for (const id of Object.keys(CUES) as CueId[]) expect(bank[id].variants).toHaveLength(CUES[id].variants);
  });
});

const project = (x: number, z: number): { x: number; y: number } => ({ x: (x - 20) / 20, y: (z - 20) / 20 });
const frame = (state: GameState, parts: Partial<Omit<AudioFrame, "state" | "project">> = {}): AudioFrame => ({ state, strikes: [], deaths: [], spawns: [], works: [], destroyed: [], project, ...parts });
let nextId = 0;
const strike = (over: Partial<StrikeEvent> & { from: { x: number; z: number } }): StrikeEvent & { id: number } => ({
  tick: 1,
  attackerId: 1,
  attackerOwner: 0,
  attackerKind: "archer",
  targetId: 2,
  targetOwner: 1,
  to: over.from,
  ...over,
  id: ++nextId,
});

describe("P5 traductor", () => {
  it("filtro por distancia y envío a reverberación", () => {
    expect(lowpassOf({ x: 0, y: 0 })).toBe(18000);
    expect(lowpassOf({ x: 1, y: 1 })).toBeCloseTo(5000, 0);
    const t = new CueTranslator();
    const [req] = t.process(frame(createEmptyState(1, 40), { strikes: [strike({ attackerKind: "soldier", from: { x: 20, z: 20 } })] }));
    expect(req!.cue).toBe("sword");
    expect(req!.lowpass).toBe(18000);
    expect(req!.wet).toBe(CUES.sword.wet);
  });

  it("el vuelo de la flecha barre el panorama hacia el destino", () => {
    expect(flightSeconds(1)).toBe(0.15);
    expect(flightSeconds(100)).toBe(0.6);
    const t = new CueTranslator();
    const out = t.process(frame(createEmptyState(1, 40), { strikes: [strike({ from: { x: 12, z: 20 }, to: { x: 28, z: 20 } })] }));
    const arrow = out.find((r) => r.cue === "arrow")!;
    expect(arrow.pan).toBeLessThan(0);
    expect(arrow.panTo!).toBeGreaterThan(0);
    expect(arrow.panDuration!).toBeCloseTo(flightSeconds(16), 5);
  });

  it("la campana y los derrumbes grandes bajan la música; los pequeños no", () => {
    expect(collapseVariant(true, 1) % 2).toBe(1);
    expect(collapseVariant(false, 1) % 2).toBe(0);
    const t = new CueTranslator();
    const state = createEmptyState(1, 40);
    const ev = (seq: number, kind: "barracks" | "house") => ({ seq, tick: 1, id: seq, owner: 1 as const, kind, cell: { x: 18, z: 18 }, complete: true });
    const out = t.process(frame(state, { destroyed: [ev(1, "barracks"), ev(2, "house")] }));
    expect(out[0]!.duck).toBe(true);
    expect(out[1]!.duck).toBeUndefined();
  });

  it("no repite la misma variante de grito dos veces seguidas", () => {
    const t = new CueTranslator();
    const deaths = Array.from({ length: 12 }, (_, i) => ({ seq: i + 1, tick: 1, id: i + 1, owner: 1 as const, kind: "soldier" as const, pos: { x: 20, z: 20 } }));
    const variants = deaths.map((d) => t.process(frame(createEmptyState(1, 40), { deaths: [d] }))[0]!.variant);
    for (let i = 1; i < variants.length; i++) expect(variants[i]).not.toBe(variants[i - 1]);
  });
});

class Param {
  value = 0;
  calls: string[] = [];
  setValueAtTime(value: number, time: number): void {
    this.value = value;
    this.calls.push(`set:${value}@${time}`);
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.value = value;
    this.calls.push(`ramp:${value}@${time}`);
  }
  setTargetAtTime(value: number, time: number): void {
    this.calls.push(`target:${value}@${time}`);
  }
  cancelScheduledValues(): void {}
}
class Node {
  connected: unknown[] = [];
  connect(destination: unknown): void {
    this.connected.push(destination);
  }
  disconnect(): void {}
}
class Gain extends Node {
  gain = new Param();
}
class Panner extends Node {
  pan = new Param();
}
class Filter extends Node {
  type = "";
  frequency = new Param();
}
class Convolver extends Node {
  buffer: unknown = null;
}
class Source extends Node {
  buffer: unknown = null;
  loop = false;
  playbackRate = new Param();
  onended: ((e: unknown) => unknown) | null = null;
  start(): void {}
  stop(): void {}
}
class Context {
  currentTime = 1;
  state = "suspended";
  destination = {};
  gains: Gain[] = [];
  panners: Panner[] = [];
  filters: Filter[] = [];
  convolvers: Convolver[] = [];
  createGain(): Gain {
    const g = new Gain();
    this.gains.push(g);
    return g;
  }
  createStereoPanner(): Panner {
    const p = new Panner();
    this.panners.push(p);
    return p;
  }
  createBiquadFilter(): Filter {
    const f = new Filter();
    this.filters.push(f);
    return f;
  }
  createConvolver(): Convolver {
    const c = new Convolver();
    this.convolvers.push(c);
    return c;
  }
  createBufferSource(): Source {
    return new Source();
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { duration: length / sampleRate, getChannelData: () => new Float32Array(length) };
  }
  createDynamicsCompressor(): Node {
    return new Node();
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    return Promise.resolve();
  }
}

const tiny = (): SfxBank => Object.fromEntries(Object.keys(CUES).map((cue) => [cue, { sampleRate: 1000, variants: Array.from({ length: CUES[cue as CueId].variants }, () => new Float32Array(100)) }])) as SfxBank;
const request = (cue: CueId, extra: Partial<CueRequest> = {}): CueRequest => ({ cue, variant: 0, pan: 0, gain: 0.5, rate: 1, delay: 0, ...extra });

async function setup() {
  const ctx = new Context();
  const memory = new Map<string, string>();
  const engine = new AudioEngine({
    createContext: () => ctx as unknown as ContextLike,
    buildBank: tiny,
    store: { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) },
  });
  await engine.unlock();
  return { ctx, engine };
}

describe("P5 motor", () => {
  it("niveles nuevos: efectos 0,5 y música 0,55", () => {
    expect(SFX_LEVEL).toBe(0.5);
    expect(MUSIC_LEVEL).toBe(0.55);
    expect(DUCK_LEVEL).toBeLessThan(1);
  });

  it("crea un único convolver al desbloquear y envía a él los cues con wet", async () => {
    const { ctx, engine } = await setup();
    expect(ctx.convolvers).toHaveLength(1);
    expect(ctx.convolvers[0]!.buffer).not.toBeNull();
    const before = ctx.gains.length;
    engine.play(request("death", { wet: 0.25, lowpass: 9000 }));
    expect(ctx.filters).toHaveLength(1);
    expect(ctx.filters[0]!.type).toBe("lowpass");
    expect(ctx.filters[0]!.frequency.value).toBe(9000);
    expect(ctx.gains.length).toBe(before + 2);
  });

  it("sin wet ni filtro no añade nodos; sin soporte del contexto suena seco", async () => {
    const { ctx, engine } = await setup();
    const before = ctx.gains.length;
    engine.play(request("sword"));
    expect(ctx.filters).toHaveLength(0);
    expect(ctx.gains.length).toBe(before + 1);
  });

  it("la flecha barre el panorama con una rampa hasta el destino", async () => {
    const { ctx, engine } = await setup();
    engine.play(request("arrow", { pan: -0.5, panTo: 0.5, panDuration: 0.4 }));
    const pan = ctx.panners.at(-1)!.pan;
    expect(pan.calls[0]).toBe("set:-0.5@1");
    expect(pan.calls[1]).toBe("ramp:0.5@1.4");
  });

  it("el ducking baja el bus de música y lo devuelve al nivel normal", async () => {
    const { ctx, engine } = await setup();
    engine.play(request("bell", { duck: true }));
    const targets = ctx.gains.flatMap((g) => g.gain.calls.filter((c) => c.startsWith("target:")));
    expect(targets.some((c) => c.startsWith(`target:${MUSIC_LEVEL * DUCK_LEVEL}`))).toBe(true);
    expect(targets.some((c) => c.startsWith(`target:${MUSIC_LEVEL}@`))).toBe(true);
  });
});

describe("P5 música", () => {
  it("humanización: variaciones acotadas y deterministas", () => {
    const a = createRng(9);
    const b = createRng(9);
    for (let i = 0; i < 200; i++) {
      const h = humanize(a, 5, 1, 0.012, 0.08, 4);
      expect(h).toEqual(humanize(b, 5, 1, 0.012, 0.08, 4));
      expect(Math.abs(h.at - 5)).toBeLessThanOrEqual(0.012);
      expect(Math.abs(h.gain - 1)).toBeLessThanOrEqual(0.08);
      expect(Math.abs(h.cents)).toBeLessThanOrEqual(4);
    }
  });

  it("la música usa 32 kHz y la cola de la reverb FDN es finita y decae", () => {
    expect(MUSIC_SAMPLE_RATE).toBe(32000);
    const x = whiteNoise(createRng(1), 32000);
    const [l, r] = fdnReverb(x, x, 32000, 0.28, 1.8, 2);
    expect(l.every(Number.isFinite) && r.every(Number.isFinite)).toBe(true);
    expect(rms(l, 32000, 1.6, 2)).toBeLessThan(rms(l, 32000, 0.2, 0.6));
    expect(rms(l, 32000, 2.2, 2.9)).toBeGreaterThan(0);
  });
});
