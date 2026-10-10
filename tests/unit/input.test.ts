import { describe, expect, it } from "vitest";
import { addUnit, createEmptyState, createInitialState } from "../../src/core/state";
import { CameraRig, ZOOM_MAX, ZOOM_MIN } from "../../src/input/camera-rig";
import { boxSelect, clearSelection, clickSelect, emptySelection, pruneSelection } from "../../src/input/selection";

describe("cámara (RF-02)", () => {
  const keys = { up: false, down: false, left: false, right: false };

  it("no abandona el mapa", () => {
    const rig = new CameraRig(64);
    for (let i = 0; i < 1000; i++) rig.pan(0.1, { ...keys, up: true, left: true });
    expect(rig.x).toBeGreaterThanOrEqual(0);
    expect(rig.z).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 1000; i++) rig.pan(0.1, { ...keys, down: true, right: true });
    expect(rig.x).toBeLessThanOrEqual(64);
    expect(rig.z).toBeLessThanOrEqual(64);
  });

  it("arriba mueve hacia -x,-z y derecha hacia +x,-z", () => {
    const rig = new CameraRig(64);
    rig.pan(0.1, { ...keys, up: true });
    expect(rig.x).toBeLessThan(32);
    expect(rig.z).toBeLessThan(32);
    const r2 = new CameraRig(64);
    r2.pan(0.1, { ...keys, right: true });
    expect(r2.x).toBeGreaterThan(32);
    expect(r2.z).toBeLessThan(32);
  });

  it("el zoom respeta los límites", () => {
    const rig = new CameraRig(64);
    for (let i = 0; i < 100; i++) rig.zoomBy(-500);
    expect(rig.zoom).toBe(ZOOM_MAX);
    for (let i = 0; i < 100; i++) rig.zoomBy(500);
    expect(rig.zoom).toBe(ZOOM_MIN);
  });
});

describe("selección (RF-03)", () => {
  const state = createInitialState(1);
  const own = state.units.filter((u) => u.owner === 0).map((u) => u.id);
  const enemy = state.units.find((u) => u.owner === 1)!.id;
  const building = state.buildings.find((b) => b.owner === 0)!.id;

  it("clic selecciona y reemplaza; Shift añade y quita", () => {
    const sel = emptySelection();
    clickSelect(sel, state, own[0]!, false, 0);
    clickSelect(sel, state, own[1]!, false, 0);
    expect([...sel.units]).toEqual([own[1]]);
    clickSelect(sel, state, own[0]!, true, 0);
    expect(sel.units.size).toBe(2);
    clickSelect(sel, state, own[0]!, true, 0);
    expect([...sel.units]).toEqual([own[1]]);
  });

  it("enemigos y edificios solo se inspeccionan, sin entrar a la selección de órdenes", () => {
    const sel = emptySelection();
    clickSelect(sel, state, own[0]!, false, 0);
    clickSelect(sel, state, enemy, false, 0);
    expect(sel.units.size).toBe(0);
    expect(sel.inspected).toBe(enemy);
    clickSelect(sel, state, building, false, 0);
    expect(sel.inspected).toBe(building);
  });

  it("clic en vacío limpia; con Shift conserva", () => {
    const sel = emptySelection();
    clickSelect(sel, state, own[0]!, false, 0);
    clickSelect(sel, state, null, true, 0);
    expect(sel.units.size).toBe(1);
    clickSelect(sel, state, null, false, 0);
    expect(sel.units.size).toBe(0);
  });

  it("arrastre selecciona solo unidades propias", () => {
    const sel = emptySelection();
    boxSelect(sel, state, [...own, enemy, building], false, 0);
    expect(sel.units.size).toBe(own.length);
    expect(sel.units.has(enemy)).toBe(false);
  });

  it("Escape limpia y las entidades muertas se retiran", () => {
    const s = createEmptyState(1);
    const u = addUnit(s, 0, "soldier", 5, 5);
    const sel = emptySelection();
    clickSelect(sel, s, u.id, false, 0);
    s.units = [];
    pruneSelection(sel, s);
    expect(sel.units.size).toBe(0);
    clickSelect(sel, state, own[0]!, false, 0);
    clearSelection(sel);
    expect(sel.units.size).toBe(0);
  });
});
