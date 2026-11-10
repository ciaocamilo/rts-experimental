import { describe, expect, it } from "vitest";
import { BALANCE, TICKS_PER_SECOND, validateBalance } from "../../src/content/balance";
import { flightTicksFor, splashDamage, splashFactor } from "../../src/core/artillery";
import { edgeDistance } from "../../src/core/combat";
import { combatLabel, combatStats, rangeText } from "../../src/input/selection";
import { createFixture } from "../../src/core/fixtures";
import { hashState } from "../../src/core/hash";
import { stepSimulation } from "../../src/core/simulation";
import { addBuilding, addUnit, createEmptyState } from "../../src/core/state";
import type { Command, GameState, ImpactEvent, StrikeEvent } from "../../src/core/types";

const ART = BALANCE.units.cannon.artillery!;

function world(): GameState {
  const state = createEmptyState(1, 40);
  addBuilding(state, 0, "townCenter", 2, 16);
  addBuilding(state, 1, "townCenter", 34, 16);
  return state;
}

function order(state: GameState, partial: Pick<Command, "type" | "entityIds" | "target" | "kind"> & { player?: 0 | 1 }): Command {
  const seq = state.lastCommandSeq + 1;
  return { id: `c${seq}`, seq, tick: state.tick, player: partial.player ?? 0, ...partial };
}

function run(state: GameState, ticks: number): { strikes: StrikeEvent[]; impacts: ImpactEvent[] } {
  const out = { strikes: [] as StrikeEvent[], impacts: [] as ImpactEvent[] };
  for (let i = 0; i < ticks; i++) {
    const r = stepSimulation(state);
    out.strikes.push(...r.strikes);
    out.impacts.push(...r.impacts);
  }
  return out;
}

describe("P9 balance de caballero y cañón", () => {
  it("el balance es válido", () => {
    expect(() => validateBalance(BALANCE)).not.toThrow();
  });

  it("el caballero ataca como el soldado y se mueve al doble de velocidad", () => {
    const k = BALANCE.units.knight;
    const s = BALANCE.units.soldier;
    expect(k.speedCellsPerSec).toBe(2 * s.speedCellsPerSec);
    expect(k.damage).toBe(s.damage);
    expect(k.attackIntervalTicks).toBe(s.attackIntervalTicks);
    expect(k.range).toBe(s.range);
  });

  it("el cañón es caro, de alto daño, con un 50 % más de alcance que el arquero y una distancia mínima", () => {
    const c = BALANCE.units.cannon;
    expect(c.range).toBe(BALANCE.units.archer.range * 1.5);
    expect(ART.minRange).toBeGreaterThan(0);
    expect(ART.minRange).toBeLessThan(c.range);
    expect(c.damage).toBeGreaterThan(BALANCE.units.soldier.damage * 4);
    const total = (u: typeof c): number => u.cost.food + u.cost.wood + u.cost.stone;
    for (const other of [BALANCE.units.soldier, BALANCE.units.archer, BALANCE.units.knight]) expect(total(c)).toBeGreaterThan(total(other));
  });

  it("la tarjeta del cañón muestra el área, el alcance de 7,5 y la distancia mínima", () => {
    const s = combatStats("cannon")!;
    expect(s).toMatchObject({ area: true, minRange: 2.5, range: 7.5 });
    expect(combatLabel(s)).toBe("Ataque 50 en área, alcance 7,5, distancia mínima 2,5");
    expect(rangeText(s)).toBe("2,5–7,5");
    expect(rangeText(combatStats("archer")!)).toBe("5");
    expect(rangeText({ attack: 10, range: null })).toBe("");
  });

  it("el establo entrena caballeros y la armería cañones", () => {
    expect(BALANCE.buildings.stable.trains).toEqual(["knight"]);
    expect(BALANCE.buildings.armory.trains).toEqual(["cannon"]);
    expect(BALANCE.buildings.barracks.trains).not.toContain("knight");
    expect(BALANCE.buildings.stable.constructible && BALANCE.buildings.armory.constructible).toBe(true);
  });
});

describe("P9 edificios", () => {
  it("construir el establo y la armería descuenta madera y piedra", () => {
    const state = world();
    const v = addUnit(state, 0, "villager", 8.5, 8.5);
    const p = state.players[0]!;
    p.wood = 1000;
    p.stone = 1000;
    const wood = p.wood;
    const stone = p.stone;
    let r = stepSimulation(state, [order(state, { type: "Build", entityIds: [v.id], kind: "stable", target: { x: 10, z: 10 } })]);
    expect(r.results[0]!.accepted).toBe(true);
    r = stepSimulation(state, [order(state, { type: "Build", entityIds: [v.id], kind: "armory", target: { x: 10, z: 24 } })]);
    expect(r.results[0]!.accepted).toBe(true);
    expect(p.wood).toBe(wood - BALANCE.buildings.stable.cost.wood - BALANCE.buildings.armory.cost.wood);
    expect(p.stone).toBe(stone - BALANCE.buildings.armory.cost.stone);
  });

  it("sin piedra suficiente no se construye la armería", () => {
    const state = world();
    const v = addUnit(state, 0, "villager", 8.5, 8.5);
    state.players[0]!.wood = 1000;
    state.players[0]!.stone = BALANCE.buildings.armory.cost.stone - 1;
    const r = stepSimulation(state, [order(state, { type: "Build", entityIds: [v.id], kind: "armory", target: { x: 10, z: 10 } })]);
    expect(r.results[0]).toMatchObject({ accepted: false, code: "INSUFFICIENT_RESOURCES" });
  });

  it("el establo entrena un caballero, lo cobra y devuelve todo al cancelar", () => {
    const state = world();
    const stable = addBuilding(state, 0, "stable", 10, 10);
    const p = state.players[0]!;
    p.food = 500;
    p.wood = 500;
    const before = { food: p.food, wood: p.wood };
    const r = stepSimulation(state, [order(state, { type: "Train", entityIds: [stable.id], kind: "knight" })]);
    expect(r.results[0]!.accepted).toBe(true);
    expect(p.food).toBe(before.food - BALANCE.units.knight.cost.food);
    expect(p.wood).toBe(before.wood - BALANCE.units.knight.cost.wood);
    const item = stable.queue[0]!;
    stepSimulation(state, [order(state, { type: "CancelTraining", entityIds: [stable.id], target: { entityId: item.id } })]);
    expect(p.food).toBe(before.food);
    expect(p.wood).toBe(before.wood);
  });

  it("el caballero sale del establo tras su tiempo de entrenamiento", () => {
    const state = world();
    const stable = addBuilding(state, 0, "stable", 10, 10);
    state.players[0]!.food = 500;
    state.players[0]!.wood = 500;
    stepSimulation(state, [order(state, { type: "Train", entityIds: [stable.id], kind: "knight" })]);
    let spawned = 0;
    for (let i = 0; i < BALANCE.units.knight.trainTicks + 5; i++) spawned += stepSimulation(state).spawns.filter((s) => s.kind === "knight").length;
    expect(spawned).toBe(1);
    expect(state.units.filter((u) => u.kind === "knight")).toHaveLength(1);
  });

  it("la armería necesita piedra para el cañón y el establo no lo fabrica", () => {
    const state = world();
    const armory = addBuilding(state, 0, "armory", 10, 10);
    const stable = addBuilding(state, 0, "stable", 10, 20);
    const p = state.players[0]!;
    p.food = 1000;
    p.wood = 1000;
    p.stone = BALANCE.units.cannon.cost.stone - 1;
    let r = stepSimulation(state, [order(state, { type: "Train", entityIds: [armory.id], kind: "cannon" })]);
    expect(r.results[0]).toMatchObject({ accepted: false, code: "INSUFFICIENT_RESOURCES" });
    p.stone = 1000;
    r = stepSimulation(state, [order(state, { type: "Train", entityIds: [stable.id], kind: "cannon" })]);
    expect(r.results[0]!.accepted).toBe(false);
    r = stepSimulation(state, [order(state, { type: "Train", entityIds: [armory.id], kind: "cannon" })]);
    expect(r.results[0]!.accepted).toBe(true);
    expect(p.stone).toBe(1000 - BALANCE.units.cannon.cost.stone);
  });
});

describe("P9 movimiento del caballero", () => {
  it("recorre la misma distancia en la mitad de ticks que un soldado", () => {
    const arrival = (kind: "soldier" | "knight"): number => {
      const state = createEmptyState(1, 40);
      addBuilding(state, 0, "townCenter", 2, 2);
      addBuilding(state, 1, "townCenter", 34, 34);
      const u = addUnit(state, 0, kind, 10.5, 20.5);
      stepSimulation(state, [order(state, { type: "Move", entityIds: [u.id], target: { x: 30.5, z: 20.5 } })]);
      let ticks = 1;
      while (u.dest !== null && ticks < 2000) {
        stepSimulation(state);
        ticks++;
      }
      expect(Math.hypot(u.pos.x - 30.5, u.pos.z - 20.5)).toBeLessThan(0.6);
      return ticks;
    };
    const ratio = arrival("soldier") / arrival("knight");
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
  });
});

describe("P9 artillería", () => {
  it("el vuelo es proporcional a la distancia y está acotado", () => {
    expect(flightTicksFor(ART, 0.1)).toBe(ART.minFlightTicks);
    expect(flightTicksFor(ART, 100)).toBe(ART.maxFlightTicks);
    for (let d = 0; d <= 6; d += 0.25) {
      const t = flightTicksFor(ART, d);
      expect(t).toBeGreaterThanOrEqual(ART.minFlightTicks);
      expect(t).toBeLessThanOrEqual(ART.maxFlightTicks);
    }
    expect(flightTicksFor(ART, 5)).toBeGreaterThanOrEqual(flightTicksFor(ART, 3));
    expect(BALANCE.units.cannon.range / (ART.shotSpeedCellsPerSec / TICKS_PER_SECOND)).toBeLessThan(ART.maxFlightTicks);
  });

  it("el daño de área decae de 100 % en el centro a 50 % en el borde y 0 fuera", () => {
    const dmg = BALANCE.units.cannon.damage;
    expect(splashFactor(ART, 0)).toBe(1);
    expect(splashFactor(ART, ART.splashRadius)).toBeCloseTo(ART.edgeDamageRatio, 10);
    expect(splashFactor(ART, ART.splashRadius + 0.01)).toBe(0);
    expect(splashDamage(dmg, ART, 0, false)).toBe(50);
    expect(splashDamage(dmg, ART, 1, false)).toBe(38);
    expect(splashDamage(dmg, ART, 2, false)).toBe(25);
    expect(splashDamage(dmg, ART, 2.1, false)).toBe(0);
    expect(splashDamage(dmg, ART, 0, true)).toBe(100);
    expect(splashDamage(dmg, ART, 2, true)).toBe(50);
    expect(splashDamage(1, { ...ART, edgeDamageRatio: 0.1 }, 2, false)).toBe(1);
  });

  function duel(): { state: GameState; cannon: ReturnType<typeof addUnit>; target: ReturnType<typeof addUnit>; near: ReturnType<typeof addUnit>; far: ReturnType<typeof addUnit>; friend: ReturnType<typeof addUnit> } {
    const state = world();
    const cannon = addUnit(state, 0, "cannon", 15.5, 20.5);
    const target = addUnit(state, 1, "villager", 19.5, 20.5);
    const near = addUnit(state, 1, "villager", 20.5, 20.5);
    const far = addUnit(state, 1, "villager", 25.5, 20.5);
    const friend = addUnit(state, 0, "villager", 19.5, 21.5);
    for (const u of [target, near, far, friend]) u.hp = 100;
    stepSimulation(state, [order(state, { type: "Attack", entityIds: [cannon.id], target: { entityId: target.id } })]);
    return { state, cannon, target, near, far, friend };
  }

  it("la bala cae en el tick previsto y daña por área sin fuego amigo", () => {
    const { state, target, near, far, friend } = duel();
    let guard = 0;
    while (state.projectiles.length === 0 && guard++ < 100) stepSimulation(state);
    expect(state.projectiles).toHaveLength(1);
    const shot = state.projectiles[0]!;
    expect(shot.impactTick - shot.launchTick).toBeGreaterThanOrEqual(ART.minFlightTicks);
    expect(shot.impactTick - shot.launchTick).toBeLessThanOrEqual(ART.maxFlightTicks);
    expect(target.hp).toBe(100);

    const impacts: ImpactEvent[] = [];
    while (state.projectiles.length > 0) impacts.push(...stepSimulation(state).impacts);
    expect(impacts).toHaveLength(1);
    expect(impacts[0]!.tick).toBe(shot.impactTick);
    expect(target.hp).toBeLessThan(100);
    expect(near.hp).toBeLessThan(100);
    expect(near.hp).toBeGreaterThanOrEqual(target.hp);
    expect(far.hp).toBe(100);
    expect(friend.hp).toBe(100);
    expect(impacts[0]!.hits.map((h) => h.id).sort()).toEqual([target.id, near.id].sort());
  });

  it("la bala ya disparada impacta aunque su cañón muera", () => {
    const { state, cannon, target } = duel();
    let guard = 0;
    while (state.projectiles.length === 0 && guard++ < 100) stepSimulation(state);
    cannon.hp = 0;
    const before = target.hp;
    stepSimulation(state);
    expect(state.units.some((u) => u.id === cannon.id)).toBe(false);
    run(state, ART.maxFlightTicks + 1);
    expect(state.projectiles).toHaveLength(0);
    expect(target.hp).toBeLessThan(before);
  });

  it("daña edificios cercanos con el multiplicador y los destruye", () => {
    const state = world();
    const cannon = addUnit(state, 0, "cannon", 14.5, 24.5);
    const house = addBuilding(state, 1, "house", 18, 24);
    house.hp = 60;
    stepSimulation(state, [order(state, { type: "Attack", entityIds: [cannon.id], target: { entityId: house.id } })]);
    const out = run(state, TICKS_PER_SECOND * 8);
    expect(out.impacts.length).toBeGreaterThan(0);
    expect(out.impacts[0]!.hits.some((h) => h.kind === "building" && h.id === house.id)).toBe(true);
    expect(state.buildings.some((b) => b.id === house.id)).toBe(false);
  });

  it("el escenario de artillería es determinista y produce impactos con daño", () => {
    const play = (): { hash: string; impacts: number; damage: number } => {
      const { state, commands } = createFixture("artilleria");
      let impacts = 0;
      let damage = 0;
      for (let i = 0; i < 400; i++) {
        const r = stepSimulation(state, i === 0 ? commands : []);
        impacts += r.impacts.length;
        for (const im of r.impacts) for (const h of im.hits) damage += h.damage;
      }
      return { hash: hashState(state), impacts, damage };
    };
    const a = play();
    const b = play();
    expect(a).toEqual(b);
    expect(a.impacts).toBeGreaterThan(0);
    expect(a.damage).toBeGreaterThan(0);
  });

  it("los caballeros del escenario llegan a su destino sin atascarse", () => {
    const { state, commands } = createFixture("artilleria");
    for (let i = 0; i < 200; i++) stepSimulation(state, i === 0 ? commands : []);
    const knights = state.units.filter((u) => u.kind === "knight" && u.owner === 0);
    expect(knights.length).toBeGreaterThan(0);
    for (const k of knights) expect(Math.hypot(k.pos.x - 24.5, k.pos.z - 22.5)).toBeLessThan(3);
  });
});

describe("P9 distancia mínima del cañón", () => {
  const cannonDef = BALANCE.units.cannon;

  it("el alcance llega a 7,5 celdas y la distancia mínima deja un hueco de tiro", () => {
    const state = world();
    const cannon = addUnit(state, 0, "cannon", 15.5, 20.5);
    const gap = cannonDef.radius + BALANCE.units.villager.radius;
    const at = (edge: number): ReturnType<typeof addUnit> => addUnit(state, 1, "villager", 15.5 + edge + gap, 20.5);
    expect(edgeDistance(cannon, at(ART.minRange - 0.2))).toBeLessThan(ART.minRange);
    expect(edgeDistance(cannon, at(cannonDef.range - 0.05))).toBeLessThanOrEqual(cannonDef.range);
    expect(edgeDistance(cannon, at(cannonDef.range + 0.2))).toBeGreaterThan(cannonDef.range);
    expect(cannonDef.range).toBe(7.5);
  });

  it("si el objetivo está demasiado cerca retrocede y solo entonces dispara", () => {
    const state = world();
    const cannon = addUnit(state, 0, "cannon", 15.5, 20.5);
    const target = addUnit(state, 1, "villager", 16.7, 20.5);
    target.hp = 500;
    expect(edgeDistance(cannon, target)).toBeLessThan(ART.minRange);
    stepSimulation(state, [order(state, { type: "Attack", entityIds: [cannon.id], target: { entityId: target.id } })]);
    let guard = 0;
    while (state.projectiles.length === 0 && guard++ < 400) stepSimulation(state);
    expect(state.projectiles).toHaveLength(1);
    expect(edgeDistance(cannon, target)).toBeGreaterThanOrEqual(ART.minRange);
    expect(edgeDistance(cannon, target)).toBeLessThanOrEqual(cannonDef.range);
    expect(cannon.pos.x).toBeLessThan(15.5);
  });

  it("dispara sin moverse a un objetivo a 7 celdas, más allá del alcance del arquero", () => {
    expect(7).toBeGreaterThan(BALANCE.units.archer.range);
    const state = world();
    const cannon = addUnit(state, 0, "cannon", 15.5, 20.5);
    const target = addUnit(state, 1, "villager", 15.5 + 7 + cannonDef.radius + BALANCE.units.villager.radius, 20.5);
    target.hp = 500;
    stepSimulation(state, [order(state, { type: "Attack", entityIds: [cannon.id], target: { entityId: target.id } })]);
    let guard = 0;
    while (state.projectiles.length === 0 && guard++ < 100) stepSimulation(state);
    expect(state.projectiles).toHaveLength(1);
    expect(cannon.pos).toEqual({ x: 15.5, z: 20.5 });
  });

  it("sin orden prefiere el enemigo a distancia de tiro antes que el que tiene encima", () => {
    const state = world();
    const cannon = addUnit(state, 0, "cannon", 15.5, 20.5);
    const close = addUnit(state, 1, "villager", 16.6, 20.5);
    const good = addUnit(state, 1, "villager", 19.5, 20.5);
    close.hp = 500;
    good.hp = 500;
    let guard = 0;
    while (state.projectiles.length === 0 && guard++ < 100) stepSimulation(state);
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles[0]!.to.x).toBeCloseTo(good.pos.x, 5);
    expect(cannon.pos).toEqual({ x: 15.5, z: 20.5 });
  });
});
