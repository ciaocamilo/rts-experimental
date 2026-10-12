import { describe, expect, it } from "vitest";
import { AudioEngine, JINGLE_DUCK, MUSIC_LEVEL, type ContextLike } from "../../src/audio/engine";
import type { CueRequest } from "../../src/audio/cues";
import { SETTINGS_KEY } from "../../src/audio/settings";
import { CUES, type CueId } from "../../src/audio/voices";
import type { SfxBank } from "../../src/audio/sfx";

class FakeParam {
  value = 0;
  targets: { value: number; time: number }[] = [];
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }
  setTargetAtTime(value: number, time: number): void {
    this.targets.push({ value, time });
  }
  cancelScheduledValues(): void {}
}

class FakeNode {
  connected: unknown[] = [];
  disconnected = 0;
  connect(destination: unknown): void {
    this.connected.push(destination);
  }
  disconnect(): void {
    this.disconnected += 1;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakePanner extends FakeNode {
  pan = new FakeParam();
}
class FakeSource extends FakeNode {
  buffer: { duration: number } | null = null;
  loop = false;
  playbackRate = new FakeParam();
  onended: ((event: unknown) => unknown) | null = null;
  starts: number[] = [];
  stops = 0;
  start(when = 0): void {
    this.starts.push(when);
  }
  stop(): void {
    this.stops += 1;
  }
}

class FakeContext {
  currentTime = 0;
  state = "suspended";
  destination = {};
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  resumed = 0;
  suspended = 0;
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createStereoPanner(): FakePanner {
    return new FakePanner();
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { duration: length / sampleRate, getChannelData: () => new Float32Array(length) };
  }
  createDynamicsCompressor(): FakeNode {
    return new FakeNode();
  }
  resume(): Promise<void> {
    this.resumed += 1;
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspended += 1;
    return Promise.resolve();
  }
}

const tinyBank = (): SfxBank =>
  Object.fromEntries(Object.keys(CUES).map((cue) => [cue, { sampleRate: 1000, variants: Array.from({ length: CUES[cue as CueId].variants }, () => new Float32Array(100)) }])) as SfxBank;

const store = () => {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

function setup(extra: Partial<ConstructorParameters<typeof AudioEngine>[0]> = {}) {
  const ctx = new FakeContext();
  let created = 0;
  const memory = store();
  const engine = new AudioEngine({
    createContext: () => {
      created += 1;
      return ctx as unknown as ContextLike;
    },
    buildBank: tinyBank,
    store: memory,
    ...extra,
  });
  return { ctx, engine, memory, created: () => created };
}

const request = (cue: CueId, extra: Partial<CueRequest> = {}): CueRequest => ({ cue, variant: 0, pan: 0, gain: 0.5, rate: 1, delay: 0, ...extra });

describe("AudioEngine", () => {
  it("permanece bloqueado y descarta sonidos hasta el primer gesto", async () => {
    const { ctx, engine, created } = setup();
    expect(engine.status).toBe("bloqueado");
    engine.play(request("sword"));
    engine.syncFire([{ id: 1, level: 1, pan: 0, gain: 0.2 }]);
    expect(created()).toBe(0);
    expect(ctx.sources).toHaveLength(0);
    await engine.unlock();
    expect(engine.status).toBe("activo");
    expect(ctx.sources).toHaveLength(0);
  });

  it("desbloquea una sola vez y reproduce con retardo, ritmo y pan", async () => {
    const { ctx, engine, created } = setup();
    await Promise.all([engine.unlock(), engine.unlock()]);
    await engine.unlock();
    expect(created()).toBe(1);
    expect(ctx.resumed).toBeGreaterThanOrEqual(1);
    ctx.currentTime = 2;
    engine.play(request("arrow", { delay: 0.5, rate: 1.05, pan: -0.4 }));
    expect(ctx.sources).toHaveLength(1);
    const source = ctx.sources[0]!;
    expect(source.starts).toEqual([2.5]);
    expect(source.playbackRate.value).toBe(1.05);
    expect(engine.activeVoices).toBe(1);
  });

  it("silenciado y efectos desactivados no crean voces", async () => {
    const { ctx, engine, memory } = setup();
    await engine.unlock();
    engine.toggleMuted();
    expect(engine.status).toBe("silenciado");
    engine.play(request("sword"));
    expect(ctx.sources).toHaveLength(0);
    expect(JSON.parse(memory.data.get(SETTINGS_KEY)!).muted).toBe(true);
    engine.toggleMuted();
    engine.setSfx(false);
    engine.play(request("sword"));
    expect(ctx.sources).toHaveLength(0);
    engine.setSfx(true);
    ctx.currentTime = 1;
    engine.play(request("sword"));
    expect(ctx.sources).toHaveLength(1);
  });

  it("la pausa suspende y reanuda el contexto", async () => {
    const { ctx, engine } = setup();
    await engine.unlock();
    const resumed = ctx.resumed;
    engine.setPaused(true);
    expect(ctx.suspended).toBe(1);
    engine.setPaused(false);
    expect(ctx.resumed).toBe(resumed + 1);
  });

  it("una pausa previa al desbloqueo deja el contexto suspendido", async () => {
    const { ctx, engine } = setup();
    engine.setPaused(true);
    await engine.unlock();
    expect(ctx.suspended).toBe(1);
  });

  it("sin AudioContext el estado es no disponible y nada lanza", async () => {
    const engine = new AudioEngine();
    expect(engine.status).toBe("no disponible");
    await engine.unlock();
    expect(() => {
      engine.play(request("sword"));
      engine.syncFire([]);
      engine.toggleMuted();
      engine.reset();
      engine.setPaused(true);
    }).not.toThrow();
    expect(engine.status).toBe("no disponible");
  });

  it("si crear el contexto falla queda no disponible", async () => {
    const engine = new AudioEngine({
      createContext: () => {
        throw new Error("sin audio");
      },
    });
    await engine.unlock();
    expect(engine.status).toBe("no disponible");
    expect(() => engine.play(request("sword"))).not.toThrow();
  });

  it("un almacenamiento que falla no impide cambiar ajustes", async () => {
    const { engine } = setup({
      store: {
        getItem: () => {
          throw new Error("denegado");
        },
        setItem: () => {
          throw new Error("denegado");
        },
      },
    });
    await engine.unlock();
    expect(() => engine.toggleMuted()).not.toThrow();
    expect(engine.settings.muted).toBe(true);
  });

  it("los bucles de fuego se crean una vez, se actualizan y se funden al desaparecer", async () => {
    const { ctx, engine } = setup();
    await engine.unlock();
    const loop = { id: 7, level: 2, pan: 0.1, gain: 0.3 };
    engine.syncFire([loop]);
    engine.syncFire([{ ...loop, gain: 0.35 }]);
    expect(engine.fireLoops).toBe(1);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]!.loop).toBe(true);
    engine.syncFire([]);
    expect(engine.fireLoops).toBe(0);
    expect(ctx.sources[0]!.stops).toBe(1);
  });

  it("el fuego se corta al silenciar", async () => {
    const { ctx, engine } = setup();
    await engine.unlock();
    engine.syncFire([{ id: 1, level: 1, pan: 0, gain: 0.2 }]);
    engine.toggleMuted();
    expect(engine.fireLoops).toBe(0);
    expect(ctx.sources[0]!.stops).toBe(1);
  });

  it("reset corta voces y fuego y deja la música sonando", async () => {
    const { ctx, engine } = setup({ loadMusic: () => Promise.resolve({ left: new Float32Array(100), right: new Float32Array(100), sampleRate: 1000 }) });
    await engine.unlock();
    await Promise.resolve();
    expect(engine.music).toBe("lista");
    engine.play(request("hammer"));
    engine.syncFire([{ id: 1, level: 1, pan: 0, gain: 0.2 }]);
    const [music, voice, fire] = ctx.sources;
    engine.reset();
    expect(voice!.stops).toBe(1);
    expect(fire!.stops).toBe(1);
    expect(music!.stops).toBe(0);
    expect(engine.activeVoices).toBe(0);
    expect(engine.fireLoops).toBe(0);
  });

  it("la música carga en segundo plano y falla sin afectar a los efectos", async () => {
    const ok = setup({ loadMusic: () => Promise.resolve({ left: new Float32Array(10), right: new Float32Array(10), sampleRate: 1000 }) });
    await ok.engine.unlock();
    await Promise.resolve();
    expect(ok.engine.music).toBe("lista");
    expect(ok.ctx.sources[0]!.loop).toBe(true);

    const bad = setup({ loadMusic: () => Promise.reject(new Error("worker")) });
    await bad.engine.unlock();
    await Promise.resolve();
    await Promise.resolve();
    expect(bad.engine.music).toBe("fallida");
    bad.engine.play(request("sword"));
    expect(bad.ctx.sources).toHaveLength(1);
  });

  it("la fanfarria baja la música al 10 % y luego al 30 %", async () => {
    const { ctx, engine } = setup();
    await engine.unlock();
    engine.play(request("victory", { delay: 1 }));
    const musicBus = ctx.gains[2]!;
    const [during, after] = musicBus.gain.targets.slice(-2);
    expect(during!.value).toBeCloseTo(MUSIC_LEVEL * JINGLE_DUCK, 6);
    expect(during!.time).toBeCloseTo(1, 6);
    expect(after!.value).toBeCloseTo(MUSIC_LEVEL * 0.3, 6);
  });
});
