import { MAP_WIDTH } from "../content/map";
import { BALANCE } from "../content/balance";
import { addBuilding, addTerrain, addUnit, createEmptyState, createInitialState } from "./state";
import type { Command, EntityId, GameState, PlayerId } from "./types";

export type FixtureName = "corridor20" | "crossing" | "crowd100" | "skirmish" | "objetivo" | "defensa";

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
  const state = createInitialState(1);
  const commands: Command[] = [];
  const nodesOf = (kind: "food" | "wood", owner: PlayerId) =>
    state.resourceNodes.filter((n) => n.kind === kind && (owner === 0 ? n.cell.x < MAP_WIDTH / 2 : n.cell.x >= MAP_WIDTH / 2));
  const house = BALANCE.buildings.house.footprint;
  const barracks = BALANCE.buildings.barracks.footprint;

  for (const owner of [0, 1] as const) {
    const mx = (x: number): number => (owner === 0 ? x : MAP_WIDTH - x);
    const cellX = (x: number, w: number): number => (owner === 0 ? x : MAP_WIDTH - x - w);
    for (let i = 0; i < 8; i++) addBuilding(state, owner, "house", cellX(4, house), 4 + 3 * i);
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
      const z = owner === 0 ? 2 + Math.floor(i / 5) * 0.8 : 59 + Math.floor(i / 5) * 0.8;
      marchers.push(addUnit(state, owner, "soldier", mx(14 + (i % 5) * 0.8), z).id);
    }
    commands.push(move(marchers, mx(50), owner === 0 ? 3 : 60, owner));
  }
  // Centros casi indestructibles: la escena de carga no debe terminar a mitad de la medición.
  for (const b of state.buildings) if (b.kind === "townCenter") b.hp = 1_000_000;
  return { state, commands, groups: [] };
}

/** Escenarios de P0-B (§6): corredor de 3 celdas, cruce de grupos y carga de 100 unidades. */
export function createFixture(name: FixtureName): Fixture {
  seq = 0;
  if (name === "objetivo") return createTargetScene();
  if (name === "defensa") {
    // Banco de pruebas manual de P3 (sin IA) junto a la cámara inicial: torre que dispara, unidades tras un cuartel y un edificio que cae.
    const state = createInitialState(1);
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
