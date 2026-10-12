import { describe, expect, it } from "vitest";
import { GameSession } from "../../src/app/session";
import { BALANCE, MAX_ACTIVE_TICKS } from "../../src/content/balance";
import { hashState } from "../../src/core/hash";
import { matchResult } from "../../src/core/result";
import { stepSimulation } from "../../src/core/simulation";
import { addBuilding, addTerrain, addUnit, createEmptyState, populationOf } from "../../src/core/state";
import type { Command, CommandResult, EntityId, GameState, PlayerId, Unit, UnitTask } from "../../src/core/types";

type Order = Omit<Command, "id" | "seq" | "tick" | "player"> & { player?: PlayerId };

function send(state: GameState, ...orders: Order[]): CommandResult[] {
  const base = state.lastCommandSeq;
  const commands: Command[] = orders.map((o, i) => ({ id: `c${base + i + 1}`, seq: base + i + 1, tick: state.tick, player: o.player ?? 0, ...o }));
  return stepSimulation(state, commands).results;
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

/** Mapa 40x40: centros en (2,16) y (34,16); el combate de las pruebas ocurre en el centro, lejos de ellos. */
function world(): GameState {
  const state = createEmptyState(1, 40);
  addBuilding(state, 0, "townCenter", 2, 16);
  addBuilding(state, 1, "townCenter", 34, 16);
  return state;
}

const attack = (units: Unit[], target: EntityId, player: PlayerId = 0): Order => ({ type: "Attack", entityIds: units.map((u) => u.id), target: { entityId: target }, player });
const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

describe("T-07 alcance (RF-08)", () => {
  it("el soldado golpea desde 0,5 celdas entre bordes y no desde más lejos", () => {
    const near = world();
    const s1 = addUnit(near, 0, "soldier", 20, 20);
    const v1 = addUnit(near, 1, "villager", 21.09375, 20); // bordes a 0,49375 (exacto en binario)
    send(near, attack([s1], v1.id));
    expect(v1.hp).toBe(BALANCE.units.villager.hp - BALANCE.units.soldier.damage);
    expect(s1.pos).toEqual({ x: 20, z: 20 });

    const far = world();
    const s2 = addUnit(far, 0, "soldier", 20, 20);
    const v2 = addUnit(far, 1, "villager", 20 + 0.6 + 0.6, 20); // bordes a 0,6
    send(far, attack([s2], v2.id));
    expect(v2.hp).toBe(BALANCE.units.villager.hp);
    runUntil(far, () => v2.hp < BALANCE.units.villager.hp, 100);
    expect(dist(s2.pos, v2.pos) - 0.6).toBeLessThanOrEqual(BALANCE.units.soldier.range + 1e-9);
  });

  it("el arquero dispara a 5 celdas sin moverse; más lejos se acerca hasta entrar en alcance", () => {
    const state = world();
    const a = addUnit(state, 0, "archer", 15, 20);
    const v = addUnit(state, 1, "villager", 15 + 0.6 + 4.9, 20);
    send(state, attack([a], v.id));
    expect(v.hp).toBe(BALANCE.units.villager.hp - BALANCE.units.archer.damage);
    expect(a.pos).toEqual({ x: 15, z: 20 });

    const far = world();
    const b = addUnit(far, 0, "archer", 15, 20);
    const w = addUnit(far, 1, "villager", 15 + 0.6 + 8, 20);
    send(far, attack([b], w.id));
    expect(w.hp).toBe(BALANCE.units.villager.hp);
    runUntil(far, () => w.hp < BALANCE.units.villager.hp, 200);
    expect(dist(b.pos, w.pos) - 0.6).toBeLessThanOrEqual(BALANCE.units.archer.range + 1e-9);
    expect(b.pos.x).toBeLessThan(15 + 8); // No llegó al cuerpo a cuerpo.
  });

  it("los edificios se atacan desde su borde y se destruyen sin reembolso", () => {
    const state = world();
    const house = addBuilding(state, 1, "house", 20, 20, false); // obra: vida inicial 30
    state.players[1].wood = 7;
    const s = addUnit(state, 0, "soldier", 19.6, 21);
    send(state, attack([s], house.id));
    expect(house.hp).toBe(BALANCE.buildings.house.hp - Math.floor(BALANCE.buildings.house.hp * 0.9) - BALANCE.units.soldier.damage);
    const version = state.obstacleVersion;
    runUntil(state, () => !state.buildings.includes(house), 200);
    expect(state.obstacleVersion).toBeGreaterThan(version);
    expect(state.players[1].wood).toBe(7);
  });
});

describe("T-07 enfriamiento", () => {
  it("un golpe por intervalo: soldado cada 20 ticks y arquero cada 30", () => {
    const state = world();
    const s = addUnit(state, 0, "soldier", 20, 20);
    const a = addUnit(state, 0, "archer", 20, 22);
    const v = addUnit(state, 1, "villager", 21, 20);
    const w = addUnit(state, 1, "villager", 21, 22);
    v.hp = 1000;
    w.hp = 1000;
    const hits: Record<string, number[]> = { s: [], a: [] };
    let hpV = v.hp;
    let hpW = w.hp;
    const orders = [attack([s], v.id), attack([a], w.id)];
    for (let t = 0; t < 100; t++) {
      if (t === 0) send(state, ...orders);
      else stepSimulation(state);
      if (v.hp < hpV) hits["s"]!.push(t);
      if (w.hp < hpW) hits["a"]!.push(t);
      hpV = v.hp;
      hpW = w.hp;
    }
    expect(hits["s"]![0]).toBe(0);
    expect(hits["a"]![0]).toBe(0);
    expect(hits["s"]!.slice(1).map((t, i) => t - hits["s"]![i]!)).toEqual([20, 20, 20, 20]);
    expect(hits["a"]!.slice(1).map((t, i) => t - hits["a"]![i]!)).toEqual([30, 30, 30]);
    expect(v.hp).toBe(1000 - 5 * BALANCE.units.soldier.damage);
    expect(w.hp).toBe(1000 - 4 * BALANCE.units.archer.damage);
  });
});

describe("T-07 obstáculos y objetivo", () => {
  it("no se ataca a través de un muro: el arquero rodea hasta tener línea de tiro", () => {
    const state = world();
    addTerrain(state, 20, 10, 1, 20);
    const a = addUnit(state, 0, "archer", 19.3, 20.5);
    const v = addUnit(state, 1, "villager", 21.7, 20.5);
    send(state, attack([a], v.id));
    expect(v.hp).toBe(BALANCE.units.villager.hp);
    runUntil(state, () => v.hp < BALANCE.units.villager.hp, 600);
    expect(a.pos.x).toBeGreaterThanOrEqual(20); // Pasó al otro lado o al extremo del muro.
  });

  it("un muro completo hace inalcanzable al objetivo y se rechaza con motivo", () => {
    const state = world();
    addTerrain(state, 20, 0, 1, 40);
    const a = addUnit(state, 0, "archer", 18, 20.5);
    const v = addUnit(state, 1, "villager", 22, 20.5);
    expect(codeOf(send(state, attack([a], v.id))[0])).toBe("UNREACHABLE");
    run(state, 30);
    expect(v.hp).toBe(BALANCE.units.villager.hp);
  });

  it("al morir el objetivo la unidad queda inactiva con motivo y el muerto no actúa", () => {
    const state = world();
    const s = addUnit(state, 0, "soldier", 20, 20);
    const v = addUnit(state, 1, "villager", 21, 20);
    v.hp = BALANCE.units.soldier.damage;
    send(state, attack([s], v.id));
    expect(state.units.includes(v)).toBe(false);
    run(state, 2);
    expect(s.job).toBeNull();
    expect(s.task).toBe<UnitTask>("idle");
    expect(s.idleReason).toBe("TARGET_DEAD");
    expect(codeOf(send(state, { type: "Stop", entityIds: [v.id], player: 1 })[0])).toBe("UNKNOWN_ENTITY");
  });

  it("muerte simultánea: ambos golpean aunque los dos mueran en el mismo tick", () => {
    const state = world();
    const a = addUnit(state, 0, "soldier", 20, 20);
    const b = addUnit(state, 1, "soldier", 21, 20);
    a.hp = 10;
    b.hp = 10;
    send(state, attack([a], b.id), attack([b], a.id, 1));
    expect(state.units.filter((u) => u.id === a.id || u.id === b.id)).toHaveLength(0);
  });

  it("sin fuego aliado: no se ataca a un aliado y los cercanos no reciben daño", () => {
    const state = world();
    const s = addUnit(state, 0, "soldier", 20, 20);
    const ally = addUnit(state, 0, "villager", 20.5, 20.5);
    const enemy = addUnit(state, 1, "villager", 21.1, 20);
    expect(codeOf(send(state, attack([s], ally.id))[0])).toBe("INVALID_TARGET");
    send(state, attack([s], enemy.id));
    run(state, 100);
    expect(ally.hp).toBe(BALANCE.units.villager.hp);
    expect(state.units.includes(enemy)).toBe(false);
  });

  it("valida objetivo y atacantes: ajeno inexistente, nodo, aldeanos", () => {
    const state = world();
    const s = addUnit(state, 0, "soldier", 20, 20);
    const v = addUnit(state, 0, "villager", 22, 20);
    const e = addUnit(state, 1, "villager", 30, 30);
    expect(codeOf(send(state, attack([s], 9999))[0])).toBe("INVALID_TARGET");
    expect(codeOf(send(state, attack([v], e.id))[0])).toBe("INCOMPATIBLE_ENTITY");
    const mixed = send(state, attack([s, v], e.id))[0]!;
    expect(mixed).toMatchObject({ accepted: true, assigned: 1, total: 1 });
  });
});

describe("T-07 adquisición automática y órdenes", () => {
  it("adquiere al más cercano dentro de 6 celdas, con empate por ID, y no más lejos", () => {
    const state = world();
    const s = addUnit(state, 0, "soldier", 20.5, 20.5);
    addUnit(state, 1, "villager", 30.5, 20.5); // 9,4 de borde: fuera
    run(state, 1);
    expect(s.job).toBeNull();

    const first = addUnit(state, 1, "villager", 23.5, 20.5);
    addUnit(state, 1, "villager", 17.5, 20.5); // Misma distancia, ID mayor.
    run(state, 1);
    expect(s.job).toMatchObject({ type: "attack", targetId: first.id });

    const t = world();
    const s2 = addUnit(t, 0, "soldier", 20.5, 20.5);
    addUnit(t, 1, "villager", 24.5, 20.5);
    const near = addUnit(t, 1, "villager", 20.5, 18.5);
    run(t, 1);
    expect(s2.job).toMatchObject({ targetId: near.id });
  });

  it("no adquiere a un enemigo inalcanzable detrás de un muro completo", () => {
    const state = world();
    addTerrain(state, 22, 0, 1, 40);
    const s = addUnit(state, 0, "soldier", 20.5, 20.5);
    addUnit(state, 1, "villager", 24.5, 20.5);
    run(state, 5);
    expect(s.job).toBeNull();
  });

  it("persigue hasta 8 celdas de su punto de adquisición y luego regresa a él", () => {
    const state = world();
    const s = addUnit(state, 0, "soldier", 20.5, 20.5);
    const e = addUnit(state, 1, "villager", 24.5, 20.5);
    send(state, { type: "Move", entityIds: [e.id], target: { x: 30.5, z: 5.5 }, player: 1 });
    expect(s.job).toMatchObject({ type: "attack" });

    runUntil(state, () => s.job === null, 400);
    expect(dist(s.pos, { x: 20.5, z: 20.5 })).toBeGreaterThan(7);
    runUntil(state, () => s.task === "idle", 400);
    expect(dist(s.pos, { x: 20.5, z: 20.5 })).toBeLessThan(1.5);
    expect(dist(s.pos, e.pos)).toBeGreaterThan(BALANCE.combat.acquireRange);
  });

  it("una orden explícita no tiene correa y reemplaza la conducta automática", () => {
    const state = world();
    const s = addUnit(state, 0, "soldier", 20.5, 20.5);
    const e = addUnit(state, 1, "villager", 24.5, 20.5);
    send(state, { type: "Move", entityIds: [e.id], target: { x: 30.5, z: 5.5 }, player: 1 }, attack([s], e.id));
    expect(s.job).toMatchObject({ type: "attack", anchor: null });
    run(state, 150);
    expect(s.job).toMatchObject({ type: "attack" });
    expect(dist(s.pos, { x: 20.5, z: 20.5 })).toBeGreaterThan(8);
  });

  it("Move cancela el ataque; Stop lo borra, pero el militar puede readquirir al tick siguiente", () => {
    const state = world();
    const s = addUnit(state, 0, "soldier", 20.5, 20.5);
    const e = addUnit(state, 1, "villager", 22.5, 20.5);
    e.hp = 1000;
    send(state, attack([s], e.id));
    send(state, { type: "Move", entityIds: [s.id], target: { x: 10.5, z: 20.5 } });
    expect(s.job).toBeNull();
    expect(s.task).toBe<UnitTask>("moving");

    const t = world();
    const s2 = addUnit(t, 0, "soldier", 20.5, 20.5);
    const e2 = addUnit(t, 1, "villager", 22.5, 20.5);
    e2.hp = 1000;
    send(t, attack([s2], e2.id));
    send(t, { type: "Stop", entityIds: [s2.id] });
    // Con un enemigo a la vista, la conducta automática lo recupera en el mismo ciclo.
    expect(s2.job).toMatchObject({ type: "attack", targetId: e2.id });
    expect(s2.job && s2.job.type === "attack" && s2.job.anchor).not.toBeNull();

    const quiet = world();
    const s3 = addUnit(quiet, 0, "soldier", 20.5, 20.5);
    send(quiet, { type: "Stop", entityIds: [s3.id] });
    expect(s3.job).toBeNull();
    expect(s3.task).toBe<UnitTask>("idle");
  });

  it("la producción de un edificio destruido se pierde y libera la población reservada", () => {
    const state = world();
    const barracks = addBuilding(state, 1, "barracks", 20, 20);
    barracks.queue.push({ id: state.nextEntityId++, kind: "soldier", remaining: 100 });
    expect(populationOf(state, 1)).toBe(1);
    const s = addUnit(state, 0, "soldier", 19.6, 21.5);
    barracks.hp = BALANCE.units.soldier.damage;
    send(state, attack([s], barracks.id));
    expect(state.buildings.includes(barracks)).toBe(false);
    expect(populationOf(state, 1)).toBe(0);
  });
});

describe("T-09 resultado y pausa (RF-11)", () => {
  const nearEnemyCenter = (state: GameState): Unit => addUnit(state, 0, "soldier", 33.7, 18);
  const nearOwnCenter = (state: GameState): Unit => addUnit(state, 1, "soldier", 6.3, 18);
  const centerOf = (state: GameState, owner: PlayerId) => state.buildings.find((b) => b.owner === owner && b.kind === "townCenter")!;

  it("el centro rival destruido da la victoria y congela la simulación", () => {
    const state = world();
    const s = nearEnemyCenter(state);
    const center = centerOf(state, 1);
    center.hp = BALANCE.units.soldier.damage;
    send(state, attack([s], center.id));
    expect(state.matchStatus).toBe("ended");
    expect(state.outcome).toMatchObject({ winner: 0, reason: "TOWN_CENTER_DESTROYED" });
    // P3-R08: la instantánea terminal conserva el edificio retirado con su vida real (0 de 3000), no un valor inventado.
    const rival = state.outcome!.mainBuildings.find((b) => b.owner === 1)!;
    expect(rival).toMatchObject({ destroyed: true, hp: 0, maxHp: BALANCE.buildings.townCenter.hp });
    expect(state.outcome!.mainBuildings.find((b) => b.owner === 0)).toMatchObject({ destroyed: false, hp: BALANCE.buildings.townCenter.hp });
    expect(state.outcome!.endTick).toBe(state.tick);
    expect(state.outcome!.casualties.buildings).toEqual([0, 1]);
    expect(matchResult(state, 0)).toBe("victoria");
    expect(matchResult(state, 1)).toBe("derrota");

    const frozen = hashState(state);
    const outcome = state.outcome;
    const results = stepSimulation(state, [{ id: "late", seq: 99, tick: 0, player: 0, type: "Stop", entityIds: [s.id] }]).results;
    expect(codeOf(results[0])).toBe("MATCH_ENDED");
    expect(hashState(state)).toBe(frozen);
    expect(state.outcome).toBe(outcome);
  });

  it("el centro propio destruido es derrota", () => {
    const state = world();
    const e = nearOwnCenter(state);
    const center = centerOf(state, 0);
    center.hp = BALANCE.units.soldier.damage;
    send(state, attack([e], center.id, 1));
    expect(state.outcome).toMatchObject({ winner: 1, reason: "TOWN_CENTER_DESTROYED" });
    expect(matchResult(state, 0)).toBe("derrota");
  });

  it("ambos centros destruidos en el mismo tick es empate", () => {
    const state = world();
    const s = nearEnemyCenter(state);
    const e = nearOwnCenter(state);
    centerOf(state, 0).hp = BALANCE.units.soldier.damage;
    centerOf(state, 1).hp = BALANCE.units.soldier.damage;
    send(state, attack([s], centerOf(state, 1).id), attack([e], centerOf(state, 0).id, 1));
    expect(state.outcome).toMatchObject({ winner: null, reason: "TOWN_CENTER_DESTROYED" });
    expect(state.outcome!.mainBuildings.every((b) => b.destroyed && b.hp === 0)).toBe(true);
    expect(matchResult(state, 0)).toBe("empate");
  });

  it("a los 24.000 ticks sin destrucción es empate; la destrucción tiene prioridad en ese tick", () => {
    const quiet = world();
    quiet.tick = MAX_ACTIVE_TICKS - 2;
    stepSimulation(quiet);
    expect(quiet.matchStatus).toBe("playing");
    stepSimulation(quiet);
    expect(quiet.tick).toBe(MAX_ACTIVE_TICKS);
    expect(quiet.outcome).toMatchObject({ winner: null, reason: "TIME_LIMIT", endTick: MAX_ACTIVE_TICKS });
    expect(quiet.outcome!.mainBuildings.every((b) => !b.destroyed && b.hp === BALANCE.buildings.townCenter.hp)).toBe(true);

    const decisive = world();
    decisive.tick = MAX_ACTIVE_TICKS - 1;
    const s = nearEnemyCenter(decisive);
    centerOf(decisive, 1).hp = BALANCE.units.soldier.damage;
    send(decisive, attack([s], centerOf(decisive, 1).id));
    expect(decisive.outcome).toMatchObject({ winner: 0, reason: "TOWN_CENTER_DESTROYED" });
  });

  it("los estados sin centros (fixtures de movimiento) no terminan la partida", () => {
    const state = createEmptyState(1, 40);
    addUnit(state, 0, "soldier", 5, 5);
    run(state, 50);
    expect(state.matchStatus).toBe("playing");
    expect(state.outcome).toBeNull();
  });

  it("la pausa detiene el combate y reanudar lo continúa", () => {
    const state = world();
    const s = addUnit(state, 0, "soldier", 20, 20);
    const e = addUnit(state, 1, "villager", 21.1, 20);
    e.hp = 1000;
    const session = new GameSession(1, { state, commands: [], groups: [] });
    session.issue({ type: "Attack", player: 0, entityIds: [s.id], target: { entityId: e.id } });
    session.advance(200);
    const before = hashState(session.state);
    session.pause();
    session.advance(5000);
    expect(hashState(session.state)).toBe(before);
    session.resume();
    session.advance(2000);
    expect(hashState(session.state)).not.toBe(before);
    expect(e.hp).toBeLessThan(1000);
  });
});

describe("T-10 reproducción del combate", () => {
  it("misma semilla y mismos comandos dan el mismo estado final", () => {
    const play = (): string => {
      const state = world();
      const a = [0, 1, 2].map((i) => addUnit(state, 0, i === 0 ? "archer" : "soldier", 20 + i * 0.7, 20));
      const b = [0, 1, 2].map((i) => addUnit(state, 1, "soldier", 23 + i * 0.7, 21));
      send(state, attack(a, b[0]!.id), attack(b, a[0]!.id, 1));
      run(state, 400);
      return hashState(state);
    };
    expect(play()).toBe(play());
  });
});
