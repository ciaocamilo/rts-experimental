import { describe, expect, it } from "vitest";
import { AudioFrame, CueTranslator, SALVO_GAP, computeFire, onScreen } from "../../src/audio/cues";
import { allFinite, createRng, goertzel, karplusStrong, makeLoop, normalize, peakOf, sine, filter, whiteNoise } from "../../src/audio/dsp";
import { DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings, saveSettings } from "../../src/audio/settings";
import { CUES, GLOBAL_VOICE_CAP, PLAYER_ONLY_CUES, VoiceGate } from "../../src/audio/voices";
import { addBuilding, createEmptyState } from "../../src/core/state";
import type { BuildingDestroyedEvent, DeathEvent, GameState, SpawnEvent, StrikeEvent, WorkEvent } from "../../src/core/types";

/** Pantalla = cuadrado 40×40 con centro en (20, 20): x,z fuera de [0, 40] quedan fuera. */
const project = (x: number, z: number): { x: number; y: number } => ({ x: (x - 20) / 20, y: (z - 20) / 20 });
const IN = { x: 20, z: 20 };
const OUT = { x: 200, z: 200 };

function frame(state: GameState, parts: Partial<Omit<AudioFrame, "state" | "project">> = {}): AudioFrame {
  return { state, strikes: [], deaths: [], spawns: [], works: [], destroyed: [], project, ...parts };
}

let nextId = 0;
function strike(over: Partial<StrikeEvent> & { from?: { x: number; z: number } }): StrikeEvent & { id: number } {
  const from = over.from ?? IN;
  return {
    tick: 1,
    attackerId: 1,
    attackerOwner: 0,
    attackerKind: "soldier",
    targetId: 2,
    targetOwner: 1,
    to: from,
    ...over,
    from,
    id: ++nextId,
  };
}

const world = (): GameState => createEmptyState(1, 40);

describe("P4 dsp", () => {
  it("el PRNG es determinista y la partitura finita", () => {
    const a = createRng(5);
    const b = createRng(5);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
    const k1 = karplusStrong(createRng(1), 220, 0.5, 22050);
    const k2 = karplusStrong(createRng(1), 220, 0.5, 22050);
    expect(Array.from(k1.slice(0, 200))).toEqual(Array.from(k2.slice(0, 200)));
    expect(allFinite(k1)).toBe(true);
  });

  it("Karplus–Strong afina cerca de la frecuencia pedida", () => {
    const sr = 22050;
    const buf = karplusStrong(createRng(2), 330, 0.6, sr, 0.999);
    const target = goertzel(buf, sr, 330);
    expect(target).toBeGreaterThan(goertzel(buf, sr, 330 * 1.06));
    expect(target).toBeGreaterThan(goertzel(buf, sr, 330 / 1.06));
  });

  it("goertzel detecta una senoidal, el filtro pasa-bajo la atenúa y normalize fija el pico", () => {
    const sr = 22050;
    const s = sine(1000, 0.2, sr);
    expect(goertzel(s, sr, 1000)).toBeCloseTo(1, 1);
    const low = filter("lowpass", whiteNoise(createRng(3), 4000), sr, 300);
    const high = filter("highpass", whiteNoise(createRng(3), 4000), sr, 3000);
    expect(allFinite(low) && allFinite(high)).toBe(true);
    expect(peakOf(normalize(low, 0.5))).toBeCloseTo(0.5, 5);
  });

  it("makeLoop acorta por el solape y enlaza el final con el inicio", () => {
    const loop = makeLoop(sine(200, 1, 8000), 800);
    expect(loop.length).toBe(8000 - 800);
  });
});

describe("P4 VoiceGate", () => {
  it("respeta tope por cue y separación mínima", () => {
    let t = 0;
    const gate = new VoiceGate(() => t);
    expect(gate.acquire("sword", 0.4)).not.toBeNull();
    expect(gate.acquire("sword", 0.4)).toBeNull(); // separación mínima de 50 ms
    t = 0.06;
    expect(gate.acquire("sword", 0.4)).not.toBeNull();
    for (let i = 0; i < 10; i++) {
      t += 0.06;
      gate.acquire("sword", 5);
    }
    expect(gate.stats().active).toBeLessThanOrEqual(CUES.sword.cap);
    expect(gate.stats().dropped).toBeGreaterThan(0);
  });

  it("la campana respeta 8 s entre campanadas", () => {
    let t = 0;
    const gate = new VoiceGate(() => t);
    expect(gate.acquire("bell", 2.5)).not.toBeNull();
    t = 7.9;
    expect(gate.acquire("bell", 2.5)).toBeNull();
    t = 8.1;
    expect(gate.acquire("bell", 2.5)).not.toBeNull();
  });

  it("el reinicio libera todas las voces", () => {
    let t = 0;
    const gate = new VoiceGate(() => t);
    gate.acquire("hammer", 100);
    t += 1;
    gate.acquire("axe", 100);
    gate.reset();
    expect(gate.stats().active).toBe(0);
  });

  it("roba por prioridad: voces de prioridad 1 ceden ante la campana", () => {
    let t = 0;
    const stolen: number[] = [];
    const gate = new VoiceGate(() => t, (id) => stolen.push(id));
    const ids: number[] = [];
    // 4 tipos de trabajo (cap 6, 6, 6, 4) y espadas/flechas llenan 24 voces.
    const cues = ["hammer", "axe", "pick", "forage", "sword", "arrow", "blow", "death", "collapse", "door"] as const;
    for (const cue of cues) {
      for (let i = 0; i < CUES[cue].cap && ids.length < GLOBAL_VOICE_CAP; i++) {
        t += 0.3;
        const id = gate.acquire(cue, 1000);
        if (id !== null) ids.push(id);
      }
    }
    expect(gate.stats().active).toBe(GLOBAL_VOICE_CAP);
    t += 10;
    expect(gate.acquire("bell", 3)).not.toBeNull();
    expect(stolen).toHaveLength(1);
    expect(stolen[0]).toBe(ids[0]); // la más antigua de menor prioridad
  });
});

describe("P4 CueTranslator", () => {
  it("espada, flecha, golpe: ambos bandos suenan en pantalla y callan fuera", () => {
    const t = new CueTranslator();
    const state = world();
    const events = [
      strike({ attackerKind: "soldier", attackerOwner: 0, targetOwner: 1 }),
      strike({ attackerKind: "soldier", attackerOwner: 1, targetOwner: 1 }),
      strike({ attackerKind: "archer", attackerOwner: 1, targetOwner: 1 }),
      strike({ attackerKind: "villager", attackerOwner: 1, targetOwner: 1 }),
      strike({ attackerKind: "tower", attackerOwner: 1, targetOwner: 1 }),
      strike({ attackerKind: "soldier", attackerOwner: 0, targetOwner: 1, from: OUT }),
    ];
    const cues = t.process(frame(state, { strikes: events })).map((c) => c.cue);
    expect(cues.filter((c) => c === "sword")).toHaveLength(2);
    expect(cues.filter((c) => c === "arrow")).toHaveLength(2);
    expect(cues.filter((c) => c === "blow")).toHaveLength(1);
    expect(cues).not.toContain("bell");
  });

  it("consume cada evento una sola vez aunque el cuadro se repita", () => {
    const t = new CueTranslator();
    const state = world();
    const events = [strike({})];
    expect(t.process(frame(state, { strikes: events }))).toHaveLength(1);
    expect(t.process(frame(state, { strikes: events }))).toHaveLength(0);
    t.reset();
    expect(t.process(frame(state, { strikes: events }))).toHaveLength(1);
  });

  it("la campana suena solo si el jugador es atacado, sin mirar la vista, y una vez por cuadro", () => {
    const t = new CueTranslator();
    const state = world();
    const far = [
      strike({ attackerOwner: 1, targetOwner: 0, from: OUT }),
      strike({ attackerOwner: 1, targetOwner: 0, from: OUT }),
    ];
    const out = t.process(frame(state, { strikes: far }));
    expect(out.map((c) => c.cue)).toEqual(["bell"]);
    expect(out[0]).toMatchObject({ pan: 0, gain: 1, rate: 1, delay: 0 });
    const mine = [strike({ attackerOwner: 0, targetOwner: 1 }), strike({ attackerKind: "tower", attackerOwner: 0, targetOwner: 1 })];
    expect(t.process(frame(state, { strikes: mine })).map((c) => c.cue)).not.toContain("bell");
  });

  it("el centro urbano agrupa 3 flechas en una salva escalonada 0,5 s con timbres distintos", () => {
    const t = new CueTranslator();
    const state = world();
    const salvo = [1, 2, 3].map(() => strike({ attackerKind: "tower", attackerId: 9, tick: 5, attackerOwner: 1 }));
    const single = strike({ attackerKind: "tower", attackerId: 11, tick: 5, attackerOwner: 1 });
    const out = t.process(frame(state, { strikes: [...salvo, single] }));
    const arrows = out.filter((c) => c.cue === "arrow");
    expect(arrows).toHaveLength(4);
    expect(arrows.slice(0, 3).map((a) => a.delay)).toEqual([0, SALVO_GAP, 2 * SALVO_GAP]);
    expect(new Set(arrows.slice(0, 3).map((a) => a.variant)).size).toBe(3);
    expect(arrows[3]!.delay).toBe(0);
  });

  it("una salva fuera de pantalla no suena", () => {
    const t = new CueTranslator();
    const salvo = [1, 2, 3].map(() => strike({ attackerKind: "tower", attackerId: 9, tick: 5, from: OUT }));
    expect(t.process(frame(world(), { strikes: salvo }))).toHaveLength(0);
  });

  it("muertes: un grito por unidad en pantalla con variante según el tipo", () => {
    const t = new CueTranslator();
    const mk = (seq: number, kind: DeathEvent["kind"], pos = IN): DeathEvent & { seq: number } => ({ seq, tick: 1, id: seq, owner: seq % 2 === 0 ? 0 : 1, kind, pos });
    const out = t.process(frame(world(), { deaths: [mk(1, "villager"), mk(2, "soldier"), mk(3, "archer", OUT)] }));
    expect(out.map((c) => c.cue)).toEqual(["death", "death"]);
    expect(out[0]!.variant).toBeLessThan(3);
    expect(out[1]!.variant).toBeGreaterThanOrEqual(3);
  });

  it("la puerta solo suena para el jugador y con el edificio en pantalla", () => {
    const t = new CueTranslator();
    const state = world();
    const mine = addBuilding(state, 0, "barracks", 18, 18);
    const rival = addBuilding(state, 1, "barracks", 22, 22);
    const away = addBuilding(state, 0, "barracks", 190, 190);
    const sp = (seq: number, b: { id: number; owner: 0 | 1 }): SpawnEvent & { seq: number } => ({ seq, tick: 1, buildingId: b.id, unitId: 100 + seq, owner: b.owner, kind: "soldier", pos: IN });
    const out = t.process(frame(state, { spawns: [sp(1, mine), sp(2, rival), sp(3, away)] }));
    expect(out.map((c) => c.cue)).toEqual(["door"]);
    expect(PLAYER_ONLY_CUES).toEqual(["door", "bell"]);
  });

  it("trabajo: martillo, hacha, pica y alimento para ambos bandos; fuera de pantalla callan", () => {
    const t = new CueTranslator();
    const kinds: WorkEvent["kind"][] = ["build", "wood", "stone", "food"];
    const works = kinds.map((kind, i) => ({ seq: i + 1, tick: 1, unitId: i, owner: (i % 2) as 0 | 1, kind, pos: IN }));
    works.push({ seq: 5, tick: 1, unitId: 9, owner: 1, kind: "wood", pos: OUT });
    expect(t.process(frame(world(), { works })).map((c) => c.cue)).toEqual(["hammer", "axe", "pick", "forage"]);
  });

  it("recolección: un único sonido por recurso en cada cuadro, aunque haya muchos aldeanos", () => {
    const t = new CueTranslator();
    const works = [1, 2, 3, 4, 5, 6].map((seq) => ({ seq, tick: 1, unitId: seq, owner: 0 as const, kind: (seq % 2 ? "wood" : "stone") as WorkEvent["kind"], pos: IN }));
    expect(t.process(frame(world(), { works })).map((c) => c.cue)).toEqual(["axe", "pick"]);
  });

  it("derrumbe: variante grande para cuartel y centro urbano completos, pequeña para casa y obra", () => {
    const t = new CueTranslator();
    const ev = (seq: number, kind: BuildingDestroyedEvent["kind"], complete: boolean, x = 18): BuildingDestroyedEvent & { seq: number } => ({
      seq, tick: 1, id: seq, owner: 1, kind, cell: { x, z: 18 }, complete,
    });
    const out = t.process(frame(world(), { destroyed: [ev(1, "house", true), ev(2, "barracks", true), ev(3, "barracks", false), ev(4, "townCenter", true), ev(5, "house", true, 190)] }));
    expect(out.map((c) => c.variant % 2)).toEqual([0, 1, 0, 1]);
    expect(out.every((c) => c.cue === "collapse")).toBe(true);
  });

  it("victoria con winner 0; derrota con winner 1 o empate; una sola vez por endTick, con retardo de 1 s", () => {
    const outcome = (winner: 0 | 1 | null, endTick: number): GameState => {
      const s = world();
      s.matchStatus = "ended";
      s.outcome = { winner, reason: "TOWN_CENTER_DESTROYED", endTick, mainBuildings: [], casualties: { units: [0, 0], buildings: [0, 0] } };
      return s;
    };
    const t = new CueTranslator();
    const win = t.process(frame(outcome(0, 100)));
    expect(win).toHaveLength(1);
    expect(win[0]).toMatchObject({ cue: "victory", delay: 1, pan: 0, rate: 1 });
    expect(t.process(frame(outcome(0, 100)))).toHaveLength(0);
    t.reset();
    expect(t.process(frame(outcome(1, 100)))[0]!.cue).toBe("defeat");
    t.reset();
    expect(t.process(frame(outcome(null, 100)))[0]!.cue).toBe("defeat");
    expect(t.process(frame(world()))).toHaveLength(0);
  });

  it("el panorama y la ganancia dependen de la posición; la variación de tono se mantiene en ±6 %", () => {
    const t = new CueTranslator();
    const left = strike({ from: { x: 0, z: 20 } });
    const center = strike({ from: IN });
    const [l, c] = t.process(frame(world(), { strikes: [left, center] }));
    expect(l!.pan).toBeLessThan(0);
    expect(c!.pan).toBeCloseTo(0, 5);
    expect(l!.gain).toBeLessThan(CUES.sword.gain * 1.13);
    for (const q of [l!, c!]) expect(Math.abs(q.rate - 1)).toBeLessThanOrEqual(0.06 + 1e-9);
    expect(onScreen({ x: 1.05, y: -1.05 })).toBe(true);
    expect(onScreen({ x: 1.06, y: 0 })).toBe(false);
  });
});

describe("P4 fuego", () => {
  it("solo arden los completos dañados y en pantalla; como máximo 3, los más cercanos al centro", () => {
    const state = world();
    const hurt = (x: number, z: number, hp: number, owner: 0 | 1 = 0, complete = true) => {
      const b = addBuilding(state, owner, "house", x, z, complete);
      b.hp = hp;
      return b;
    };
    const healthy = addBuilding(state, 0, "house", 5, 5);
    const site = hurt(30, 30, 30, 0, false);
    const away = hurt(190, 190, 30);
    const a = hurt(19, 19, 100);
    const b = hurt(22, 22, 100, 1);
    const c = hurt(10, 10, 100);
    const d = hurt(30, 5, 100);
    const loops = computeFire(state, project);
    expect(loops.map((l) => l.id)).toEqual([a.id, b.id, c.id]);
    expect(loops.every((l) => l.level >= 1 && l.level <= 5)).toBe(true);
    for (const id of [healthy.id, site.id, away.id, d.id]) expect(loops.some((l) => l.id === id)).toBe(false);
  });
});

describe("P4 ajustes", () => {
  const memory = (): { data: Map<string, string>; getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };

  it("guarda y recupera; los datos inválidos o la falta de almacenamiento dan los valores por defecto", () => {
    const store = memory();
    saveSettings({ music: false, sfx: true, muted: true }, store);
    expect(loadSettings(store)).toEqual({ music: false, sfx: true, muted: true });
    store.data.set(SETTINGS_KEY, "{no json");
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    store.data.set(SETTINGS_KEY, JSON.stringify({ music: "si" }));
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, null)).not.toThrow();
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, broken)).not.toThrow();
  });
});
