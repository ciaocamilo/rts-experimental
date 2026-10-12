import { describe, expect, it } from "vitest";
import { addUnit, createEmptyState, createInitialState } from "../../src/core/state";
import { CameraRig, EDGE_MARGIN_PX, EDGE_SPEED_FACTOR, edgePan, ZOOM_MAX, ZOOM_MIN } from "../../src/input/camera-rig";
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

describe("cámara con el ratón (P2-H12)", () => {
  const none = { up: false, down: false, left: false, right: false };

  it("el centro de la vista no desplaza", () => {
    expect(edgePan(600, 300, 1200, 600)).toEqual(none);
  });

  it("cada borde desplaza hacia su lado y el límite del margen es inclusivo", () => {
    expect(edgePan(0, 300, 1200, 600)).toEqual({ ...none, left: true });
    expect(edgePan(1200, 300, 1200, 600)).toEqual({ ...none, right: true });
    expect(edgePan(600, 0, 1200, 600)).toEqual({ ...none, up: true });
    expect(edgePan(600, 600, 1200, 600)).toEqual({ ...none, down: true });
    expect(edgePan(EDGE_MARGIN_PX, 300, 1200, 600)).toEqual({ ...none, left: true });
    expect(edgePan(EDGE_MARGIN_PX + 1, 300, 1200, 600)).toEqual(none);
  });

  it("las esquinas combinan dos ejes", () => {
    expect(edgePan(2, 2, 1200, 600)).toEqual({ ...none, up: true, left: true });
    expect(edgePan(1199, 599, 1200, 600)).toEqual({ ...none, down: true, right: true });
  });

  it("fuera de la vista no desplaza", () => {
    expect(edgePan(-5, 300, 1200, 600)).toEqual(none);
    expect(edgePan(1300, 300, 1200, 600)).toEqual(none);
    expect(edgePan(600, 700, 1200, 600)).toEqual(none);
  });

  it("hacia abajo se mide contra el borde de la pantalla, no contra el del escenario (P8-H14)", () => {
    // Escenario de 600 px con una barra de 100 px debajo: la pantalla mide 700.
    expect(edgePan(600, 599, 1200, 600, EDGE_MARGIN_PX, 700)).toEqual(none);
    expect(edgePan(600, 700 - EDGE_MARGIN_PX - 1, 1200, 600, EDGE_MARGIN_PX, 700)).toEqual(none);
    expect(edgePan(600, 700 - EDGE_MARGIN_PX, 1200, 600, EDGE_MARGIN_PX, 700)).toEqual({ ...none, down: true });
    expect(edgePan(600, 700, 1200, 600, EDGE_MARGIN_PX, 700)).toEqual({ ...none, down: true });
    expect(edgePan(600, 701, 1200, 600, EDGE_MARGIN_PX, 700)).toEqual(none);
  });

  it("la diagonal no es más rápida y la cámara sigue dentro del mapa", () => {
    const straight = new CameraRig(128, 64, { x: 64, z: 32 });
    straight.pan(0.1, edgePan(600, 0, 1200, 600));
    const diagonal = new CameraRig(128, 64, { x: 64, z: 32 });
    diagonal.pan(0.1, edgePan(1199, 1, 1200, 600));
    expect(Math.hypot(diagonal.x - 64, diagonal.z - 32)).toBeCloseTo(Math.hypot(straight.x - 64, straight.z - 32), 9);
    for (let i = 0; i < 2000; i++) diagonal.pan(0.1, edgePan(1199, 1, 1200, 600));
    expect(diagonal.x).toBeLessThanOrEqual(128);
    expect(diagonal.z).toBeGreaterThanOrEqual(0);
  });

  it("el desplazamiento por borde es 50 % más rápido que el del teclado", () => {
    const keyboard = new CameraRig(128, 64, { x: 64, z: 32 });
    keyboard.pan(0.1, edgePan(600, 0, 1200, 600));
    const edge = new CameraRig(128, 64, { x: 64, z: 32 });
    edge.pan(0.1, edgePan(600, 0, 1200, 600), EDGE_SPEED_FACTOR);
    expect(EDGE_SPEED_FACTOR).toBe(1.5);
    expect(Math.hypot(edge.x - 64, edge.z - 32)).toBeCloseTo(1.5 * Math.hypot(keyboard.x - 64, keyboard.z - 32), 9);
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
