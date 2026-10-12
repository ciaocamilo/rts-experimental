import { describe, expect, it } from "vitest";
import { BALANCE } from "../../src/content/balance";
import { MAP_DEPTH, MAP_LAYOUT, MAP_WIDTH, validateMapLayout } from "../../src/content/map";
import { validateInitialReachability } from "../../src/core/map-check";
import { createFixture } from "../../src/core/fixtures";
import { stepSimulation } from "../../src/core/simulation";
import { createInitialState } from "../../src/core/state";
import type { Command, StrikeEvent } from "../../src/core/types";
import { barState } from "../../src/rendering/health";
import { computePose, type PoseInput, type Role } from "../../src/rendering/pose";
import { planScenery, ROCK_HEIGHT } from "../../src/rendering/scenery";

describe("P2-H05 mapa ampliado", () => {
  it("duplica la superficie de P1 (64×64) y el diseño sigue siendo válido", () => {
    expect(MAP_WIDTH * MAP_DEPTH).toBe(2 * 64 * 64);
    expect(() => validateMapLayout(MAP_LAYOUT)).not.toThrow();
    expect(() => validateInitialReachability(createInitialState(0))).not.toThrow();
  });

  it("al menos el doble de nodos de madera y los de alimento no cambian (CA)", () => {
    const wood = MAP_LAYOUT.nodes.filter((n) => n.kind === "wood");
    const food = MAP_LAYOUT.nodes.filter((n) => n.kind === "food");
    expect(wood.length).toBe(2 * BALANCE.woodNodesPerPlayer);
    expect(wood.length).toBeGreaterThanOrEqual(2 * 16);
    expect(food.length).toBe(2 * BALANCE.nodesPerKindPerPlayer);
    expect(BALANCE.nodeAmount).toBe(500);
  });

  it("los árboles visibles (nodos + decoración) son al menos 4 veces los de P1", () => {
    const wood = MAP_LAYOUT.nodes.filter((n) => n.kind === "wood").length;
    const plan = planScenery(MAP_WIDTH, MAP_DEPTH, MAP_LAYOUT.terrain);
    expect(wood + plan.trees.length).toBeGreaterThanOrEqual(4 * 16);
  });

  it("todos los pasos entre obstáculos miden al menos 3 celdas", () => {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const blocked = MAP_LAYOUT.terrain.filter((t) => x >= t.x && x < t.x + t.w).map((t) => [t.z, t.z + t.h] as const).sort((a, b) => a[0] - b[0]);
      let cursor = 0;
      for (const [from, to] of blocked) {
        const gap = from - cursor;
        if (gap > 0) expect(gap, `columna ${x}`).toBeGreaterThanOrEqual(3);
        cursor = Math.max(cursor, to);
      }
      const tail = MAP_DEPTH - cursor;
      if (blocked.length > 0 && tail > 0) expect(tail, `columna ${x}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("P2-H06 vegetación decorativa", () => {
  const plan = planScenery(MAP_WIDTH, MAP_DEPTH, MAP_LAYOUT.terrain);
  const blockedBy = (x: number, z: number): "rock" | "forest" | "water" | null => {
    for (const t of MAP_LAYOUT.terrain) {
      if (x >= t.x && x < t.x + t.w && z >= t.z && z < t.z + t.h) return t.kind === "water" ? "water" : t.kind === "forest" ? "forest" : "rock";
    }
    return null;
  };

  it("nunca coloca decoración sobre celdas transitables ni sobre agua", () => {
    const inside = (p: { x: number; z: number }): boolean => p.x >= 0 && p.x <= MAP_WIDTH && p.z >= 0 && p.z <= MAP_DEPTH;
    for (const item of [...plan.trees, ...plan.bushes]) {
      if (inside(item)) {
        const terrain = blockedBy(item.x, item.z);
        expect(["rock", "forest"]).toContain(terrain);
        expect(item.y).toBe(terrain === "forest" ? 0 : ROCK_HEIGHT);
      } else {
        expect(item.y).toBe(0);
      }
    }
  });

  it("es determinista y no depende de la aleatoriedad de la partida", () => {
    expect(planScenery(MAP_WIDTH, MAP_DEPTH, MAP_LAYOUT.terrain)).toEqual(plan);
    expect(planScenery(MAP_WIDTH, MAP_DEPTH, MAP_LAYOUT.terrain, 99)).not.toEqual(plan);
  });
});

describe("P2-H07 barras de vida", () => {
  it("existe solo si 0 < vida < máximo", () => {
    expect(barState(100, 100).visible).toBe(false);
    expect(barState(0, 100).visible).toBe(false);
    expect(barState(-5, 100).visible).toBe(false);
    expect(barState(1, 100).visible).toBe(true);
    expect(barState(99, 100).visible).toBe(true);
    expect(barState(150, 100).visible).toBe(false);
  });

  it("la proporción se limita a [0, 1] y un máximo inválido oculta la barra", () => {
    expect(barState(25, 100).ratio).toBeCloseTo(0.25);
    expect(barState(500, 100).ratio).toBe(1);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const state = barState(10, bad);
      expect(state.visible).toBe(false);
      expect(state.invalid).toBe(true);
    }
  });
});

describe("P2-H03 poses de animación", () => {
  const base = (role: Role, over: Partial<PoseInput> = {}): PoseInput => ({ role, t: 0.4, walking: false, work: null, carrying: false, combatPhase: null, ...over });
  const finite = (o: object): boolean => Object.values(o).every((v) => Number.isFinite(v as number));

  it("es una función pura y siempre devuelve ángulos finitos", () => {
    for (const role of ["villager", "archer", "soldier"] as const) {
      for (const work of [null, "wood", "food", "build"] as const) {
        for (const combatPhase of [null, 0, 0.3, 0.7, 1]) {
          for (const walking of [false, true]) {
            const input = base(role, { work, combatPhase, walking, carrying: walking, t: 12.345 });
            expect(computePose(input)).toEqual(computePose(input));
            expect(finite(computePose(input))).toBe(true);
          }
        }
      }
    }
  });

  it("caminar mueve las piernas y detenerse las deja quietas", () => {
    expect(Math.abs(computePose(base("villager", { walking: true })).legL)).toBeGreaterThan(0.1);
    expect(computePose(base("villager")).legL).toBe(0);
  });

  it("el trabajo de cada tarea se distingue del reposo y entre sí", () => {
    const idle = computePose(base("villager"));
    const wood = computePose(base("villager", { work: "wood" }));
    const food = computePose(base("villager", { work: "food" }));
    const build = computePose(base("villager", { work: "build" }));
    expect(wood.armRx).not.toBeCloseTo(idle.armRx);
    expect(food.torsoPitch).toBeGreaterThan(0.5);
    expect(build.armRx).not.toBeCloseTo(wood.armRx, 2);
  });

  it("la talado y la construcción son cíclicas en el tiempo", () => {
    const a = computePose(base("villager", { work: "wood", t: 0.1 })).armRx;
    const b = computePose(base("villager", { work: "wood", t: 0.1 + 1 / 1.8 })).armRx;
    expect(a).toBeCloseTo(b, 5);
    expect(computePose(base("villager", { work: "wood", t: 0.35 })).armRx).not.toBeCloseTo(a, 2);
  });

  it("el soldado levanta y descarga el arma; el arquero tensa el arco y lo suelta", () => {
    const early = computePose(base("soldier", { combatPhase: 0 }));
    const hit = computePose(base("soldier", { combatPhase: 0.25 }));
    expect(early.armRx).toBeLessThan(-2);
    expect(hit.armRx).toBeGreaterThan(0);
    const draw = [0, 0.2, 0.5, 0.8, 1].map((p) => computePose(base("archer", { combatPhase: p })).bowDraw);
    expect(draw[0]).toBe(0);
    expect(draw[4]).toBeCloseTo(1);
    expect(draw[3]!).toBeGreaterThan(draw[2]!);
    expect(draw[2]!).toBeGreaterThan(draw[1]!);
  });
});

describe("eventos de golpe para el renderizador", () => {
  it("una partida sin combate no produce golpes", () => {
    const state = createInitialState(1);
    for (let i = 0; i < 100; i++) expect(stepSimulation(state).strikes).toEqual([]);
  });

  it("el combate emite un golpe por ataque efectivo con posiciones finitas", () => {
    const state = createFixture("skirmish").state;
    const mine = state.units.filter((u) => u.owner === 0 && u.kind !== "villager").map((u) => u.id);
    const enemy = state.units.find((u) => u.owner === 1 && u.kind === "soldier")!;
    const attack: Command = { id: "a1", seq: 1, tick: 0, player: 0, type: "Attack", entityIds: mine, target: { entityId: enemy.id } };
    const strikes: StrikeEvent[] = [];
    let hpLost = 0;
    const hp = (): number => state.units.reduce((s, u) => s + u.hp, 0) + state.buildings.reduce((s, b) => s + b.hp, 0);
    for (let i = 0; i < 1200; i++) {
      const before = hp();
      const result = stepSimulation(state, i === 0 ? [attack] : []);
      strikes.push(...result.strikes);
      hpLost += before - hp();
      for (const s of result.strikes) expect(s.tick).toBe(result.tick);
    }
    expect(strikes.length).toBeGreaterThan(0);
    for (const s of strikes) {
      expect(["soldier", "archer"]).toContain(s.attackerKind);
      expect(Number.isFinite(s.from.x + s.from.z + s.to.x + s.to.z)).toBe(true);
    }
    expect(hpLost).toBeGreaterThan(0);
  });
});
