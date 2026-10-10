import { describe, expect, it } from "vitest";
import { createFixture } from "../../src/core/fixtures";
import { hashState } from "../../src/core/hash";
import { validateInitialReachability } from "../../src/core/map-check";
import { getGrid } from "../../src/core/obstacles";
import { stepSimulation } from "../../src/core/simulation";
import { addTerrain, addUnit, createEmptyState, createInitialState } from "../../src/core/state";
import type { Command, GameState, Unit } from "../../src/core/types";
import { circleClear } from "../../src/navigation/geometry";
import { findPath } from "../../src/navigation/astar";
import { NavGrid } from "../../src/navigation/grid";

const R = 0.3;

function moveCmd(seq: number, ids: number[], x: number, z: number): Command {
  return { id: `m${seq}`, seq, tick: 0, player: 0, type: "Move", entityIds: ids, target: { x, z } };
}

function running(units: Unit[]): boolean {
  return units.some((u) => u.task === "moving");
}

/** Ejecuta hasta que nadie se mueva o se agoten los ticks; verifica que ninguna unidad atraviese estáticos. */
function run(state: GameState, commands: Command[], maxTicks: number): { ticks: number; penetrations: number } {
  let penetrations = 0;
  let ticks = 0;
  const first = stepSimulation(state, commands);
  expect(first.tick).toBe(1);
  ticks++;
  while (ticks < maxTicks && running(state.units)) {
    stepSimulation(state);
    ticks++;
    const { grid } = getGrid(state);
    for (const u of state.units) if (!circleClear(grid, u.pos.x, u.pos.z, R - 0.02)) penetrations++;
  }
  return { ticks, penetrations };
}

describe("A* y cuadrícula (§6)", () => {
  it("rodea obstáculos y no corta esquinas bloqueadas", () => {
    const grid = new NavGrid(8);
    grid.blockRect(3, 0, 1, 5);
    grid.label();
    const path = findPath(grid, { x: 1, z: 1 }, { x: 6, z: 1 })!;
    expect(path.at(-1)).toEqual({ x: 6, z: 1 });
    for (const c of path) expect(grid.isBlocked(c.x, c.z)).toBe(false);

    const diag = new NavGrid(4);
    diag.blockRect(1, 0, 1, 1);
    diag.label();
    const p = findPath(diag, { x: 0, z: 0 }, { x: 1, z: 1 })!;
    expect(p.length).toBe(2);
  });

  it("devuelve null para destinos separados por obstáculos", () => {
    const grid = new NavGrid(8);
    grid.blockRect(3, 0, 1, 8);
    grid.label();
    expect(findPath(grid, { x: 1, z: 1 }, { x: 6, z: 1 })).toBeNull();
  });
});

describe("mapa inicial (§4.1)", () => {
  it("bases y recursos son alcanzables", () => {
    expect(() => validateInitialReachability(createInitialState(1))).not.toThrow();
  });
});

describe("T-03 experimento de navegación", () => {
  it("20 unidades atraviesan un corredor de 3 celdas en ≤60 s sin penetrar obstáculos", () => {
    const { state, commands } = createFixture("corridor20");
    const { ticks, penetrations } = run(state, commands, 1200);
    console.log(`corridor20: ${ticks} ticks (${(ticks / 20).toFixed(1)} s)`);
    expect(running(state.units)).toBe(false);
    expect(state.units.every((u) => u.task === "idle" && u.pos.x > 50)).toBe(true);
    expect(penetrations).toBe(0);
    expect(ticks).toBeLessThanOrEqual(1200);
  });

  it("dos grupos que se cruzan llegan sin bloqueos", () => {
    const { state, commands } = createFixture("crossing");
    const { ticks, penetrations } = run(state, commands, 1200);
    console.log(`crossing: ${ticks} ticks`);
    expect(state.units.filter((u) => u.task === "blocked")).toHaveLength(0);
    expect(running(state.units)).toBe(false);
    expect(penetrations).toBe(0);
  });

  it("destino imposible: se rechaza con motivo y no cambia las tareas", () => {
    const state = createEmptyState(1);
    addTerrain(state, 40, 40, 1, 5);
    addTerrain(state, 46, 40, 1, 5);
    addTerrain(state, 40, 40, 7, 1);
    addTerrain(state, 40, 44, 7, 1);
    const u = addUnit(state, 0, "soldier", 5, 5);
    const { results } = stepSimulation(state, [moveCmd(1, [u.id], 43, 42)]);
    expect(results[0]).toMatchObject({ accepted: false, code: "UNREACHABLE" });
    expect(u.task).toBe("idle");
  });

  it("obstáculo colocado en la ruta: la unidad recalcula y llega", () => {
    const state = createEmptyState(1);
    const u = addUnit(state, 0, "soldier", 5, 32.5);
    stepSimulation(state, [moveCmd(1, [u.id], 58.5, 32.5)]);
    for (let i = 0; i < 40; i++) stepSimulation(state);
    expect(u.pos.x).toBeLessThan(25);
    addTerrain(state, 30, 10, 2, 44);
    let blockedMid = false;
    for (let i = 0; i < 800 && u.task === "moving"; i++) {
      stepSimulation(state);
      if (!circleClear(getGrid(state).grid, u.pos.x, u.pos.z, R - 0.02)) blockedMid = true;
    }
    expect(blockedMid).toBe(false);
    expect(u.task).toBe("idle");
    expect(u.pos.x).toBeGreaterThan(57);
  });

  it("obstáculo que cierra toda la ruta deja la unidad bloqueada, no atravesando", () => {
    const state = createEmptyState(1);
    const u = addUnit(state, 0, "soldier", 5, 32.5);
    stepSimulation(state, [moveCmd(1, [u.id], 58.5, 32.5)]);
    for (let i = 0; i < 20; i++) stepSimulation(state);
    addTerrain(state, 30, 0, 2, 64);
    for (let i = 0; i < 40; i++) stepSimulation(state);
    expect(u.task).toBe("blocked");
    expect(u.blockedReason).toBe("UNREACHABLE");
    expect(u.pos.x).toBeLessThan(30);
  });

  it("asigna destinos libres distintos y reporta unidades sin destino", () => {
    const state = createEmptyState(1);
    addTerrain(state, 10, 10, 3, 3);
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) ids.push(addUnit(state, 0, "soldier", 2 + i * 0.7, 2).id);
    const { results } = stepSimulation(state, [moveCmd(1, ids, 11.5, 11.5)]);
    expect(results[0]).toMatchObject({ accepted: true, assigned: 6, total: 6 });
    const dests = state.units.map((u) => `${u.dest!.x},${u.dest!.z}`);
    expect(new Set(dests).size).toBe(6);

    // Mapa de 2×2 con diagonal: las celdas libres no se conectan sin cortar esquinas.
    const tiny = createEmptyState(1, 2);
    const a = addUnit(tiny, 0, "soldier", 0.5, 0.5);
    const b = addUnit(tiny, 0, "soldier", 1.5, 1.5);
    addTerrain(tiny, 1, 0, 1, 1);
    addTerrain(tiny, 0, 1, 1, 1);
    const r = stepSimulation(tiny, [moveCmd(1, [a.id, b.id], 0.5, 0.5)]).results[0];
    expect(r).toMatchObject({ accepted: true, assigned: 1, total: 2 });
  });

  it("Stop borra tarea y ruta", () => {
    const state = createEmptyState(1);
    const u = addUnit(state, 0, "soldier", 5, 5);
    stepSimulation(state, [moveCmd(1, [u.id], 50, 50)]);
    stepSimulation(state, [{ id: "s", seq: 2, tick: 0, player: 0, type: "Stop", entityIds: [u.id] }]);
    expect(u.task).toBe("idle");
    expect(u.path).toHaveLength(0);
  });

  it("es reproducible: mismas órdenes, mismo hash", () => {
    const hashOf = (): string => {
      const { state, commands } = createFixture("crossing");
      run(state, commands, 400);
      return hashState(state);
    };
    expect(hashOf()).toBe(hashOf());
  });
});

describe("RNF-02 medición inicial: 100 unidades", () => {
  it("coste de tick p95 ≤ 10 ms (medición en Node, sin render)", () => {
    const { state, commands } = createFixture("crowd100");
    const times: number[] = [];
    let first = true;
    for (let i = 0; i < 1200; i++) {
      const t0 = performance.now();
      stepSimulation(state, first ? commands : []);
      times.push(performance.now() - t0);
      first = false;
      if (!running(state.units)) break;
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    const max = times.at(-1)!;
    const blocked = state.units.filter((u) => u.task === "blocked").length;
    console.log(`crowd100: ${times.length} ticks, p95 ${p95.toFixed(2)} ms, max ${max.toFixed(2)} ms, bloqueadas ${blocked}`);
    expect(p95).toBeLessThanOrEqual(10);
  });
});
