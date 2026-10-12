import { MAP_WIDTH } from "../content/map";
import { BALANCE } from "../content/balance";
import { addBuilding, addTerrain, addUnit, createEmptyState, createInitialState } from "./state";
import type { Command, EntityId, GameState, PlayerId } from "./types";

export type FixtureName = "corridor20" | "crossing" | "crowd100" | "skirmish" | "objetivo" | "defensa" | "sonidos" | "realismo" | "rio" | "retratos";

export interface Fixture {
  state: GameState;
  commands: Command[];
  /** Entidades que deben llegar a destino (por grupo de órdenes). */
  groups: EntityId[][];
}

function block(state: GameState, cols: number, count: number, x0: number, z0: number, spacing = 0.8): EntityId[] {
  const ids: EntityId[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    ids.push(addUnit(state, 0, "soldier", x0 + col * spacing, z0 + row * spacing).id);
  }
  return ids;
}

let seq = 0;
function move(ids: EntityId[], x: number, z: number, player: PlayerId = 0): Command {
  seq += 1;
  return { id: `fx-${seq}`, seq, tick: 0, player, type: "Move", entityIds: ids, target: { x, z } };
}

function gather(id: EntityId, nodeId: EntityId, player: PlayerId): Command {
  seq += 1;
  return { id: `fx-${seq}`, seq, tick: 0, player, type: "Gather", entityIds: [id], target: { entityId: nodeId } };
}

/** Escena objetivo de RNF-01/02: 100 unidades, 20 edificios, 40 militares combatiendo, 20 aldeanos recolectando y 40 en marcha. */
function createTargetScene(): Fixture {
  const state = createInitialState(1, false);
  const commands: Command[] = [];
  const nodesOf = (kind: "food" | "wood", owner: PlayerId) =>
    state.resourceNodes.filter((n) => n.kind === kind && (owner === 0 ? n.cell.x < MAP_WIDTH / 2 : n.cell.x >= MAP_WIDTH / 2));
  const house = BALANCE.buildings.house.footprint;
  const barracks = BALANCE.buildings.barracks.footprint;

  for (const owner of [0, 1] as const) {
    const mx = (x: number): number => (owner === 0 ? x : MAP_WIDTH - x);
    const cellX = (x: number, w: number): number => (owner === 0 ? x : MAP_WIDTH - x - w);
    for (let i = 0; i < 8; i++) addBuilding(state, owner, "house", cellX(4, house), 10 + 3 * i);
    addBuilding(state, owner, "barracks", cellX(20, barracks), 44);

    const villagers = state.units.filter((u) => u.owner === owner).map((u) => u.id);
    for (let i = 0; i < 7; i++) villagers.push(addUnit(state, owner, "villager", mx(13.5), 34.5 + i).id);
    const food = nodesOf("food", owner);
    const wood = nodesOf("wood", owner);
    villagers.forEach((id, i) => commands.push(gather(id, (i % 2 === 0 ? food : wood)[Math.floor(i / 2) % 8]!.id, owner)));

    const fighters: EntityId[] = [];
    for (let i = 0; i < 20; i++) {
      const kind = i < 12 ? "soldier" : "archer";
      fighters.push(addUnit(state, owner, kind, mx(22 + (i % 5) * 0.8), 28.5 + Math.floor(i / 5) * 0.8).id);
    }
    commands.push(move(fighters, MAP_WIDTH / 2, 31.5, owner));

    const marchers: EntityId[] = [];
    for (let i = 0; i < 20; i++) {
      const z = owner === 0 ? 12 + Math.floor(i / 5) * 0.8 : 51 + Math.floor(i / 5) * 0.8;
      marchers.push(addUnit(state, owner, "soldier", mx(14 + (i % 5) * 0.8), z).id);
    }
    commands.push(move(marchers, mx(50), owner === 0 ? 20 : 44, owner));
  }
  // Centros casi indestructibles: la escena de carga no debe terminar a mitad de la medición.
  for (const b of state.buildings) if (b.kind === "townCenter") b.hp = 1_000_000;
  return { state, commands, groups: [] };
}

export type FinalOption = "victoria" | "derrota";

function command(partial: Omit<Command, "id" | "seq" | "tick">): Command {
  seq += 1;
  return { id: `fx-${seq}`, seq, tick: 0, ...partial };
}

/**
 * Banco de pruebas de P4 para oír todos los efectos sin esperar a una partida (SDD de la etapa 4, §4.10).
 * Con `final` la escena se reduce a un centro urbano con vida mínima junto a un atacante.
 */
function createSoundScene(final?: FinalOption): Fixture {
  const state = createInitialState(1, false);
  const commands: Command[] = [];
  const tc = (owner: PlayerId) => state.buildings.find((b) => b.owner === owner && b.kind === "townCenter")!;

  if (final) {
    const doomed = tc(final === "victoria" ? 1 : 0);
    doomed.hp = 5;
    const attacker = final === "victoria" ? addUnit(state, 0, "soldier", doomed.cell.x - 1.5, doomed.cell.z + 2) : addUnit(state, 1, "soldier", doomed.cell.x + 5.5, doomed.cell.z + 2);
    commands.push(command({ player: attacker.owner, type: "Attack", entityIds: [attacker.id], target: { entityId: doomed.id } }));
    return { state, commands, groups: [] };
  }

  for (const p of state.players) {
    p.food = 2000;
    p.wood = 2000;
    p.popCapacity = BALANCE.maxPopulation;
  }
  // Los «sacos» aguantan sin morir para que los efectos continúen mientras se escucha.
  const dummy = (owner: PlayerId, kind: "soldier" | "villager" | "archer", x: number, z: number, hp = 5000) => {
    const u = addUnit(state, owner, kind, x, z);
    u.hp = hp;
    return u;
  };
  const attack = (attacker: { id: EntityId; owner: PlayerId }, targetId: EntityId): void => {
    commands.push(command({ player: attacker.owner, type: "Attack", entityIds: [attacker.id], target: { entityId: targetId } }));
  };

  // Combate cuerpo a cuerpo y a distancia entre bandos.
  dummy(0, "soldier", 22, 20, 400);
  dummy(1, "soldier", 22.8, 20, 400);
  dummy(0, "archer", 26, 20, 400);
  dummy(1, "archer", 30.4, 20, 400);

  // Torres de cada bando con un aldeano rival a su alcance.
  addBuilding(state, 0, "tower", 22, 27);
  addBuilding(state, 1, "tower", 27, 27);
  dummy(1, "villager", 23, 32.5);
  dummy(0, "villager", 28, 32.5);

  // Centro urbano rival armado con un soldado propio a su alcance; el propio con un rival junto a él.
  addBuilding(state, 1, "townCenter", 44, 22);
  dummy(0, "soldier", 45.5, 28.5);
  dummy(1, "soldier", 13.5, 28.5);

  // Fuego: casa propia al 40 % y casa rival más dañada.
  addBuilding(state, 0, "house", 36, 27).hp = 120;
  addBuilding(state, 1, "house", 40, 27).hp = 100;

  // Campana y derrumbes pequeños: un soldado rival ataca una casa propia y uno propio, una rival.
  const ownHouse = addBuilding(state, 0, "house", 38, 35);
  ownHouse.hp = 60;
  attack(dummy(1, "soldier", 41.5, 36.5), ownHouse.id);
  const rivalHouse = addBuilding(state, 1, "house", 44, 35);
  rivalHouse.hp = 60;
  attack(dummy(0, "soldier", 47.5, 36.5), rivalHouse.id);

  // Derrumbe grande: cuartel propio con poca vida atacado por un rival.
  const ownBarracks = addBuilding(state, 0, "barracks", 28, 43);
  ownBarracks.hp = 80;
  attack(dummy(1, "soldier", 31.8, 44.5), ownBarracks.id);

  // Producción: el cuartel y el centro urbano propios suenan; los del rival callan.
  const trainer = addBuilding(state, 0, "barracks", 20, 42);
  const rivalTrainer = addBuilding(state, 1, "barracks", 36, 44);
  commands.push(command({ player: 0, type: "Train", entityIds: [trainer.id], kind: "soldier" }));
  commands.push(command({ player: 1, type: "Train", entityIds: [rivalTrainer.id], kind: "soldier" }));
  commands.push(command({ player: 0, type: "Train", entityIds: [tc(0).id], kind: "villager" }));
  commands.push(command({ player: 1, type: "Train", entityIds: [tc(1).id], kind: "villager" }));

  // Trabajos: construcción, tala, minería y recolección de alimento de cada bando.
  const nodeAt = (kind: "wood" | "stone" | "food", x: number, z: number) => state.resourceNodes.find((n) => n.kind === kind && n.cell.x === x && n.cell.z === z)!;
  for (const owner of [0, 1] as const) {
    const side = owner === 0 ? 0 : 1;
    const builder = dummy(owner, "villager", 31 + side * 4, 34.5);
    commands.push(command({ player: owner, type: "Build", entityIds: [builder.id], kind: "house", target: { x: 30 + side * 4, z: 36 } }));
    const wood = dummy(owner, "villager", 18.5, 37 + side);
    commands.push(command({ player: owner, type: "Gather", entityIds: [wood.id], target: { entityId: nodeAt("wood", 16, 37 + side).id } }));
    const stone = dummy(owner, "villager", 18.5, 46 + side);
    commands.push(command({ player: owner, type: "Gather", entityIds: [stone.id], target: { entityId: nodeAt("stone", 16, 46 + side).id } }));
    const food = dummy(owner, "villager", 18.5, 22 + side);
    commands.push(command({ player: owner, type: "Gather", entityIds: [food.id], target: { entityId: nodeAt("food", 15, 22 + side).id } }));
  }

  // Un aldeano de cada bando se defiende de un soldado.
  const farmer0 = dummy(0, "villager", 24, 38, 400);
  const farmer1 = dummy(1, "villager", 24, 39.5, 400);
  attack(dummy(1, "soldier", 24.8, 38), farmer0.id);
  attack(dummy(0, "soldier", 24.8, 39.5), farmer1.id);

  // Gritos de muerte: un militar y un aldeano de cada bando con una vida mínima junto a un enemigo.
  dummy(0, "soldier", 41, 44, 400);
  dummy(1, "villager", 41.8, 44, 6);
  dummy(1, "soldier", 41, 45.6, 12);
  dummy(1, "soldier", 45, 44, 400);
  dummy(0, "villager", 45.8, 44, 6);
  dummy(0, "archer", 45, 45.6, 12);
  return { state, commands, groups: [] };
}

/**
 * Banco de pruebas de P5 para juzgar a ojo el realismo gráfico: edificios con distinta cantidad de fuego,
 * derrumbes (casa, cuartel y torre) y un grupo de unidades junto a la cámara inicial; el agua queda al borde inferior.
 */
function createRealismScene(): Fixture {
  const state = createInitialState(1, false);
  const commands: Command[] = [];
  const burning = (kind: "house" | "barracks" | "tower", x: number, z: number, ratio: number): void => {
    const b = addBuilding(state, 0, kind, x, z);
    b.hp = Math.max(1, Math.round(BALANCE.buildings[kind].hp * ratio));
  };
  burning("house", 20, 24, 0.85);
  burning("house", 24, 24, 0.6);
  burning("house", 28, 24, 0.4);
  burning("house", 32, 24, 0.2);
  burning("barracks", 20, 30, 0.45);
  burning("tower", 30, 31, 0.3);

  const doomedHouse = addBuilding(state, 0, "house", 24, 38);
  doomedHouse.hp = 40;
  const doomedBarracks = addBuilding(state, 0, "barracks", 30, 38);
  doomedBarracks.hp = 60;
  const doomedTower = addBuilding(state, 0, "tower", 38, 38);
  doomedTower.hp = 50;
  const strike = (target: { id: EntityId }, x: number, z: number): void => {
    const u = addUnit(state, 1, "soldier", x, z);
    u.hp = 5000;
    commands.push(command({ player: 1, type: "Attack", entityIds: [u.id], target: { entityId: target.id } }));
  };
  strike(doomedHouse, 24.5, 41.5);
  strike(doomedBarracks, 30.5, 42.5);
  strike(doomedTower, 38.5, 41.5);

  for (let i = 0; i < 4; i++) addUnit(state, 0, i % 2 === 0 ? "soldier" : "archer", 16 + i * 0.9, 34);
  for (let i = 0; i < 3; i++) addUnit(state, 0, "villager", 16 + i * 0.9, 36);
  return { state, commands, groups: [] };
}

/**
 * Banco de pruebas de P6 para el río y el puente: dos grupos de 20 unidades se cruzan por el puente y tres aldeanos
 * intentan construir sobre el puente (rechazado), junto a él en el agua (rechazado) y en la orilla pegada a la rampa (aceptado).
 */
function createRiverScene(): Fixture {
  const state = createInitialState(1, false);
  const west = block(state, 5, 20, 50, 29.2);
  const east: EntityId[] = [];
  for (let i = 0; i < 20; i++) east.push(addUnit(state, 0, "soldier", 78 - (i % 5) * 0.8, 29.2 + Math.floor(i / 5) * 0.8).id);
  const commands = [move(west, 76, 32), move(east, 52, 32)];
  const builders: [number, number][] = [
    [62, 31],
    [62, 26],
    [59, 31],
  ];
  builders.forEach(([x, z], i) => {
    const villager = addUnit(state, 0, "villager", 56, 37 + i);
    commands.push(command({ player: 0, type: "Build", entityIds: [villager.id], kind: "house", target: { x, z } }));
  });
  return { state, commands, groups: [west, east] };
}

/**
 * Banco de pruebas de P7 para el retrato: unidades y edificios de ambos bandos (algunos dañados y una obra) junto a la
 * cámara inicial y un grupo rival al este, separado más de 20 celdas para que nadie combata; todo fuera de los bosques.
 */
function createPortraitScene(): Fixture {
  const state = createInitialState(1, false);
  const kinds = ["villager", "soldier", "archer"] as const;
  const hurt = [1, 0.6, 0.35] as const;
  for (const owner of [0, 1] as const) {
    const x0 = owner === 0 ? 18 : 46;
    kinds.forEach((kind, i) => {
      const u = addUnit(state, owner, kind, x0 + i * 1.6, 30);
      u.hp = Math.max(1, Math.round(BALANCE.units[kind].hp * hurt[owner === 0 ? i : 2 - i]!));
    });
    addBuilding(state, owner, "house", x0, 34).hp = Math.round(BALANCE.buildings.house.hp * (owner === 0 ? 1 : 0.55));
    addBuilding(state, owner, "barracks", x0 + 5, 34).hp = Math.round(BALANCE.buildings.barracks.hp * (owner === 0 ? 0.8 : 1));
    addBuilding(state, owner, "tower", x0 + 11, 34);
  }
  const site = addBuilding(state, 0, "house", 22, 24, false);
  site.buildDone = Math.floor(BALANCE.buildings.house.buildTicks * 0.45);
  site.hp = Math.round(BALANCE.buildings.house.hp * 0.5);
  return { state, commands: [], groups: [] };
}

/** Escenarios de P0-B (§6): corredor de 3 celdas, cruce de grupos y carga de 100 unidades. */
export function createFixture(name: FixtureName, options: { final?: FinalOption } = {}): Fixture {
  seq = 0;
  if (name === "objetivo") return createTargetScene();
  if (name === "retratos") return createPortraitScene();
  if (name === "rio") return createRiverScene();
  if (name === "realismo") return createRealismScene();
  if (name === "sonidos") return createSoundScene(options.final);
  if (name === "defensa") {
    // Banco de pruebas manual de P3 (sin IA) junto a la cámara inicial: torre que dispara, unidades tras un cuartel y un edificio que cae.
    const state = createInitialState(1, false);
    addBuilding(state, 0, "tower", 24, 24);
    addBuilding(state, 0, "barracks", 22, 34);
    const front = addUnit(state, 0, "soldier", 23.5, 32.4);
    const back = addUnit(state, 0, "archer", 23.5, 37.6);
    const house = addBuilding(state, 1, "house", 32, 34);
    house.hp = 60;
    const raiders = [addUnit(state, 0, "soldier", 30.5, 36.5), addUnit(state, 0, "soldier", 30.5, 37.4)];
    addUnit(state, 1, "soldier", 31.5, 26.5);
    const commands = [move([front.id], 23.5, 32.4), move([back.id], 23.5, 37.6)];
    seq += 1;
    commands.push({ id: `fx-${seq}`, seq, tick: 0, player: 0, type: "Attack", entityIds: raiders.map((u) => u.id), target: { entityId: house.id } });
    return { state, commands, groups: [] };
  }
  if (name === "skirmish") {
    // Partida normal con dos pelotones frente a frente en el paso central, sin IA: banco de pruebas manual del combate.
    const state = createInitialState(1);
    for (let i = 0; i < 4; i++) addUnit(state, 0, "soldier", 56 + (i % 2) * 0.8, 29.5 + Math.floor(i / 2) * 0.8);
    for (let i = 0; i < 2; i++) addUnit(state, 0, "archer", 54.5, 30 + i * 0.8);
    for (let i = 0; i < 3; i++) addUnit(state, 1, "soldier", 72 + (i % 2) * 0.8, 29.5 + Math.floor(i / 2) * 0.8);
    for (let i = 0; i < 2; i++) addUnit(state, 1, "archer", 73.5, 30 + i * 0.8);
    return { state, commands: [], groups: [] };
  }
  const state = createEmptyState(1);

  if (name === "corridor20") {
    addTerrain(state, 20, 0, 24, 25);
    addTerrain(state, 20, 28, 24, 36);
    const ids = block(state, 4, 20, 6, 23.6);
    return { state, commands: [move(ids, 54, 26.5)], groups: [ids] };
  }

  if (name === "crossing") {
    const a = block(state, 5, 10, 8, 28);
    const b: EntityId[] = [];
    for (let i = 0; i < 10; i++) {
      b.push(addUnit(state, 0, "soldier", 55 - (i % 5) * 0.8, 28 + Math.floor(i / 5) * 0.8).id);
    }
    return { state, commands: [move(a, 55, 29), move(b, 8, 29)], groups: [a, b] };
  }

  addTerrain(state, 30, 8, 4, 18);
  addTerrain(state, 30, 38, 4, 18);
  const ids = block(state, 10, 100, 4, 22);
  return { state, commands: [move(ids, 56, 31.5)], groups: [ids] };
}
