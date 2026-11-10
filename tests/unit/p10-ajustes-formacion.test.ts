import { describe, expect, it } from "vitest";
import { BALANCE } from "../../src/content/balance";
import { createBattleState } from "../../src/core/battle";
import { stepSimulation } from "../../src/core/simulation";
import type { Command, GameState, Unit } from "../../src/core/types";

function order(state: GameState, ids: number[], target: { x: number; z: number }): Command {
  const seq = state.lastCommandSeq + 1;
  return { id: `c${seq}`, seq, tick: state.tick, player: 0, type: "Move", entityIds: ids, target };
}

function mine(state: GameState, kind: Unit["kind"]): Unit[] {
  return [...state.units.values()].filter((u) => u.owner === 0 && u.kind === kind);
}

describe("P10 ajuste: formación al avanzar (modo batalla)", () => {
  it("el bloque conserva su forma: cada unidad recibe su puesto desplazado igual que el centro", () => {
    const state = createBattleState(1);
    const group = mine(state, "soldier").slice(0, 12);
    const cx = group.reduce((s, u) => s + u.pos.x, 0) / group.length;
    const cz = group.reduce((s, u) => s + u.pos.z, 0) / group.length;
    const target = { x: cx + 6, z: cz };
    stepSimulation(state, [order(state, group.map((u) => u.id), target)]);
    for (const u of group) {
      expect(u.task).toBe("moving");
      expect(u.dest).toBeTruthy();
    }
    const dx = group.map((u) => u.dest!.x - u.pos.x);
    const dz = group.map((u) => u.dest!.z - u.pos.z);
    expect(Math.max(...dx) - Math.min(...dx)).toBeLessThanOrEqual(2.5);
    expect(Math.max(...dz) - Math.min(...dz)).toBeLessThanOrEqual(2.5);
    expect(new Set(group.map((u) => `${u.dest!.x},${u.dest!.z}`)).size).toBe(group.length);
  });

  it("un grupo mixto marcha al paso del más lento (los rápidos reciben un tope)", () => {
    const state = createBattleState(1);
    const group = [...mine(state, "soldier").slice(0, 4), ...mine(state, "cannon").slice(0, 2), ...mine(state, "knight").slice(0, 2)];
    const cx = group.reduce((s, u) => s + u.pos.x, 0) / group.length;
    const cz = group.reduce((s, u) => s + u.pos.z, 0) / group.length;
    stepSimulation(state, [order(state, group.map((u) => u.id), { x: cx + 8, z: cz })]);
    const slowest = Math.min(...group.map((u) => BALANCE.units[u.kind].speedCellsPerSec));
    for (const u of group) {
      if (BALANCE.units[u.kind].speedCellsPerSec > slowest) expect(u.pace).toBe(slowest);
      else expect(u.pace).toBeUndefined();
    }
  });

  it("al llegar, o con otra orden, el tope desaparece", () => {
    const state = createBattleState(1);
    const group = [...mine(state, "soldier").slice(0, 2), ...mine(state, "knight").slice(0, 1)];
    const cx = group.reduce((s, u) => s + u.pos.x, 0) / group.length;
    const cz = group.reduce((s, u) => s + u.pos.z, 0) / group.length;
    stepSimulation(state, [order(state, group.map((u) => u.id), { x: cx + 3, z: cz })]);
    const knight = group[2]!;
    expect(knight.pace).toBeDefined();
    for (let i = 0; i < 400; i++) stepSimulation(state, []);
    for (const u of group) expect(u.pace).toBeUndefined();
  });

  it("una sola unidad se mueve como siempre y nunca recibe tope", () => {
    const state = createBattleState(1);
    const knight = mine(state, "knight")[0]!;
    stepSimulation(state, [order(state, [knight.id], { x: knight.pos.x + 4, z: knight.pos.z })]);
    expect(knight.task).toBe("moving");
    expect(knight.pace).toBeUndefined();
  });

  it("el modo villa no cambia: sin tope de ritmo en ninguna unidad", async () => {
    const { createInitialState } = await import("../../src/core/state");
    const state = createInitialState(1);
    const soldiers = [...state.units.values()].filter((u) => u.owner === 0).slice(0, 4);
    stepSimulation(state, [order(state, soldiers.map((u) => u.id), { x: soldiers[0]!.pos.x + 5, z: soldiers[0]!.pos.z })]);
    for (const u of state.units.values()) expect(u.pace).toBeUndefined();
  });
});
