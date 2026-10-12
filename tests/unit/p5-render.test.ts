import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createFixture } from "../../src/core/fixtures";
import { GAME_VERSION, GRAPHICS_VERSION } from "../../src/content/versions";
import type { AssetLibrary } from "../../src/rendering/assets";
import { FLAME_SLOTS, FlameFactory, MAX_FIRE_PARTICLES, updateFlames } from "../../src/rendering/fire";
import { CollapseFx, DUST_LIFE_S } from "../../src/rendering/particles";

// WebGL y canvas no existen en Node: basta un sustituto mínimo que fabrique materiales y registre recursos.
const assets = {
  track: <T>(r: T): T => r,
  basic: (p: THREE.MeshBasicMaterialParameters) => new THREE.MeshBasicMaterial(p),
  lambert: (p: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(p),
} as unknown as AssetLibrary;

function alphaOf(points: THREE.Points): number[] {
  const a = points.geometry.getAttribute("aAlpha");
  return Array.from({ length: a.count }, (_, i) => a.getX(i));
}

describe("P5 fuego con partículas", () => {
  it("no reserva partículas en calidad baja", () => {
    const factory = new FlameFactory(assets, false);
    const rig = factory.create("house", 1);
    expect(rig.particles).toBe(0);
    expect(factory.particles).toBe(0);
    updateFlames(rig, 3, 1);
    expect(alphaOf(rig.smoke.points).every((v) => v === 0)).toBe(true);
  });

  it("el humo y las chispas crecen con el número de llamas y se apagan sin fuego", () => {
    const factory = new FlameFactory(assets, true);
    const rig = factory.create("house", 1);
    updateFlames(rig, 1, 2);
    const one = alphaOf(rig.smoke.points).filter((v) => v > 0).length;
    updateFlames(rig, 5, 2);
    const five = alphaOf(rig.smoke.points).filter((v) => v > 0).length;
    expect(five).toBeGreaterThan(one);
    expect(alphaOf(rig.glow.points).filter((v) => v > 0).length).toBe(FLAME_SLOTS.house.length + 1);
    updateFlames(rig, 0, 2);
    expect(rig.group.visible).toBe(false);
  });

  it("respeta el tope global y lo devuelve al liberar", () => {
    const factory = new FlameFactory(assets, true);
    const rigs = Array.from({ length: 40 }, (_, i) => factory.create("townCenter", i));
    expect(factory.particles).toBeLessThanOrEqual(MAX_FIRE_PARTICLES);
    expect(rigs[rigs.length - 1]!.particles).toBe(0);
    for (const rig of rigs) factory.release(rig);
    expect(factory.particles).toBe(0);
  });
});

describe("P5 derrumbes", () => {
  it("el polvo y los escombros nacen, duran y se retiran solos", () => {
    const fx = new CollapseFx(assets);
    fx.spawn(10, 10, 3, 7, 1.4);
    expect(fx.active).toBe(1);
    expect(fx.debrisCount).toBeGreaterThan(10);
    for (let i = 0; i < 20; i++) fx.update(0.1);
    const dust = fx.group.children.find((c) => c instanceof THREE.Points) as THREE.Points;
    expect(Math.max(...alphaOf(dust))).toBeGreaterThan(0);
    for (let i = 0; i < Math.ceil((DUST_LIFE_S + 2.5) / 0.1); i++) fx.update(0.1);
    expect(fx.active).toBe(0);
  });

  it("limita los derrumbes simultáneos y recicla los escombros", () => {
    const fx = new CollapseFx(assets);
    for (let i = 0; i < 20; i++) fx.spawn(i, 0, 4, i, 1.4);
    expect(fx.active).toBeLessThanOrEqual(8);
    fx.clear();
    expect(fx.active).toBe(0);
    expect(fx.debrisCount).toBe(0);
  });
});

describe("P5 fixture y versiones", () => {
  it("el fixture realismo tiene edificios dañados y atacantes y es determinista", () => {
    const a = createFixture("realismo");
    const b = createFixture("realismo");
    expect(a.state.buildings.length).toBe(b.state.buildings.length);
    expect(a.state.buildings.filter((x) => x.owner === 0 && x.hp < 100).length).toBeGreaterThanOrEqual(3);
    expect(a.commands.length).toBe(3);
  });

  it("anuncia las versiones de la etapa", () => {
    expect(GAME_VERSION).toBe("p6.0.0");
    expect(GRAPHICS_VERSION).toBe("gfx-0.3");
  });
});
