import { describe, expect, it } from "vitest";
import { CueTranslator, type AudioFrame } from "../../src/audio/cues";
import { buildSfxBank } from "../../src/audio/sfx";
import { CUES } from "../../src/audio/voices";
import { BALANCE } from "../../src/content/balance";
import { createBattleState } from "../../src/core/battle";
import { endSummary } from "../../src/core/result";
import { stepSimulation } from "../../src/core/simulation";
import { addUnit, createEmptyState, createInitialState } from "../../src/core/state";
import type { DeathEvent, GameState } from "../../src/core/types";
import { emptySelection, selectArmy, selectCommander } from "../../src/input/selection";
import { welcomeContent } from "../../src/ui/welcome";

const project = (x: number, z: number): { x: number; y: number } => ({ x: (x - 20) / 20, y: (z - 20) / 20 });

function frame(state: GameState, parts: Partial<Omit<AudioFrame, "state" | "project">> = {}): AudioFrame {
  return { state, strikes: [], deaths: [], spawns: [], works: [], destroyed: [], project, ...parts };
}

describe("P10 pantalla de inicio", () => {
  it("ofrece Modo villa y Modo batalla con objetivo y consejos propios", () => {
    const { modes } = welcomeContent();
    expect(modes.map((m) => [m.id, m.label])).toEqual([
      ["village", "Modo villa"],
      ["battle", "Modo batalla"],
    ]);
    for (const mode of modes) {
      expect(mode.blurb.length).toBeGreaterThan(0);
      expect(mode.goal.length).toBeGreaterThan(0);
      expect(mode.tips.length).toBeGreaterThanOrEqual(3);
    }
    expect(modes[1]!.goal.toLowerCase()).toContain("ejército");
  });
});

describe("P10 ventana de fin en batalla", () => {
  it("el resumen incluye supervivientes y bajas por tipo; la villa no lo lleva", () => {
    const state = createBattleState(1);
    const victims = state.units.filter((u) => u.owner === 0 && u.kind === "archer").slice(0, 4);
    for (const v of victims) v.hp = 0;
    for (const u of state.units) if (u.owner === 1) u.hp = 0;
    stepSimulation(state);
    const summary = endSummary(state, 0)!;
    expect(summary.label).toBe("victoria");
    const own = Object.fromEntries(summary.armies!.own.map((r) => [r.kind, r]));
    expect(own.archer).toEqual({ kind: "archer", survivors: BALANCE.battle.roster.archer - 4, casualties: 4 });
    expect(own.commander).toEqual({ kind: "commander", survivors: 1, casualties: 0 });
    const rival = summary.armies!.rival;
    expect(rival.every((r) => r.survivors === 0 && r.casualties === BALANCE.battle.roster[r.kind as keyof typeof BALANCE.battle.roster])).toBe(true);
    expect(summary.armies!.own.map((r) => r.kind)).toEqual(["commander", "knight", "soldier", "archer", "cannon"]);

    const village = createInitialState(1);
    village.matchStatus = "ended";
    village.outcome = { winner: 0, reason: "TOWN_CENTER_DESTROYED", endTick: 10, casualties: { units: [0, 0], buildings: [0, 0] }, mainBuildings: [] } as never;
    expect(endSummary(village, 0)?.armies).toBeNull();
  });
});

describe("P10 atajos del ejército", () => {
  it("E selecciona todo el ejército propio y C solo al comandante, con su posición", () => {
    const state = createBattleState(1);
    const sel = emptySelection();
    expect(selectArmy(sel, state, 0)).toBe(91);
    expect(state.units.filter((u) => sel.units.has(u.id)).every((u) => u.owner === 0)).toBe(true);
    const at = selectCommander(sel, state, 0)!;
    const commander = state.units.find((u) => u.owner === 0 && u.kind === "commander")!;
    expect([...sel.units]).toEqual([commander.id]);
    expect(at).toEqual({ x: commander.pos.x, z: commander.pos.z });
  });

  it("sin comandante, C no selecciona nada", () => {
    const state = createBattleState(1);
    state.units = state.units.filter((u) => !(u.owner === 0 && u.kind === "commander"));
    expect(selectCommander(emptySelection(), state, 0)).toBeNull();
  });
});

describe("P10 cuerno de guerra", () => {
  it("el banco lo sintetiza con dos variantes breves y sin recorte", () => {
    const bank = buildSfxBank(1);
    expect(bank.horn.variants).toHaveLength(CUES.horn.variants);
    for (const v of bank.horn.variants) {
      expect(v.length / bank.horn.sampleRate).toBeLessThanOrEqual(4);
      let peak = 0;
      for (const s of v) peak = Math.max(peak, Math.abs(s));
      expect(peak).toBeGreaterThan(0.1);
      expect(peak).toBeLessThanOrEqual(1);
    }
  });

  it("suena una vez al correr el primer tick de la batalla y no en la villa", () => {
    const t = new CueTranslator(1);
    const battle = createBattleState(1);
    expect(t.process(frame(battle))).toEqual([]);
    battle.tick = 1;
    const first = t.process(frame(battle));
    expect(first.map((r) => [r.cue, r.variant])).toEqual([["horn", 0]]);
    expect(t.process(frame(battle))).toEqual([]);
    t.reset();
    expect(t.process(frame(battle)).map((r) => r.cue)).toEqual(["horn"]);

    const village = createInitialState(1);
    village.tick = 5;
    expect(new CueTranslator(1).process(frame(village))).toEqual([]);
  });

  it("la caída del comandante propio suena grave aunque esté fuera de pantalla; la del rival no", () => {
    const base = createEmptyState(1, 40);
    const death = (owner: 0 | 1, x: number): DeathEvent & { seq: number } => ({ seq: 1, tick: 1, id: 3, owner, kind: "commander", gender: "male", pos: { x, z: 20 } });
    const own = new CueTranslator(1).process(frame(base, { deaths: [death(0, 500)] }));
    expect(own.map((r) => [r.cue, r.variant])).toEqual([["horn", 1]]);
    const rival = new CueTranslator(1).process(frame(base, { deaths: [death(1, 20)] }));
    expect(rival.map((r) => r.cue)).toEqual(["death"]);
  });

  it("el golpe del comandante suena como espada", () => {
    const state = createEmptyState(1, 40);
    addUnit(state, 0, "commander", 20, 20);
    const strike = { id: 1, tick: 1, attackerId: 1, attackerOwner: 0 as const, attackerKind: "commander" as const, targetId: 2, targetOwner: 1 as const, from: { x: 20, z: 20 }, to: { x: 20, z: 20 } };
    expect(new CueTranslator(1).process(frame(state, { strikes: [strike] })).map((r) => r.cue)).toEqual(["sword"]);
  });
});
