import { describe, expect, it } from "vitest";
import { BALANCE } from "../../src/content/balance";
import { hashState } from "../../src/core/hash";
import { currentGrid } from "../../src/core/obstacles";
import { previewPlacement } from "../../src/core/placement";
import { stepSimulation } from "../../src/core/simulation";
import { addBuilding, addNode, addTerrain, addUnit, createEmptyState, createInitialState, livingOf, populationOf, reservedOf } from "../../src/core/state";
import type { Command, CommandResult, GameState, Unit } from "../../src/core/types";

type Order = Omit<Command, "id" | "seq" | "tick" | "player"> & { player?: 0 | 1 };

/** Envía órdenes en un tick, con secuencias crecientes, y devuelve los resultados. */
function send(state: GameState, ...orders: Order[]): CommandResult[] {
  const base = state.lastCommandSeq;
  const commands: Command[] = orders.map((o, i) => ({ id: `c${base + i + 1}`, seq: base + i + 1, tick: state.tick, player: o.player ?? 0, ...o }));
  return stepSimulation(state, commands).results;
}

function codeOf(r: CommandResult | undefined): string {
  if (!r) return "missing";
  return r.accepted ? "ok" : r.code;
}

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

/** Mapa 40x40 sin terreno: centro urbano propio en (2,16) y rival en (34,16). */
function world(): GameState {
  const state = createEmptyState(1, 40);
  addBuilding(state, 0, "townCenter", 2, 16);
  addBuilding(state, 1, "townCenter", 34, 16);
  return state;
}

const gather = (u: Unit | Unit[], nodeId: number): Order => ({ type: "Gather", entityIds: [u].flat().map((x) => x.id), target: { entityId: nodeId } });
const build = (u: Unit, kind: "house" | "barracks", x: number, z: number): Order => ({ type: "Build", entityIds: [u.id], kind, target: { x, z } });

describe("T-04 recolección y entrega (RF-05)", () => {
  it("la carga viaja con la unidad y el saldo solo sube al entregar", () => {
    const state = world();
    const node = addNode(state, "food", 12, 18, 30);
    const v = addUnit(state, 0, "villager", 9.5, 18.5);
    send(state, gather(v, node.id));

    runUntil(state, () => (v.carry?.amount ?? 0) >= 3);
    expect(state.players[0].food).toBe(BALANCE.start.food);
    expect(v.carry?.kind).toBe("food");

    runUntil(state, () => state.players[0].food > BALANCE.start.food);
    expect(state.players[0].food).toBe(BALANCE.start.food + BALANCE.economy.carryCapacity);
    expect(v.carry).toBeNull();
    expect(node.remaining).toBe(30 - BALANCE.economy.carryCapacity);
    expect(v.job?.type).toBe("gather"); // Vuelve al nodo.
  });

  it("recoge una unidad cada 20 ticks", () => {
    const state = world();
    const node = addNode(state, "wood", 12, 18, 30);
    const v = addUnit(state, 0, "villager", 11.5, 18.5);
    send(state, gather(v, node.id));
    run(state, 21);
    expect(v.carry?.amount).toBe(1);
    run(state, 20);
    expect(v.carry?.amount).toBe(2);
  });

  it("con un solo recurso restante lo obtiene la unidad de menor ID", () => {
    const state = world();
    const node = addNode(state, "food", 12, 18, 1);
    const a = addUnit(state, 0, "villager", 11.5, 18.5);
    const b = addUnit(state, 0, "villager", 11.5, 19.5);
    send(state, gather([b, a], node.id));
    run(state, 25);
    expect(node.remaining).toBe(0);
    expect(a.carry).toEqual({ kind: "food", amount: 1 });
    expect(b.carry).toBeNull();
    expect(b.job).toBeNull();
  });

  it("la unidad que muere pierde su carga y no cambia el saldo", () => {
    const state = world();
    const v = addUnit(state, 0, "villager", 9.5, 18.5);
    v.carry = { kind: "food", amount: 7 };
    v.hp = 0;
    stepSimulation(state);
    expect(state.units).toHaveLength(0);
    expect(state.players[0].food).toBe(BALANCE.start.food);
  });

  it("una orden nueva conserva la carga y Gather la retoma sin perderla", () => {
    const state = world();
    const node = addNode(state, "food", 12, 18, 30);
    const v = addUnit(state, 0, "villager", 11.5, 18.5);
    send(state, gather(v, node.id));
    runUntil(state, () => (v.carry?.amount ?? 0) >= 2);
    send(state, { type: "Move", entityIds: [v.id], target: { x: 20.5, z: 30.5 } });
    expect(v.job).toBeNull();
    expect(v.carry).toEqual({ kind: "food", amount: 2 });

    send(state, gather(v, node.id));
    runUntil(state, () => state.players[0].food > BALANCE.start.food);
    expect(state.players[0].food).toBe(BALANCE.start.food + 10);
    expect(node.remaining).toBe(20); // Solo se extrajeron 10 en total: la carga previa contó.
  });

  it("no mezcla tipos: entrega la carga antes de recoger otro recurso", () => {
    const state = world();
    const node = addNode(state, "food", 12, 18, 30);
    const v = addUnit(state, 0, "villager", 9.5, 18.5);
    v.carry = { kind: "wood", amount: 5 };
    send(state, gather(v, node.id));
    expect(v.job).toMatchObject({ type: "gather", stage: "return" });

    runUntil(state, () => state.players[0].wood > BALANCE.start.wood);
    expect(state.players[0].wood).toBe(BALANCE.start.wood + 5);
    expect(v.carry).toBeNull();
    runUntil(state, () => v.carry?.kind === "food");
    expect(state.players[0].wood).toBe(BALANCE.start.wood + 5);
  });

  it("un nodo agotado deja de ser obstáculo y el aldeano entrega y queda libre", () => {
    const state = world();
    const node = addNode(state, "food", 12, 18, 1);
    const v = addUnit(state, 0, "villager", 11.5, 18.5);
    expect(currentGrid(state).isBlocked(12, 18)).toBe(true);
    send(state, gather(v, node.id));
    run(state, 25);
    expect(node.remaining).toBe(0);
    stepSimulation(state);
    expect(currentGrid(state).isBlocked(12, 18)).toBe(false);

    runUntil(state, () => state.players[0].food > BALANCE.start.food);
    expect(state.players[0].food).toBe(BALANCE.start.food + 1);
    run(state, 2);
    expect(v.job).toBeNull();
  });

  it("rechaza recolectar de un nodo agotado, de un edificio o con unidades no aldeanas", () => {
    const state = world();
    const empty = addNode(state, "food", 12, 18, 0);
    const live = addNode(state, "food", 12, 22, 5);
    const v = addUnit(state, 0, "villager", 9.5, 18.5);
    const s = addUnit(state, 0, "soldier", 9.5, 20.5);
    const [r1, r2, r3] = send(state, gather(v, empty.id), gather(v, state.buildings[0]!.id), gather(s, live.id));
    expect(codeOf(r1)).toBe("INVALID_TARGET");
    expect(codeOf(r2)).toBe("INVALID_TARGET");
    expect(codeOf(r3)).toBe("INCOMPATIBLE_ENTITY");
  });
});

describe("T-05 construcción (RF-06)", () => {
  function site(state: GameState) {
    return state.buildings.find((b) => !b.complete);
  }

  it("una obra aceptada cobra, nace con 10 % de vida y bloquea su huella al instante", () => {
    const state = world();
    const v = addUnit(state, 0, "villager", 8.5, 14.5);
    const [r] = send(state, build(v, "house", 10, 10));
    expect(codeOf(r)).toBe("ok");
    expect(state.players[0].wood).toBe(150);
    const s = site(state)!;
    expect(s).toMatchObject({ kind: "house", complete: false, hp: 30, buildDone: 0 });
    expect(currentGrid(state).isBlocked(10, 10)).toBe(true);
    expect(currentGrid(state).isBlocked(11, 11)).toBe(true);
    expect(v.job).toMatchObject({ type: "build", siteId: s.id });
  });

  it("dos obras sobre la misma huella en un tick: solo una cobra", () => {
    const state = world();
    const a = addUnit(state, 0, "villager", 8.5, 14.5);
    const b = addUnit(state, 0, "villager", 8.5, 12.5);
    const [r1, r2] = send(state, build(a, "house", 10, 10), build(b, "house", 11, 10));
    expect(codeOf(r1)).toBe("ok");
    expect(codeOf(r2)).toBe("INVALID_PLACEMENT");
    expect(state.players[0].wood).toBe(150);
    expect(state.buildings.filter((x) => !x.complete)).toHaveLength(1);
    expect(b.job).toBeNull();
  });

  it("dos obras con recursos para una sola: la segunda se rechaza sin descuento", () => {
    const state = world();
    state.players[0].wood = 60;
    const a = addUnit(state, 0, "villager", 8.5, 14.5);
    const b = addUnit(state, 0, "villager", 8.5, 12.5);
    const [r1, r2] = send(state, build(a, "house", 10, 10), build(b, "house", 14, 10));
    expect(codeOf(r1)).toBe("ok");
    expect(codeOf(r2)).toBe("INSUFFICIENT_RESOURCES");
    expect(state.players[0].wood).toBe(10);
  });

  it("rechaza huellas con terreno, edificios, nodos vivos, unidades o fuera del mapa", () => {
    const state = world();
    addTerrain(state, 20, 20, 3, 3);
    addNode(state, "wood", 25, 25, 10);
    addNode(state, "wood", 28, 28, 0); // Agotado: no estorba.
    const v = addUnit(state, 0, "villager", 8.5, 14.5);
    addUnit(state, 1, "soldier", 30.5, 5.5);
    const code = (x: number, z: number) => codeOf(send(state, build(v, "house", x, z))[0]);
    expect(code(21, 21)).toBe("INVALID_PLACEMENT");
    expect(code(3, 15)).toBe("INVALID_PLACEMENT");
    expect(code(24, 24)).toBe("INVALID_PLACEMENT");
    expect(code(30, 5)).toBe("INVALID_PLACEMENT");
    expect(code(39, 10)).toBe("INVALID_PLACEMENT");
    expect(code(-1, 10)).toBe("INVALID_PLACEMENT");
    expect(code(28, 28)).toBe("ok");
    expect(state.players[0].wood).toBe(150);
  });

  it("rechaza edificios no construibles, tipos desconocidos y objetivos inválidos", () => {
    const state = world();
    const v = addUnit(state, 0, "villager", 8.5, 14.5);
    const results = send(
      state,
      { type: "Build", entityIds: [v.id], kind: "townCenter", target: { x: 10, z: 10 } },
      { type: "Build", entityIds: [v.id], kind: "toString" as never, target: { x: 10, z: 10 } },
      { type: "Build", entityIds: [v.id], kind: "house", target: { x: 10.5, z: 10 } },
      { type: "Build", entityIds: [v.id], kind: "house" },
    );
    expect(results.map(codeOf)).toEqual(["INVALID_TARGET", "INVALID_TARGET", "INVALID_TARGET", "INVALID_TARGET"]);
    expect(state.players[0].wood).toBe(200);
  });

  it("el constructor completa la obra: la vida crece hasta el máximo y sube la capacidad", () => {
    const state = world();
    const v = addUnit(state, 0, "villager", 8.5, 14.5);
    send(state, build(v, "house", 10, 10));
    const s = site(state)!;
    expect(state.players[0].popCapacity).toBe(10);
    runUntil(state, () => s.buildDone >= 150);
    expect(s.hp).toBe(30 + 135);
    runUntil(state, () => s.complete);
    expect(s.buildDone).toBe(BALANCE.buildings.house.buildTicks);
    expect(s.hp).toBe(BALANCE.buildings.house.hp);
    expect(v.job).toBeNull();
    expect(state.players[0].popCapacity).toBe(15);
  });

  it("el daño recibido durante la obra no se borra al completarla", () => {
    const state = world();
    const v = addUnit(state, 0, "villager", 8.5, 14.5);
    send(state, build(v, "house", 10, 10));
    const s = site(state)!;
    runUntil(state, () => s.buildDone >= 10);
    s.hp -= 20;
    runUntil(state, () => s.complete);
    expect(s.hp).toBe(BALANCE.buildings.house.hp - 20);
  });

  it("CancelBuild devuelve el 75 % redondeado hacia abajo y libera la huella", () => {
    const state = world();
    const v = addUnit(state, 0, "villager", 8.5, 14.5);
    send(state, build(v, "house", 10, 10));
    send(state, build(v, "barracks", 20, 10));
    expect(state.players[0].wood).toBe(0);
    const [house, barracks] = state.buildings.filter((b) => !b.complete);
    send(state, { type: "CancelBuild", entityIds: [house!.id] });
    expect(state.players[0].wood).toBe(37);
    send(state, { type: "CancelBuild", entityIds: [barracks!.id] });
    expect(state.players[0].wood).toBe(37 + 112);
    expect(state.buildings.filter((b) => !b.complete)).toHaveLength(0);
    stepSimulation(state);
    expect(currentGrid(state).isBlocked(10, 10)).toBe(false);
    expect(v.job).toBeNull();
  });

  it("CancelBuild no sirve sobre edificios completos", () => {
    const state = world();
    const [r] = send(state, { type: "CancelBuild", entityIds: [state.buildings[0]!.id] });
    expect(codeOf(r)).toBe("INCOMPATIBLE_ENTITY");
  });

  it("una obra queda pausada si su constructor muere y otro aldeano puede retomarla", () => {
    const state = world();
    const a = addUnit(state, 0, "villager", 8.5, 14.5);
    const b = addUnit(state, 0, "villager", 8.5, 12.5);
    send(state, build(a, "house", 10, 10));
    const s = site(state)!;
    runUntil(state, () => s.buildDone >= 20);

    const [busy] = send(state, { type: "ResumeBuild", entityIds: [b.id], target: { entityId: s.id } });
    expect(codeOf(busy)).toBe("SITE_BUSY");

    a.hp = 0;
    stepSimulation(state);
    const frozen = s.buildDone;
    run(state, 30);
    expect(s.buildDone).toBe(frozen);

    const [ok] = send(state, { type: "ResumeBuild", entityIds: [b.id], target: { entityId: s.id } });
    expect(codeOf(ok)).toBe("ok");
    runUntil(state, () => s.complete);
    expect(s.buildDone).toBe(BALANCE.buildings.house.buildTicks);
  });

  it("una obra queda pausada si su constructor recibe otra orden", () => {
    const state = world();
    const a = addUnit(state, 0, "villager", 8.5, 14.5);
    send(state, build(a, "house", 10, 10));
    const s = site(state)!;
    runUntil(state, () => s.buildDone >= 10);
    send(state, { type: "Move", entityIds: [a.id], target: { x: 20.5, z: 30.5 } });
    const frozen = s.buildDone;
    run(state, 30);
    expect(s.buildDone).toBe(frozen);
    expect(s.complete).toBe(false);
  });

  it("ResumeBuild exige obra propia, incompleta y alcanzable", () => {
    const state = world();
    const a = addUnit(state, 0, "villager", 8.5, 14.5);
    const enemy = addUnit(state, 1, "villager", 30.5, 14.5);
    send(state, build(a, "house", 10, 10));
    const s = site(state)!;
    a.job = null;
    const results = send(
      state,
      { type: "ResumeBuild", entityIds: [enemy.id], target: { entityId: s.id }, player: 1 },
      { type: "ResumeBuild", entityIds: [a.id], target: { entityId: state.buildings[0]!.id } },
      { type: "ResumeBuild", entityIds: [a.id], target: { entityId: s.id } },
    );
    expect(results.map(codeOf)).toEqual(["NOT_OWNER", "INVALID_TARGET", "ok"]);
  });

  describe("regla de caminos", () => {
    /** Muro vertical en x=18..19 con un corredor de 2 celdas (z=17..18) entre las bases. */
    function corridor(): GameState {
      const state = world();
      addTerrain(state, 18, 0, 2, 17);
      addTerrain(state, 18, 19, 2, 21);
      return state;
    }

    it("no permite cerrar el último corredor entre las bases", () => {
      const state = corridor();
      const v = addUnit(state, 0, "villager", 8.5, 20.5);
      const [r] = send(state, build(v, "house", 18, 17));
      expect(codeOf(r)).toBe("BLOCKS_PATH");
      expect(state.players[0].wood).toBe(200);
      expect(state.buildings.filter((b) => !b.complete)).toHaveLength(0);
      expect(previewPlacement(state, currentGrid(state), 0, "house", 18, 17)).toBe("BLOCKS_PATH");
      expect(previewPlacement(state, currentGrid(state), 0, "house", 8, 8)).toBeNull();
    });

    it("sí permite construir fuera del corredor", () => {
      const state = corridor();
      const v = addUnit(state, 0, "villager", 8.5, 20.5);
      expect(codeOf(send(state, build(v, "house", 8, 8))[0])).toBe("ok");
    });

    it("no permite encerrar una unidad que estaba en la región principal", () => {
      const state = world();
      addTerrain(state, 0, 2, 4, 1);
      addTerrain(state, 3, 0, 1, 1);
      addUnit(state, 1, "soldier", 1.5, 0.5);
      const v = addUnit(state, 0, "villager", 8.5, 20.5);
      expect(codeOf(send(state, build(v, "house", 4, 0))[0])).toBe("BLOCKS_PATH");
    });
  });
});

describe("T-06 producción y población (RF-07, RF-10)", () => {
  const train = (building: { id: number }, kind: "villager" | "soldier" | "archer"): Order => ({ type: "Train", entityIds: [building.id], kind });

  function tcWorld(): { state: GameState; tc: GameState["buildings"][number] } {
    const state = world();
    state.players[0].food = 1000;
    state.players[0].wood = 1000;
    return { state, tc: state.buildings[0]! };
  }

  it("la cola admite 5 elementos y rechaza el sexto sin cobrar", () => {
    const { state, tc } = tcWorld();
    const results = send(state, ...Array.from({ length: 6 }, () => train(tc, "villager")));
    expect(results.map(codeOf)).toEqual(["ok", "ok", "ok", "ok", "ok", "QUEUE_FULL"]);
    expect(tc.queue).toHaveLength(5);
    expect(state.players[0].food).toBe(1000 - 5 * 50);
  });

  it("rechaza por recursos insuficientes sin cambiar el estado", () => {
    const { state, tc } = tcWorld();
    state.players[0].food = 40;
    const [r] = send(state, train(tc, "villager"));
    expect(codeOf(r)).toBe("INSUFFICIENT_RESOURCES");
    expect(state.players[0].food).toBe(40);
    expect(tc.queue).toHaveLength(0);
  });

  it("rechaza por capacidad: vivos más reservas no superan la población máxima", () => {
    const { state, tc } = tcWorld();
    for (let i = 0; i < 9; i++) addUnit(state, 0, "villager", 8.5 + (i % 5) * 1.2, 22.5 + Math.floor(i / 5) * 1.2);
    expect(codeOf(send(state, train(tc, "villager"))[0])).toBe("ok");
    expect(populationOf(state, 0)).toBe(10);
    expect(codeOf(send(state, train(tc, "villager"))[0])).toBe("POPULATION_LIMIT");
    expect(reservedOf(state, 0)).toBe(1);
  });

  it("la unidad sale al terminar y la reserva se libera exactamente una vez", () => {
    const { state, tc } = tcWorld();
    send(state, train(tc, "villager"));
    expect(populationOf(state, 0)).toBe(1);
    expect(livingOf(state, 0)).toBe(0);
    runUntil(state, () => state.units.length === 1);
    expect(tc.queue).toHaveLength(0);
    expect(populationOf(state, 0)).toBe(1);
    expect(reservedOf(state, 0)).toBe(0);
    const u = state.units[0]!;
    expect(u).toMatchObject({ owner: 0, kind: "villager", task: "idle" });
    run(state, 300);
    expect(state.units).toHaveLength(1);
  });

  it("solo avanza el primer elemento y tarda el tiempo del balance", () => {
    const { state, tc } = tcWorld();
    send(state, train(tc, "villager"), train(tc, "villager"));
    const [first, second] = tc.queue;
    expect(second!.remaining).toBe(BALANCE.units.villager.trainTicks);
    const ticks = runUntil(state, () => state.units.length === 1);
    expect(ticks).toBeGreaterThanOrEqual(BALANCE.units.villager.trainTicks - 2);
    expect(ticks).toBeLessThanOrEqual(BALANCE.units.villager.trainTicks + 2);
    expect(tc.queue[0]!.id).toBe(second!.id);
    expect(first!.id).not.toBe(second!.id);
    expect(second!.remaining).toBeGreaterThan(BALANCE.units.villager.trainTicks - 5);
  });

  it("cancelar devuelve el coste completo, libera la plaza y conserva el orden", () => {
    const { state, tc } = tcWorld();
    send(state, train(tc, "villager"), train(tc, "villager"), train(tc, "villager"));
    const [a, b, c] = tc.queue.map((q) => q.id);
    send(state, { type: "CancelTraining", entityIds: [tc.id], target: { entityId: b! } });
    expect(state.players[0].food).toBe(1000 - 100);
    expect(tc.queue.map((q) => q.id)).toEqual([a, c]);
    expect(populationOf(state, 0)).toBe(2);
    const [again] = send(state, { type: "CancelTraining", entityIds: [tc.id], target: { entityId: b! } });
    expect(codeOf(again)).toBe("INVALID_TARGET");
    expect(state.players[0].food).toBe(900);
  });

  it("solo los edificios completos que entrenan ese tipo de unidad aceptan la orden", () => {
    const { state, tc } = tcWorld();
    const house = addBuilding(state, 0, "house", 10, 5);
    const barracks = addBuilding(state, 0, "barracks", 20, 5);
    const site = addBuilding(state, 0, "barracks", 25, 25, false);
    const results = send(state, train(house, "villager"), train(tc, "soldier"), train(barracks, "villager"), train(site, "soldier"), train(barracks, "archer"));
    expect(results.map(codeOf)).toEqual(["INCOMPATIBLE_ENTITY", "INCOMPATIBLE_ENTITY", "INCOMPATIBLE_ENTITY", "NOT_COMPLETE", "ok"]);
    expect(state.players[0].food).toBe(1000 - 40);
    expect(state.players[0].wood).toBe(1000 - 50);
  });

  it("sin salida libre la unidad queda lista y no adelanta a la siguiente; al liberarse sale", () => {
    const state = createEmptyState(1, 40);
    state.players[0].food = 1000;
    const tc = addBuilding(state, 0, "townCenter", 10, 10);
    addTerrain(state, 9, 9, 6, 6); // Sella el anillo completo.
    send(state, train(tc, "villager"), train(tc, "villager"));
    const second = tc.queue[1]!;
    run(state, BALANCE.units.villager.trainTicks + 50);
    expect(state.units).toHaveLength(0);
    expect(tc.queue[0]!.remaining).toBe(0);
    expect(second.remaining).toBe(BALANCE.units.villager.trainTicks);

    state.terrain = [];
    state.obstacleVersion += 1;
    run(state, 2);
    expect(state.units).toHaveLength(1);
    expect(tc.queue).toHaveLength(1);
    expect(tc.queue[0]!.id).toBe(second.id);
  });

  it("una casa destruida baja la capacidad y detiene la producción pagada hasta que haya sitio", () => {
    const { state, tc } = tcWorld();
    const house = addBuilding(state, 0, "house", 10, 5);
    refresh(state);
    expect(state.players[0].popCapacity).toBe(15);
    for (let i = 0; i < 12; i++) addUnit(state, 0, "villager", 8.5 + (i % 6) * 1.2, 22.5 + Math.floor(i / 6) * 1.2);
    send(state, train(tc, "villager"));
    run(state, 20);
    const before = tc.queue[0]!.remaining;

    house.hp = 0;
    run(state, 2);
    expect(state.buildings.includes(house)).toBe(false);
    expect(state.players[0].popCapacity).toBe(10);
    const stalled = tc.queue[0]!.remaining;
    run(state, 40);
    expect(tc.queue[0]!.remaining).toBe(stalled);
    expect(stalled).toBeLessThan(before);
    expect(state.players[0].food).toBe(1000 - 50); // Sin reembolso.

    for (const u of state.units.slice(0, 3)) u.hp = 0; // Vivos 9 + reserva 1 = 10.
    run(state, 5);
    expect(tc.queue[0]!.remaining).toBeLessThan(stalled);
  });

  it("un edificio destruido pierde su cola sin reembolso y libera las reservas", () => {
    const { state, tc } = tcWorld();
    send(state, train(tc, "villager"), train(tc, "villager"));
    expect(reservedOf(state, 0)).toBe(2);
    tc.hp = 0;
    stepSimulation(state);
    expect(state.buildings.includes(tc)).toBe(false);
    expect(reservedOf(state, 0)).toBe(0);
    expect(state.players[0].food).toBe(900);
  });

  function refresh(state: GameState): void {
    stepSimulation(state);
  }
});

describe("economía: invariantes y reproducibilidad (RNF-06)", () => {
  function scenario(): { state: GameState; log: string[] } {
    const state = createInitialState(7);
    const log: string[] = [];
    const villagers = state.units.filter((u) => u.owner === 0);
    const tc = state.buildings.find((b) => b.owner === 0 && b.kind === "townCenter")!;
    const food = state.resourceNodes.filter((n) => n.kind === "food")[0]!;
    const wood = state.resourceNodes.filter((n) => n.kind === "wood")[0]!;
    const orders: [number, Order[]][] = [
      [1, [gather(villagers[0]!, food.id), gather(villagers[1]!, wood.id), { type: "Train", entityIds: [tc.id], kind: "villager" }]],
      [5, [{ type: "Train", entityIds: [tc.id], kind: "villager" }, build(villagers[2]!, "house", 12, 34)]],
      [400, [{ type: "Train", entityIds: [tc.id], kind: "villager" }]],
    ];
    for (let t = 0; t < 900; t++) {
      const batch = orders.find(([tick]) => tick === t)?.[1] ?? [];
      const results = batch.length ? send(state, ...batch) : stepSimulation(state).results;
      for (const r of results) log.push(codeOf(r));
      for (const p of state.players) {
        expect(p.food).toBeGreaterThanOrEqual(0);
        expect(p.wood).toBeGreaterThanOrEqual(0);
        expect(populationOf(state, p.id)).toBeLessThanOrEqual(p.popCapacity);
      }
      for (const u of state.units) {
        expect(u.carry === null || (u.carry.amount >= 1 && u.carry.amount <= BALANCE.economy.carryCapacity)).toBe(true);
      }
    }
    return { state, log };
  }

  it("la misma secuencia produce el mismo estado y las mismas respuestas", () => {
    const a = scenario();
    const b = scenario();
    expect(hashState(a.state)).toBe(hashState(b.state));
    expect(a.log).toEqual(b.log);
    expect(a.log.every((c) => c === "ok")).toBe(true);
    expect(a.state.units.length).toBeGreaterThan(3);
  });
});
