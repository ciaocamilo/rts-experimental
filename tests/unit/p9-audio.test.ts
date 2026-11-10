import { beforeAll, describe, expect, it } from "vitest";
import { CueTranslator, type AudioFrame } from "../../src/audio/cues";
import { buildSfxBank, type SfxBank } from "../../src/audio/sfx";
import { CUES, GLOBAL_VOICE_CAP, VoiceGate } from "../../src/audio/voices";
import { createEmptyState } from "../../src/core/state";
import type { UnitKind } from "../../src/content/balance";
import type { DeathEvent, GameState, ImpactEvent, SpawnEvent, StrikeEvent } from "../../src/core/types";

const project = (x: number, z: number): { x: number; y: number } => ({ x: (x - 20) / 20, y: (z - 20) / 20 });
const IN = { x: 20, z: 20 };
const OUT = { x: 200, z: 200 };

const world = (): GameState => createEmptyState(1, 40);

function frame(parts: Partial<Omit<AudioFrame, "state" | "project">> = {}): AudioFrame {
  return { state: world(), strikes: [], deaths: [], spawns: [], works: [], destroyed: [], project, ...parts };
}

function strike(kind: UnitKind, id: number, from = IN): StrikeEvent & { id: number } {
  return { id, tick: 1, attackerId: 1, attackerOwner: 0, attackerKind: kind, targetId: 2, targetOwner: 1, from, to: from };
}

function impact(seq: number, at = IN): ImpactEvent & { seq: number } {
  return { seq, tick: 5, attackerId: 1, attackerOwner: 0, at, from: { x: 15, z: 20 }, hits: [] };
}

describe("P9 cues de artillería y caballería", () => {
  it("el disparo del cañón suena como cañón y no como flecha", () => {
    const out = new CueTranslator(1).process(frame({ strikes: [strike("cannon", 1)] }));
    expect(out.map((r) => r.cue)).toEqual(["cannon"]);
  });

  it("el disparo del cañón fuera de pantalla no suena", () => {
    expect(new CueTranslator(1).process(frame({ strikes: [strike("cannon", 1, OUT)] }))).toHaveLength(0);
  });

  it("el golpe del caballero suena como espada", () => {
    const out = new CueTranslator(1).process(frame({ strikes: [strike("knight", 1)] }));
    expect(out.map((r) => r.cue)).toEqual(["sword"]);
  });

  it("el impacto suena una sola vez, en su sitio y sin retraso, y solo si está en pantalla", () => {
    const t = new CueTranslator(1);
    const first = t.process(frame({ impacts: [impact(1)] }));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ cue: "blast", delay: 0 });
    expect(t.process(frame({ impacts: [impact(1)] }))).toHaveLength(0);
    expect(new CueTranslator(1).process(frame({ impacts: [impact(1, OUT)] }))).toHaveLength(0);
  });

  it("un marco sin impactos sigue funcionando", () => {
    expect(new CueTranslator(1).process(frame())).toEqual([]);
  });

  it("el caballero relincha al nacer pero al morir suena una persona, no el caballo", () => {
    const spawn: SpawnEvent & { seq: number } = { seq: 1, tick: 1, buildingId: 9, unitId: 3, owner: 0, kind: "knight", pos: IN };
    const out = new CueTranslator(1).process(frame({ spawns: [spawn] }));
    expect(out.map((r) => r.cue)).toEqual(["door", "neigh"]);
    expect(out[1]!.delay).toBeGreaterThan(0);

    const death: DeathEvent & { seq: number } = { seq: 1, tick: 1, id: 3, owner: 1, kind: "knight", gender: "male", pos: IN };
    expect(new CueTranslator(1).process(frame({ deaths: [death] })).map((r) => r.cue)).toEqual(["death"]);
    expect(new CueTranslator(1).process(frame({ deaths: [{ ...death, kind: "soldier" }] })).map((r) => r.cue)).toEqual(["death"]);
  });

  it("las variantes pedidas existen en el banco de cada cue", () => {
    const t = new CueTranslator(3);
    for (let i = 1; i <= 30; i++) {
      for (const r of t.process(frame({ strikes: [strike("cannon", i)], impacts: [impact(i)] }))) expect(r.variant).toBeLessThan(CUES[r.cue].variants);
    }
  });
});

describe("P9 sonidos sintetizados", () => {
  let bank: SfxBank;
  beforeAll(() => {
    bank = buildSfxBank();
  }, 60000);

  const seconds = (id: "cannon" | "blast" | "neigh", v: number): number => bank[id].variants[v]!.length / bank[id].sampleRate;
  const peak = (a: Float32Array): number => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

  it("cañón y estruendo duran poco y no saturan", () => {
    for (let v = 0; v < CUES.cannon.variants; v++) {
      expect(seconds("cannon", v)).toBeLessThanOrEqual(1.6);
      expect(peak(bank.cannon.variants[v]!)).toBeLessThan(1);
    }
    for (let v = 0; v < CUES.blast.variants; v++) {
      expect(seconds("blast", v)).toBeLessThanOrEqual(1.4);
      expect(peak(bank.blast.variants[v]!)).toBeLessThan(1);
    }
    for (let v = 0; v < CUES.neigh.variants; v++) expect(seconds("neigh", v)).toBeLessThanOrEqual(1.3);
  });

  it("las variantes del disparo son distintas entre sí", () => {
    expect(bank.cannon.variants[0]).not.toEqual(bank.cannon.variants[1]);
    expect(bank.blast.variants[0]).not.toEqual(bank.blast.variants[1]);
  });

  it("el estruendo tiene más prioridad que el cañón y limita sus voces simultáneas", () => {
    expect(CUES.blast.priority).toBeGreaterThanOrEqual(CUES.cannon.priority);
    const gate = new VoiceGate(() => 0);
    let played = 0;
    for (let i = 0; i < 10; i++) if (gate.acquire("blast", 1.3, i * 0.2) !== null) played++;
    expect(played).toBe(CUES.blast.cap);
    expect(gate.stats().dropped).toBe(10 - CUES.blast.cap);
    expect(CUES.blast.cap).toBeLessThanOrEqual(GLOBAL_VOICE_CAP);
  });
});
