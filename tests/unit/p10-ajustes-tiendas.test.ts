import { describe, expect, it } from "vitest";
import { BATTLE_LAYOUT, MAP_WIDTH } from "../../src/content/map";
import { createBattleState } from "../../src/core/battle";
import { validateBattleReachability } from "../../src/core/map-check";
import { currentGrid } from "../../src/core/obstacles";
import { buildTentGeometry, pennantColor, TENT_HEIGHT, TENT_LENGTH, TENT_WIDTH } from "../../src/rendering/camp";

const camps = BATTLE_LAYOUT.terrain.filter((t) => t.kind === "camp");

describe("P10 ajuste: tiendas de campaña", () => {
  it("hay tiendas detrás de cada ejército, en número igual y simétricas", () => {
    const west = camps.filter((t) => t.x + t.w <= MAP_WIDTH / 2);
    const east = camps.filter((t) => t.x >= MAP_WIDTH / 2);
    expect(west.length).toBeGreaterThanOrEqual(3);
    expect(east.length).toBe(west.length);
    for (const side of [0, 1] as const) {
      const rearmost = Math.min(...BATTLE_LAYOUT.armies[side].map((s) => (side === 0 ? s.x : MAP_WIDTH - s.x)));
      for (const t of side === 0 ? west : east) {
        const nearestEdge = side === 0 ? t.x + t.w : MAP_WIDTH - t.x;
        expect(nearestEdge).toBeLessThan(rearmost);
      }
    }
  });

  it("son escenario sólido: bloquean el paso y ninguna unidad nace dentro", () => {
    const state = createBattleState(1);
    const grid = currentGrid(state);
    for (const t of camps) {
      for (let x = t.x; x < t.x + t.w; x++) for (let z = t.z; z < t.z + t.h; z++) expect(grid.isBlocked(x, z)).toBe(true);
      for (const u of state.units) {
        expect(u.pos.x >= t.x && u.pos.x < t.x + t.w && u.pos.z >= t.z && u.pos.z < t.z + t.h).toBe(false);
      }
    }
    expect(() => validateBattleReachability(state)).not.toThrow();
  });

  it("no son entidades: no hay edificios ni nada que se pueda destruir", () => {
    const state = createBattleState(1);
    expect(state.buildings.length).toBe(0);
    expect(state.terrain.some((t) => t.kind === "camp")).toBe(true);
  });

  it("la geometría de la tienda cabe en su rectángulo y tiene color y normales", () => {
    const g = buildTentGeometry(pennantColor(10, MAP_WIDTH));
    g.computeBoundingBox();
    const box = g.boundingBox!;
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(4);
    expect(box.max.z - box.min.z).toBeLessThanOrEqual(4);
    expect(box.max.y).toBeGreaterThan(TENT_HEIGHT);
    expect(TENT_LENGTH).toBeLessThan(4);
    expect(TENT_WIDTH).toBeLessThan(4);
    expect(g.getAttribute("color").count).toBe(g.getAttribute("position").count);
    expect(g.getAttribute("normal").count).toBe(g.getAttribute("position").count);
    g.dispose();
  });

  it("el banderín es azul en la mitad del jugador 0 y rojo en la del 1", () => {
    const [r0, , b0] = pennantColor(8, MAP_WIDTH);
    const [r1, , b1] = pennantColor(MAP_WIDTH - 8, MAP_WIDTH);
    expect(b0).toBeGreaterThan(r0);
    expect(r1).toBeGreaterThan(b1);
  });
});
