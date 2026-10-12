import { describe, expect, it } from "vitest";
import { MAX_ACTIVE_TICKS, TICKS_PER_SECOND } from "../../src/content/balance";
import { MAP_DEPTH, MAP_LAYOUT, MAP_WIDTH, validateMapLayout } from "../../src/content/map";
import { createFixture, type FixtureName } from "../../src/core/fixtures";
import { hashState } from "../../src/core/hash";
import { validateInitialReachability } from "../../src/core/map-check";
import { getGrid } from "../../src/core/obstacles";
import { previewPlacement } from "../../src/core/placement";
import { stepSimulation } from "../../src/core/simulation";
import { createInitialState } from "../../src/core/state";
import { FOREST_TREES_PER_CELL, planScenery } from "../../src/rendering/scenery";

const forests = MAP_LAYOUT.terrain.filter((t) => t.kind === "forest");
const inForest = (x: number, z: number): boolean => forests.some((t) => x >= t.x && x < t.x + t.w && z >= t.z && z < t.z + t.h);

describe("P7 bosques", () => {
  it("el mapa sigue siendo válido y simétrico con 16 bosques", () => {
    expect(() => validateMapLayout(MAP_LAYOUT)).not.toThrow();
    expect(forests).toHaveLength(16);
    expect(() => validateInitialReachability(createInitialState(1))).not.toThrow();
  });

  it("el bosque es obstáculo: ninguna casilla de bosque es transitable ni edificable", () => {
    const state = createInitialState(1);
    const { grid } = getGrid(state);
    state.players[0].wood = 1000;
    const f = forests[0]!;
    expect(previewPlacement(state, grid, 0, "house", f.x + 2, f.z + 2)).not.toBeNull();
    for (const t of forests) {
      for (let x = t.x; x < t.x + t.w; x++) for (let z = t.z; z < t.z + t.h; z++) expect(grid.isBlocked(x, z), `${x},${z}`).toBe(true);
    }
  });

  it("ningún edificio ni recurso iniciales caen dentro de un bosque", () => {
    const state = createInitialState(1);
    for (const b of state.buildings) {
      expect(inForest(b.cell.x, b.cell.z), `${b.kind} ${b.cell.x},${b.cell.z}`).toBe(false);
    }
    for (const n of state.resourceNodes) expect(inForest(n.cell.x, n.cell.z), `${n.kind} ${n.cell.x},${n.cell.z}`).toBe(false);
    for (const u of state.units) expect(inForest(u.pos.x, u.pos.z)).toBe(false);
  });

  it("los bosques dan cerca de 1000 árboles decorativos en el suelo, dentro de sus rectángulos", () => {
    const plan = planScenery(MAP_WIDTH, MAP_DEPTH, MAP_LAYOUT.terrain);
    const trees = plan.trees.filter((t) => t.y === 0);
    const cells = forests.reduce((sum, t) => sum + t.w * t.h, 0);
    expect(trees.length).toBeGreaterThan(cells * (FOREST_TREES_PER_CELL - 0.2));
    expect(trees.length).toBeLessThan(cells * (FOREST_TREES_PER_CELL + 0.8));
    expect(trees.length).toBeGreaterThanOrEqual(900);
    for (const t of trees) expect(inForest(t.x, t.z)).toBe(true);
  });

  it("la mitad de densidad produce aproximadamente la mitad de árboles", () => {
    const full = planScenery(MAP_WIDTH, MAP_DEPTH, MAP_LAYOUT.terrain, 1337, 1).trees.filter((t) => t.y === 0).length;
    const half = planScenery(MAP_WIDTH, MAP_DEPTH, MAP_LAYOUT.terrain, 1337, 0.5).trees.filter((t) => t.y === 0).length;
    expect(half).toBeGreaterThan(full * 0.4);
    expect(half).toBeLessThan(full * 0.65);
  });

  it("añadir bosques no cambia la decoración de las rocas", () => {
    const rocks = MAP_LAYOUT.terrain.filter((t) => t.kind === undefined);
    const withForest = planScenery(MAP_WIDTH, MAP_DEPTH, MAP_LAYOUT.terrain).trees.filter((t) => t.y > 0);
    expect(withForest).toEqual(planScenery(MAP_WIDTH, MAP_DEPTH, rocks).trees);
  });

  it("los árboles decorativos no son recursos: los nodos de madera siguen siendo 32", () => {
    expect(createInitialState(1).resourceNodes.filter((n) => n.kind === "wood")).toHaveLength(32);
  });
});

describe("P7 casas y tiempo", () => {
  it("cada bando tiene 12 casas con ids únicos y la capacidad inicial es el tope global", () => {
    const state = createInitialState(1);
    const houses = state.buildings.filter((b) => b.kind === "house");
    expect(houses).toHaveLength(24);
    expect(new Set(state.buildings.map((b) => b.id)).size).toBe(state.buildings.length);
    expect(state.players[0].popCapacity).toBe(50);
  });

  it("el empate llega a los 30 minutos (36 000 ticks)", () => {
    expect(MAX_ACTIVE_TICKS).toBe(30 * 60 * TICKS_PER_SECOND);
  });

  it("misma semilla y mismas órdenes dan el mismo hash", () => {
    const run = (): string => {
      const state = createInitialState(3);
      for (let i = 0; i < 200; i++) stepSimulation(state, []);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});

describe("P7 fixtures", () => {
  const names: FixtureName[] = ["objetivo", "defensa", "sonidos", "realismo", "rio", "skirmish", "retratos"];
  for (const name of names) {
    it(`el fixture ${name} no coloca edificios ni unidades dentro de un bosque`, () => {
      const { state } = createFixture(name);
      for (const b of state.buildings) expect(inForest(b.cell.x, b.cell.z), `${b.kind} ${b.cell.x},${b.cell.z}`).toBe(false);
      for (const u of state.units) expect(inForest(u.pos.x, u.pos.z), `${u.kind} ${u.pos.x},${u.pos.z}`).toBe(false);
    });
  }
});
