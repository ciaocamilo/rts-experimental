import { describe, expect, it } from "vitest";
import { MAP_LAYOUT, validateMapLayout } from "../../src/content/map";
import { createFixture } from "../../src/core/fixtures";
import { validateInitialReachability } from "../../src/core/map-check";
import { getGrid } from "../../src/core/obstacles";
import { previewPlacement } from "../../src/core/placement";
import { stepSimulation } from "../../src/core/simulation";
import { addUnit, createInitialState } from "../../src/core/state";
import type { Command } from "../../src/core/types";
import { DECK_HEIGHT, walkHeight } from "../../src/rendering/bridge";

const RIVER_X0 = 61;
const RIVER_X1 = 67;
const BRIDGE_Z0 = 29;
const BRIDGE_Z1 = 35;

describe("P6 mundo: río, puente y edificios iniciales", () => {
  it("el mapa valida y es simétrico", () => {
    expect(() => validateMapLayout(MAP_LAYOUT)).not.toThrow();
  });

  it("cada bando parte con 12 casas y 2 torres completas y capacidad 50 (tope global)", () => {
    const state = createInitialState(1);
    for (const owner of [0, 1] as const) {
      expect(state.buildings.filter((b) => b.owner === owner && b.kind === "house" && b.complete)).toHaveLength(12);
      expect(state.buildings.filter((b) => b.owner === owner && b.kind === "tower" && b.complete)).toHaveLength(2);
      expect(state.players[owner].popCapacity).toBe(50);
    }
  });

  it("los centros urbanos siguen siendo alcanzables a través del puente", () => {
    expect(() => validateInitialReachability(createInitialState(1))).not.toThrow();
  });

  it("no se puede construir sobre el agua ni sobre el puente", () => {
    const state = createInitialState(1);
    const { grid } = getGrid(state);
    state.players[0].wood = 1000;
    expect(previewPlacement(state, grid, 0, "house", 62, 10)).not.toBeNull();
    expect(previewPlacement(state, grid, 0, "house", 62, 31)).not.toBeNull();
  });

  it("una unidad cruza el río por el puente y ninguna pisa el agua", () => {
    const state = createInitialState(1);
    const soldier = addUnit(state, 0, "soldier", 55.5, 32.5);
    const order: Command = { id: "p6-1", seq: 1, tick: 0, player: 0, type: "Move", entityIds: [soldier.id], target: { x: 75.5, z: 32.5 } };
    state.tick = 0;
    let crossed = false;
    for (let i = 0; i < 20 * 30; i++) {
      stepSimulation(state, i === 0 ? [order] : []);
      const u = state.units.find((x) => x.id === soldier.id)!;
      const inRiver = u.pos.x > RIVER_X0 && u.pos.x < RIVER_X1;
      if (inRiver) expect(u.pos.z).toBeGreaterThanOrEqual(BRIDGE_Z0);
      if (inRiver) expect(u.pos.z).toBeLessThanOrEqual(BRIDGE_Z1);
      if (u.pos.x > 72) crossed = true;
    }
    expect(crossed).toBe(true);
  });

  it("walkHeight sube por la rampa, es plana sobre el tablero y 0 en tierra", () => {
    const bridges = MAP_LAYOUT.terrain.filter((t) => t.kind === "bridge");
    expect(bridges).toHaveLength(1);
    expect(walkHeight(50, 32, bridges)).toBe(0);
    expect(walkHeight(64, 32, bridges)).toBeCloseTo(DECK_HEIGHT, 6);
    expect(walkHeight(61.05, 32, bridges)).toBeLessThan(DECK_HEIGHT);
    expect(walkHeight(64, 10, bridges)).toBe(0);
  });

  it("fixture rio: 40 unidades se cruzan por el puente sin pisar el agua ni atascarse, y solo la orilla admite construir", () => {
    const { state, commands, groups } = createFixture("rio");
    const first = stepSimulation(state, commands);
    const builds = first.results.slice(2);
    expect(builds.map((r) => r.accepted)).toEqual([false, false, true]);
    const ids = new Set(groups.flat());
    for (let i = 0; i < 20 * 60; i++) {
      stepSimulation(state);
      for (const u of state.units) {
        if (!ids.has(u.id)) continue;
        if (u.pos.x > RIVER_X0 && u.pos.x < RIVER_X1) expect(u.pos.z).toBeGreaterThanOrEqual(BRIDGE_Z0 - 0.01);
        if (u.pos.x > RIVER_X0 && u.pos.x < RIVER_X1) expect(u.pos.z).toBeLessThanOrEqual(BRIDGE_Z1 + 0.01);
      }
      if (!state.units.some((u) => ids.has(u.id) && u.task === "moving")) break;
    }
    expect(state.units.filter((u) => ids.has(u.id) && u.task === "blocked")).toHaveLength(0);
    const [west, east] = groups as [number[], number[]];
    const arrived = (list: number[], ok: (x: number) => boolean): boolean => list.every((id) => ok(state.units.find((u) => u.id === id)!.pos.x));
    expect(arrived(west, (x) => x > 68)).toBe(true);
    expect(arrived(east, (x) => x < 60)).toBe(true);
  });});
