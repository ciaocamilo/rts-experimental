import { describe, expect, it } from "vitest";
import { createBattleState } from "../../src/core/battle";
import { emptySelection, selectSameTypeNearby } from "../../src/input/selection";

describe("P10 ajuste: doble clic selecciona unidades cercanas del mismo tipo", () => {
  it("selecciona solo propias, del mismo tipo y dentro del radio", () => {
    const state = createBattleState(1);
    const sel = emptySelection();
    const clicked = state.units.find((u) => u.owner === 0 && u.kind === "soldier")!;
    const n = selectSameTypeNearby(sel, state, clicked.id, false, 0, 6);
    expect(n).toBeGreaterThan(1);
    expect(sel.units.has(clicked.id)).toBe(true);
    for (const id of sel.units) {
      const u = state.units.find((x) => x.id === id)!;
      expect(u.owner).toBe(0);
      expect(u.kind).toBe("soldier");
      expect(Math.hypot(u.pos.x - clicked.pos.x, u.pos.z - clicked.pos.z)).toBeLessThanOrEqual(6);
    }
    const all = state.units.filter((u) => u.owner === 0 && u.kind === "soldier" && Math.hypot(u.pos.x - clicked.pos.x, u.pos.z - clicked.pos.z) <= 6);
    expect(sel.units.size).toBe(all.length);
  });

  it("un radio mayor alcanza más unidades y las lejanas quedan fuera", () => {
    const state = createBattleState(1);
    const clicked = state.units.find((u) => u.owner === 0 && u.kind === "archer")!;
    const small = emptySelection();
    const wide = emptySelection();
    selectSameTypeNearby(small, state, clicked.id, false, 0, 2);
    selectSameTypeNearby(wide, state, clicked.id, false, 0, 40);
    expect(wide.units.size).toBeGreaterThan(small.units.size);
    expect(wide.units.size).toBe(state.units.filter((u) => u.owner === 0 && u.kind === "archer").length);
  });

  it("con shift suma a la selección; sin shift la reemplaza", () => {
    const state = createBattleState(1);
    const knight = state.units.find((u) => u.owner === 0 && u.kind === "knight")!;
    const cannon = state.units.find((u) => u.owner === 0 && u.kind === "cannon")!;
    const sel = emptySelection();
    selectSameTypeNearby(sel, state, cannon.id, false, 0, 40);
    const cannons = sel.units.size;
    selectSameTypeNearby(sel, state, knight.id, true, 0, 40);
    expect(sel.units.size).toBeGreaterThan(cannons);
    expect(sel.units.has(cannon.id)).toBe(true);
    selectSameTypeNearby(sel, state, knight.id, false, 0, 40);
    expect(sel.units.has(cannon.id)).toBe(false);
  });

  it("ignora unidades enemigas y entidades inexistentes", () => {
    const state = createBattleState(1);
    const enemy = state.units.find((u) => u.owner === 1)!;
    const sel = emptySelection();
    expect(selectSameTypeNearby(sel, state, enemy.id, false, 0)).toBe(0);
    expect(selectSameTypeNearby(sel, state, null, false, 0)).toBe(0);
    expect(sel.units.size).toBe(0);
  });
});
