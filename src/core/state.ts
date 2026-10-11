import { BALANCE, type BuildingKind, type ResourceKind, type UnitKind } from "../content/balance";
import { MAP_DEPTH, MAP_LAYOUT, MAP_WIDTH } from "../content/map";
import { STATE_SCHEMA_VERSION } from "../content/versions";
import type { Building, GameState, PlayerId, PlayerState, ResourceNode, Unit } from "./types";

export function makeUnit(id: number, owner: PlayerId, kind: UnitKind, x: number, z: number): Unit {
  return {
    id,
    owner,
    kind,
    pos: { x, z },
    hp: BALANCE.units[kind].hp,
    task: "idle",
    dest: null,
    path: [],
    needsPath: false,
    stuckTicks: 0,
    repaths: 0,
    blockedReason: null,
    carry: null,
    job: null,
    cooldown: 0,
    idleReason: null,
  };
}

/** Estado vacío (sin entidades ni terreno) para fixtures y pruebas. */
export function createEmptyState(seed: number, mapWidth: number = MAP_WIDTH, mapDepth: number = mapWidth === MAP_WIDTH ? MAP_DEPTH : mapWidth): GameState {
  const players = ([0, 1] as const).map(
    (id): PlayerState => ({
      id,
      food: BALANCE.start.food,
      wood: BALANCE.start.wood,
      popCapacity: BALANCE.start.popCapacity,
    }),
  ) as [PlayerState, PlayerState];

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    seed,
    tick: 0,
    matchStatus: "playing",
    outcome: null,
    mapWidth,
    mapDepth,
    terrain: [],
    obstacleVersion: 0,
    pathQueue: [],
    players,
    units: [],
    buildings: [],
    resourceNodes: [],
    nextEntityId: 1,
    lastCommandSeq: 0,
  };
}

export function createInitialState(seed: number): GameState {
  const state = createEmptyState(seed, MAP_LAYOUT.width, MAP_LAYOUT.depth);
  state.terrain = MAP_LAYOUT.terrain.map((t) => ({ ...t }));

  for (const owner of [0, 1] as const satisfies readonly PlayerId[]) {
    const tc = MAP_LAYOUT.townCenters[owner];
    addBuilding(state, owner, "townCenter", tc.x, tc.z);
    for (const spawn of MAP_LAYOUT.villagerSpawns[owner].slice(0, BALANCE.start.villagers)) {
      state.units.push(makeUnit(state.nextEntityId++, owner, "villager", spawn.x, spawn.z));
    }
  }

  for (const node of MAP_LAYOUT.nodes) {
    addNode(state, node.kind, node.cell.x, node.cell.z, BALANCE.nodeAmount);
  }

  return state;
}

/** Crea un edificio; con `complete: false` crea una obra con la vida inicial del §4.3. */
export function addBuilding(state: GameState, owner: PlayerId, kind: BuildingKind, x: number, z: number, complete = true): Building {
  const def = BALANCE.buildings[kind];
  const building: Building = {
    id: state.nextEntityId++,
    owner,
    kind,
    cell: { x, z },
    hp: complete ? def.hp : initialSiteHp(kind),
    complete,
    buildDone: complete ? def.buildTicks : 0,
    queue: [],
  };
  state.buildings.push(building);
  state.obstacleVersion += 1;
  return building;
}

/** Vida inicial de una obra; el resto se suma proporcionalmente al trabajo. */
export function initialSiteHp(kind: BuildingKind): number {
  const max = BALANCE.buildings[kind].hp;
  return max - Math.floor(max * (1 - BALANCE.economy.siteInitialHpRatio));
}

export function addNode(state: GameState, kind: ResourceKind, x: number, z: number, remaining: number): ResourceNode {
  const node: ResourceNode = { id: state.nextEntityId++, kind, cell: { x, z }, remaining };
  state.resourceNodes.push(node);
  state.obstacleVersion += 1;
  return node;
}

export function addUnit(state: GameState, owner: PlayerId, kind: UnitKind, x: number, z: number): Unit {
  const unit = makeUnit(state.nextEntityId++, owner, kind, x, z);
  state.units.push(unit);
  return unit;
}

export function addTerrain(state: GameState, x: number, z: number, w: number, h: number): void {
  state.terrain.push({ x, z, w, h });
  state.obstacleVersion += 1;
}

/** Unidades vivas del bando. */
export function livingOf(state: GameState, owner: PlayerId): number {
  return state.units.filter((u) => u.owner === owner).length;
}

/** Plazas reservadas por elementos en cola de producción. */
export function reservedOf(state: GameState, owner: PlayerId): number {
  let n = 0;
  for (const b of state.buildings) if (b.owner === owner) n += b.queue.length;
  return n;
}

/** Población ocupada: vivos + reservas (§4.2). */
export function populationOf(state: GameState, owner: PlayerId): number {
  return livingOf(state, owner) + reservedOf(state, owner);
}

/** Capacidad derivada: inicial + vivienda de edificios completos, con tope global. */
export function capacityOf(state: GameState, owner: PlayerId): number {
  let cap = BALANCE.start.popCapacity;
  for (const b of state.buildings) {
    if (b.owner === owner && b.complete) cap += BALANCE.buildings[b.kind].housing;
  }
  return Math.min(cap, BALANCE.maxPopulation);
}
