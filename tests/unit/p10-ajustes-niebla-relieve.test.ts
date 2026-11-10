import { describe, expect, it } from "vitest";
import { BALANCE } from "../../src/content/balance";
import { BATTLE_LAYOUT, MAP_DEPTH, MAP_WIDTH } from "../../src/content/map";
import { createBattleState } from "../../src/core/battle";
import { addUnit } from "../../src/core/state";
import { FOG_EXPLORED, FOG_RES, FOG_UNSEEN, VisionMap } from "../../src/core/vision";
import { VALLEY_RES, buildMountainGeometry, buildValleyPixels, mountainHeight, valleyPath } from "../../src/rendering/relief";

describe("P10 niebla de guerra (VisionMap)", () => {
  it("empieza oscura, aclara lo visto y recuerda lo explorado", () => {
    const state = createBattleState(1);
    const vision = new VisionMap(MAP_WIDTH, MAP_DEPTH);
    expect(vision.shadeAt(20, 32)).toBeCloseTo(FOG_UNSEEN, 5);
    vision.update(state);
    expect(vision.shadeAt(25, 32)).toBe(0);
    expect(vision.shadeAt(100, 32)).toBeCloseTo(FOG_UNSEEN, 5);

    for (const u of state.units) if (u.owner === 0) u.hp = 0;
    state.units = state.units.filter((u) => u.hp > 0);
    vision.update(state);
    expect(vision.shadeAt(25, 32)).toBeCloseTo(FOG_EXPLORED, 5);
    expect(vision.shadeAt(100, 32)).toBeCloseTo(FOG_UNSEEN, 5);
  });

  it("el comandante ve más lejos que el resto del ejército", () => {
    const state = createBattleState(1);
    const vision = new VisionMap(MAP_WIDTH, MAP_DEPTH);
    vision.update(state);
    const commander = state.units.find((u) => u.owner === 0 && u.kind === "commander")!;
    const reach = BALANCE.battle.commanderVisionRadius;
    expect(vision.shadeAt(commander.pos.x + reach - 6, commander.pos.z)).toBe(0);
    const far = commander.pos.x + reach + 4;
    expect(far).toBeLessThan(MAP_WIDTH);
    expect(vision.shadeAt(far, commander.pos.z)).toBeGreaterThan(0.5);
  });

  it("reset devuelve la oscuridad total y cambia la versión", () => {
    const state = createBattleState(1);
    const vision = new VisionMap(MAP_WIDTH, MAP_DEPTH);
    vision.update(state);
    const before = vision.version;
    vision.reset();
    expect(vision.version).toBeGreaterThan(before);
    expect(vision.shadeAt(25, 32)).toBeCloseTo(FOG_UNSEEN, 5);
  });

  it("el campo tiene FOG_RES texels por celda", () => {
    const vision = new VisionMap(MAP_WIDTH, MAP_DEPTH);
    expect(vision.cols).toBe(MAP_WIDTH * FOG_RES);
    expect(vision.rows).toBe(MAP_DEPTH * FOG_RES);
  });

  it("una unidad añadida amplía lo visible", () => {
    const state = createBattleState(1);
    const vision = new VisionMap(MAP_WIDTH, MAP_DEPTH);
    vision.update(state);
    expect(vision.shadeAt(60, 5)).toBeGreaterThan(0);
    addUnit(state, 0, "soldier", 60, 5);
    vision.update(state);
    expect(vision.shadeAt(60, 5)).toBe(0);
  });
});

describe("P10 afluente continuo", () => {
  it("cada mitad tiene un único cauce de agua que toca el río principal", () => {
    const water = BATTLE_LAYOUT.terrain.filter((t) => t.kind === "water");
    const tributaries = water.filter((t) => t.w >= 3 * t.h && t.h <= 4);
    expect(tributaries).toHaveLength(2);
    for (const t of tributaries) {
      const touchesMain = water.some((r) => r !== t && r.w === 6 && t.x <= r.x + r.w && t.x + t.w >= r.x && t.z >= r.z && t.z + t.h <= r.z + r.h);
      expect(touchesMain).toBe(true);
    }
  });

  it("no queda ningún vado: solo hay 3 puentes, todos en el río principal", () => {
    const bridges = BATTLE_LAYOUT.terrain.filter((t) => t.kind === "bridge");
    expect(bridges).toHaveLength(3);
    for (const b of bridges) expect(b.x).toBe(61);
  });
});

describe("P10 relieve", () => {
  it("la altura de la montaña es 0 en el borde y positiva en el interior", () => {
    for (const t of [-1, -0.5, 0, 0.5, 1]) {
      expect(mountainHeight(t, 1, 7, 5)).toBe(0);
      expect(mountainHeight(-1, t, 7, 5)).toBe(0);
    }
    let max = 0;
    for (let u = -1; u <= 1; u += 0.1) for (let v = -1; v <= 1; v += 0.1) max = Math.max(max, mountainHeight(u, v, 7, 5));
    expect(max).toBeGreaterThan(2.5);
    expect(max).toBeLessThan(7);
  });

  it("la malla de la montaña es determinista y trae colores por vértice", () => {
    const a = buildMountainGeometry(16, 13, 3, 5);
    const b = buildMountainGeometry(16, 13, 3, 5);
    expect(a.getAttribute("position").array).toEqual(b.getAttribute("position").array);
    expect(a.getAttribute("color").count).toBe(a.getAttribute("position").count);
  });

  it("la textura del valle respeta su tamaño y deja transparentes los bordes", () => {
    const w = 12;
    const h = 9;
    const px = buildValleyPixels(w, h, 5);
    expect(px.length).toBe(w * VALLEY_RES * h * VALLEY_RES * 4);
    expect(px[3]).toBe(0);
    expect(px[px.length - 1]).toBe(0);
  });

  it("la senda del valle se mantiene dentro del rectángulo", () => {
    for (let a = 0; a < 30; a += 0.5) {
      const z = valleyPath(a, 8, 11);
      expect(z).toBeGreaterThanOrEqual(1.2);
      expect(z).toBeLessThanOrEqual(8 - 1.2);
    }
  });
});
