import { describe, expect, it } from "vitest";
import { GameSession } from "../../src/app/session";
import { hashState } from "../../src/core/hash";
import { stepSimulation } from "../../src/core/simulation";
import { addBuilding, addNode, addUnit, createEmptyState } from "../../src/core/state";
import type { Command, DeathEvent, GameState, SpawnEvent, StepResult, StrikeEvent, WorkEvent } from "../../src/core/types";

function world(): GameState {
  const state = createEmptyState(1, 40);
  addBuilding(state, 0, "townCenter", 2, 16);
  addBuilding(state, 1, "townCenter", 34, 16);
  return state;
}

function order(state: GameState, partial: Pick<Command, "type" | "entityIds" | "target" | "kind"> & { player?: 0 | 1 }): Command {
  const seq = state.lastCommandSeq + 1;
  return { id: `c${seq}`, seq, tick: state.tick, player: partial.player ?? 0, ...partial };
}

function collect(state: GameState, ticks: number): { strikes: StrikeEvent[]; deaths: DeathEvent[]; spawns: SpawnEvent[]; works: WorkEvent[]; steps: StepResult[] } {
  const out = { strikes: [] as StrikeEvent[], deaths: [] as DeathEvent[], spawns: [] as SpawnEvent[], works: [] as WorkEvent[], steps: [] as StepResult[] };
  for (let i = 0; i < ticks; i++) {
    const r = stepSimulation(state);
    out.strikes.push(...r.strikes);
    out.deaths.push(...r.deaths);
    out.spawns.push(...r.spawns);
    out.works.push(...r.works);
    out.steps.push(r);
  }
  return out;
}

describe("P4-01 eventos del núcleo para el audio", () => {
  it("el golpe incluye el bando del objetivo", () => {
    const state = world();
    const soldier = addUnit(state, 1, "soldier", 20.5, 20.5);
    const victim = addUnit(state, 0, "villager", 21.5, 20.5);
    const r = stepSimulation(state, [order(state, { type: "Attack", entityIds: [soldier.id], target: { entityId: victim.id }, player: 1 })]);
    const all = [...r.strikes, ...collect(state, 80).strikes];
    expect(all.length).toBeGreaterThan(0);
    expect(all[0]!.targetOwner).toBe(0);
    expect(all[0]!.attackerOwner).toBe(1);
  });

  it("una unidad muerta emite exactamente un DeathEvent en su posición y un edificio ninguno", () => {
    const state = world();
    const soldier = addUnit(state, 0, "soldier", 20.5, 20.5);
    const victim = addUnit(state, 1, "villager", 21.5, 20.5);
    victim.hp = 1;
    const first = stepSimulation(state, [order(state, { type: "Attack", entityIds: [soldier.id], target: { entityId: victim.id } })]);
    const out = collect(state, 80);
    out.deaths.unshift(...first.deaths);
    expect(out.deaths).toHaveLength(1);
    expect(out.deaths[0]).toMatchObject({ id: victim.id, owner: 1, kind: "villager" });
    expect(state.units.some((u) => u.id === victim.id)).toBe(false);

    const house = addBuilding(state, 1, "house", 10, 5);
    house.hp = 0;
    const r = stepSimulation(state);
    expect(r.destroyed).toHaveLength(1);
    expect(r.deaths).toHaveLength(0);
  });

  it("SpawnEvent se emite una vez, solo cuando la unidad aparece", () => {
    const state = world();
    state.players[0].food = 1000;
    const tc = state.buildings.find((b) => b.owner === 0)!;
    stepSimulation(state, [order(state, { type: "Train", entityIds: [tc.id], kind: "villager" })]);
    const before = state.units.length;
    const out = collect(state, 400);
    expect(out.spawns).toHaveLength(1);
    expect(out.spawns[0]).toMatchObject({ buildingId: tc.id, owner: 0, kind: "villager" });
    expect(state.units.length).toBe(before + 1);
    expect(state.units.some((u) => u.id === out.spawns[0]!.unitId)).toBe(true);
  });

  it("WorkEvent de construcción: uno cada 10 ticks de trabajo efectivo", () => {
    const state = world();
    state.players[0].wood = 1000;
    const v = addUnit(state, 0, "villager", 9.5, 9.5);
    stepSimulation(state, [order(state, { type: "Build", entityIds: [v.id], kind: "house", target: { x: 10, z: 10 } })]);
    const out = collect(state, 120);
    const site = state.buildings.find((b) => b.kind === "house")!;
    const builds = out.works.filter((w) => w.kind === "build");
    expect(builds.length).toBeGreaterThan(0);
    expect(builds.length).toBe(Math.floor(site.buildDone / 10));
    expect(out.works.every((w) => w.kind === "build" && w.unitId === v.id)).toBe(true);
  });

  it("WorkEvent de recolección: uno por unidad obtenida, con el tipo del recurso", () => {
    const state = world();
    const nodes = [addNode(state, "wood", 12, 18, 100), addNode(state, "stone", 12, 24, 100), addNode(state, "food", 12, 30, 100)];
    const base = state.lastCommandSeq;
    const commands: Command[] = nodes.map((n, i) => {
      const v = addUnit(state, 0, "villager", 11.5, n.cell.z + 0.5);
      return { id: `g${i}`, seq: base + i + 1, tick: 0, player: 0, type: "Gather", entityIds: [v.id], target: { entityId: n.id } };
    });
    stepSimulation(state, commands);
    const out = collect(state, 300);
    for (const [node, kind] of [[nodes[0]!, "wood"], [nodes[1]!, "stone"], [nodes[2]!, "food"]] as const) {
      const n = out.works.filter((w) => w.kind === kind).length;
      expect(n).toBe(100 - node.remaining);
      expect(n).toBeGreaterThan(0);
    }
  });

  it("los eventos no alteran el estado: dos sesiones iguales producen el mismo hash", () => {
    const run = (): string => {
      const s = new GameSession(7);
      for (let i = 0; i < 400; i++) s.stepOnce();
      return hashState(s.state);
    };
    expect(run()).toBe(run());
  });

  it("GameSession registra los eventos con seq creciente", () => {
    const s = new GameSession(3);
    const tc = s.state.buildings.find((b) => b.owner === 0)!;
    s.state.players[0].food = 1000;
    s.issue({ type: "Train", player: 0, entityIds: [tc.id], kind: "villager" });
    for (let i = 0; i < 400; i++) s.stepOnce();
    expect(s.spawnLog).toHaveLength(1);
    expect(s.spawnLog[0]!.seq).toBe(1);
    expect(s.workLog.length).toBeLessThanOrEqual(64);
  });
});
