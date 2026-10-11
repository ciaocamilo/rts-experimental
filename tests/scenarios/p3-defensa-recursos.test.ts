import { describe, expect, it } from "vitest";
import { GameSession } from "../../src/app/session";
import { BALANCE } from "../../src/content/balance";
import { matchResult } from "../../src/core/result";
import { stepSimulation } from "../../src/core/simulation";
import { addBuilding, addNode, addUnit, createEmptyState } from "../../src/core/state";
import type { Command, CommandResult, GameState, Unit } from "../../src/core/types";
import { finalSummary } from "../../src/diagnostics/report";

type Order = Omit<Command, "id" | "seq" | "tick" | "player"> & { player?: 0 | 1 };

function send(state: GameState, ...orders: Order[]): { results: CommandResult[]; strikes: ReturnType<typeof stepSimulation>["strikes"]; destroyed: ReturnType<typeof stepSimulation>["destroyed"] } {
  const base = state.lastCommandSeq;
  const commands: Command[] = orders.map((o, i) => ({ id: `c${base + i + 1}`, seq: base + i + 1, tick: state.tick, player: o.player ?? 0, ...o }));
  return stepSimulation(state, commands);
}

const codeOf = (r: CommandResult | undefined): string => (r ? (r.accepted ? "ok" : r.code) : "missing");

function run(state: GameState, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepSimulation(state);
}

function runUntil(state: GameState, done: () => boolean, max = 1500): number {
  for (let i = 0; i < max; i++) {
    if (done()) return i;
    stepSimulation(state);
  }
  throw new Error(`Condición no alcanzada en ${max} ticks`);
}

/** Mapa 40x40 con los dos centros urbanos, lejos de la zona de pruebas. */
function world(): GameState {
  const state = createEmptyState(1, 40);
  addBuilding(state, 0, "townCenter", 2, 16);
  addBuilding(state, 1, "townCenter", 34, 16);
  return state;
}

const gather = (u: Unit, nodeId: number): Order => ({ type: "Gather", entityIds: [u.id], target: { entityId: nodeId } });

describe("P3-R02 nodos que se agotan y piedra", () => {
  it("un nodo con 499 sigue en el mapa y uno con 1 desaparece al recoger la última unidad", () => {
    const state = world();
    const last = addNode(state, "food", 12, 18, 1);
    const rich = addNode(state, "wood", 12, 22, 500);
    const a = addUnit(state, 0, "villager", 11.5, 18.5);
    const b = addUnit(state, 0, "villager", 11.5, 22.5);
    send(state, gather(a, last.id), gather(b, rich.id));
    const version = state.obstacleVersion;

    runUntil(state, () => !state.resourceNodes.includes(last), 100);
    expect(state.obstacleVersion).toBeGreaterThan(version);
    expect(state.resourceNodes.includes(rich)).toBe(true);
    expect(rich.remaining).toBeLessThan(500);
    expect(rich.remaining).toBeGreaterThanOrEqual(497);

    run(state, 21); // 499 → sigue existiendo mientras quede algo.
    expect(state.resourceNodes.includes(rich)).toBe(true);
    // El villano que recogió la última unidad entrega y queda libre, sin quedarse atascado en el nodo retirado.
    runUntil(state, () => state.players[0].food > BALANCE.start.food, 400);
    expect(state.players[0].food).toBe(BALANCE.start.food + 1);
  });

  it("la piedra se recoge y se entrega como un recurso más", () => {
    const state = world();
    const node = addNode(state, "stone", 12, 18, 30);
    const v = addUnit(state, 0, "villager", 11.5, 18.5);
    send(state, gather(v, node.id));
    runUntil(state, () => state.players[0].stone > 0, 600);
    expect(state.players[0].stone).toBe(BALANCE.economy.carryCapacity);
    expect(state.players[0].food).toBe(BALANCE.start.food);
    expect(node.remaining).toBe(30 - BALANCE.economy.carryCapacity);
  });
});

describe("P3-R03 torre", () => {
  const build = (u: Unit, x: number, z: number): Order => ({ type: "Build", entityIds: [u.id], kind: "tower", target: { x, z } });

  it("cuesta exactamente 300 de piedra: con 299 se rechaza sin cobrar y con 300 se cobra una sola vez", () => {
    const poor = world();
    poor.players[0].stone = 299;
    const v1 = addUnit(poor, 0, "villager", 7.5, 10.5);
    const rejected = send(poor, build(v1, 10, 10)).results;
    expect(codeOf(rejected[0])).toBe("INSUFFICIENT_RESOURCES");
    expect(poor.players[0].stone).toBe(299);
    expect(poor.buildings.some((b) => b.kind === "tower")).toBe(false);

    const rich = world();
    rich.players[0].stone = 300;
    const v2 = addUnit(rich, 0, "villager", 7.5, 10.5);
    expect(codeOf(send(rich, build(v2, 10, 10)).results[0])).toBe("ok");
    expect(rich.players[0].stone).toBe(0);
    run(rich, 50);
    expect(rich.players[0].stone).toBe(0);
    expect(rich.buildings.filter((b) => b.kind === "tower")).toHaveLength(1);
  });

  it("dispara sin orden hasta el alcance del arquero y no tiene alcance mínimo", () => {
    const state = world();
    const tower = addBuilding(state, 0, "tower", 20, 20);
    const inside = addUnit(state, 1, "villager", 22 + 0.3 + 4.9, 21);
    const outside = addUnit(state, 1, "villager", 20.5, 28);
    inside.hp = 1000;
    outside.hp = 1000;
    const strikes = send(state).strikes;
    expect(strikes).toHaveLength(1);
    expect(strikes[0]).toMatchObject({ attackerKind: "tower", attackerId: tower.id, targetId: inside.id });
    expect(inside.hp).toBe(1000 - BALANCE.units.archer.damage);
    expect(outside.hp).toBe(1000);

    // Sin alcance mínimo: un enemigo pegado a la torre también recibe disparos.
    const close = world();
    addBuilding(close, 0, "tower", 20, 20);
    const adjacent = addUnit(close, 1, "villager", 22.31, 21);
    adjacent.hp = 1000;
    stepSimulation(close);
    expect(adjacent.hp).toBe(1000 - BALANCE.units.archer.damage);
  });

  it("el centro urbano dispara como la torre pero con 3 flechas: triple daño, misma cadencia y alcance", () => {
    const state = createEmptyState(1, 40);
    const center = addBuilding(state, 0, "townCenter", 10, 10);
    const inside = addUnit(state, 1, "villager", 14 + 0.3 + 4.9, 12);
    const outside = addUnit(state, 1, "villager", 12, 25);
    inside.hp = 1000;
    outside.hp = 1000;
    const { strikes } = send(state);
    expect(strikes).toHaveLength(3);
    expect(strikes.every((s) => s.attackerId === center.id && s.targetId === inside.id)).toBe(true);
    expect(inside.hp).toBe(1000 - 3 * BALANCE.units.archer.damage);
    expect(outside.hp).toBe(1000);
    run(state, BALANCE.units.archer.attackIntervalTicks - 2);
    expect(inside.hp).toBe(1000 - 3 * BALANCE.units.archer.damage);
    run(state, 2);
    expect(inside.hp).toBe(1000 - 6 * BALANCE.units.archer.damage);
  });

  it("la torre sigue disparando una sola flecha", () => {
    const state = createEmptyState(1, 40);
    addBuilding(state, 0, "tower", 20, 20);
    const target = addUnit(state, 1, "villager", 24, 21);
    target.hp = 1000;
    expect(send(state).strikes).toHaveLength(1);
    expect(target.hp).toBe(1000 - BALANCE.units.archer.damage);
  });

  it("respeta la cadencia del arquero y una obra sin terminar no dispara", () => {
    const state = world();
    addBuilding(state, 0, "tower", 20, 20);
    const target = addUnit(state, 1, "villager", 24, 21);
    target.hp = 1000;
    const hits: number[] = [];
    let last = target.hp;
    for (let t = 0; t < 100; t++) {
      stepSimulation(state);
      if (target.hp < last) hits.push(t);
      last = target.hp;
    }
    expect(hits[0]).toBe(0);
    expect(hits.slice(1).map((t, i) => t - hits[i]!)).toEqual([30, 30, 30]);

    const site = world();
    addBuilding(site, 0, "tower", 20, 20, false);
    const safe = addUnit(site, 1, "villager", 24, 21);
    run(site, 60);
    expect(safe.hp).toBe(BALANCE.units.villager.hp);
  });
});

describe("P3-R01 defensa automática", () => {
  it("un soldado que camina y recibe flechas se defiende, persigue al agresor y reanuda su camino al terminar", () => {
    const state = world();
    const soldier = addUnit(state, 0, "soldier", 10, 20);
    const archer = addUnit(state, 1, "archer", 14, 20);
    send(state, { type: "Move", entityIds: [soldier.id], target: { x: 10.5, z: 35.5 } }, { type: "Attack", entityIds: [archer.id], target: { entityId: soldier.id }, player: 1 });
    run(state, 2);
    expect(soldier.hp).toBeLessThan(BALANCE.units.soldier.hp);
    expect(soldier.job?.type).toBe("attack");
    expect(soldier.job?.type === "attack" && soldier.job.defense).toBe(true);

    runUntil(state, () => archer.hp < BALANCE.units.archer.hp, 200);
  });

  it("una orden de ataque a una unidad no se cambia por la defensa automática", () => {
    const state = world();
    const victim = addUnit(state, 1, "villager", 12, 12.5);
    victim.hp = 1000;
    const soldier = addUnit(state, 0, "soldier", 11, 12.5);
    const archer = addUnit(state, 1, "archer", 15, 20);
    send(state, { type: "Attack", entityIds: [soldier.id], target: { entityId: victim.id } }, { type: "Attack", entityIds: [archer.id], target: { entityId: soldier.id }, player: 1 });
    run(state, 3);
    expect(soldier.job?.type === "attack" && soldier.job.targetId).toBe(victim.id);
  });

  it("un ataque ordenado a un edificio cede ante un agresor y se retoma al abatirlo", () => {
    const state = world();
    const center = state.buildings.find((b) => b.owner === 1 && b.kind === "townCenter")!;
    const soldier = addUnit(state, 0, "soldier", 28, 18);
    const defender = addUnit(state, 1, "archer", 28, 23);
    defender.hp = 20;
    send(state, { type: "Attack", entityIds: [soldier.id], target: { entityId: center.id } }, { type: "Attack", entityIds: [defender.id], target: { entityId: soldier.id }, player: 1 });
    run(state, 2);
    expect(soldier.job?.type === "attack" && soldier.job.defense).toBe(true);
    runUntil(state, () => defender.hp <= 0, 300);
    run(state, 2);
    expect(soldier.job?.type === "attack" && !soldier.job.defense && soldier.job.targetId).toBe(center.id);
  });

  it("un militar herido por una torre la contraataca", () => {
    const state = world();
    const tower = addBuilding(state, 1, "tower", 20, 20);
    const soldier = addUnit(state, 0, "soldier", 25, 21);
    run(state, 2);
    expect(soldier.hp).toBeLessThan(BALANCE.units.soldier.hp);
    expect(soldier.job?.type === "attack" && soldier.job.targetId).toBe(tower.id);
    expect(soldier.job?.type === "attack" && soldier.job.defense).toBe(true);
  });

  it("un aldeano que recolecta y es golpeado contraataca con daño débil y no abandona su puesto sin agresión", () => {
    const state = world();
    const node = addNode(state, "food", 12, 18, 500);
    const worker = addUnit(state, 0, "villager", 11.5, 18.5);
    const calm = addUnit(state, 0, "villager", 11.5, 19.5);
    const raider = addUnit(state, 1, "soldier", 11.5, 17.5);
    raider.hp = 1000;
    send(state, gather(worker, node.id), gather(calm, node.id), { type: "Attack", entityIds: [raider.id], target: { entityId: worker.id }, player: 1 });
    runUntil(state, () => worker.hp < BALANCE.units.villager.hp, 100);
    run(state, 2);
    expect(worker.job?.type === "attack" && worker.job.defense).toBe(true);
    expect(calm.job?.type).toBe("gather");
    runUntil(state, () => raider.hp < 1000, 200);
    expect(raider.hp).toBe(1000 - BALANCE.units.villager.damage);
  });

  it("un aldeano no adquiere enemigos por su cuenta ni acepta órdenes de ataque", () => {
    const state = world();
    const idle = addUnit(state, 0, "villager", 20, 20);
    const foe = addUnit(state, 1, "villager", 22, 20);
    expect(codeOf(send(state, { type: "Attack", entityIds: [idle.id], target: { entityId: foe.id } }).results[0])).not.toBe("ok");
    run(state, 5);
    expect(idle.job).toBeNull();
    expect(foe.hp).toBe(BALANCE.units.villager.hp);
  });
});

describe("P3-R05 destrucción de edificios", () => {
  it("el paso devuelve el edificio retirado y la sesión lo anota con un identificador creciente", () => {
    const state = world();
    const house = addBuilding(state, 1, "house", 20, 20);
    house.hp = BALANCE.units.soldier.damage;
    const soldier = addUnit(state, 0, "soldier", 19.6, 21);
    const session = new GameSession(1, { state, commands: [], groups: [] });
    session.issue({ type: "Attack", player: 0, entityIds: [soldier.id], target: { entityId: house.id } });
    session.stepOnce();
    expect(state.buildings.includes(house)).toBe(false);
    expect(session.destroyedLog).toHaveLength(1);
    expect(session.destroyedLog[0]).toMatchObject({ id: house.id, owner: 1, kind: "house", seq: 1 });
    session.stepOnce();
    expect(session.destroyedLog).toHaveLength(1);
  });
});

describe("P3-R08 resultado final coherente con la vida exportada", () => {
  it("el resumen final usa la misma vida que el resultado y no existe mientras se juega", () => {
    const state = world();
    expect(finalSummary(state)).toBeNull();
    const center = state.buildings.find((b) => b.owner === 1 && b.kind === "townCenter")!;
    center.hp = BALANCE.units.soldier.damage;
    const soldier = addUnit(state, 0, "soldier", 33.7, 18);
    send(state, { type: "Attack", entityIds: [soldier.id], target: { entityId: center.id } });

    const summary = finalSummary(state)!;
    expect(summary.result).toBe(matchResult(state));
    expect(summary).toMatchObject({ result: "victoria", winner: 0, reason: "TOWN_CENTER_DESTROYED", end_tick: state.tick });
    const rival = summary.main_buildings.find((b) => b.owner === 1)!;
    expect(rival).toMatchObject({ destroyed: true, hp: 0, max_hp: BALANCE.buildings.townCenter.hp, health_ratio: 0 });
    const own = summary.main_buildings.find((b) => b.owner === 0)!;
    expect(own).toMatchObject({ destroyed: false, hp: BALANCE.buildings.townCenter.hp, health_ratio: 1 });
  });
});
