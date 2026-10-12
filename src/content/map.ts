import { BALANCE, type ResourceKind } from "./balance";

// P2: 128 × 64 = 8192 celdas, el doble de la superficie de P1 (64 × 64) duplicando el eje que une las bases.
export const MAP_WIDTH = 128;
export const MAP_DEPTH = 64;

export interface TerrainRectSpec {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly h: number;
  readonly kind?: "water" | "bridge" | "forest";
}

export interface StartBuildingSpec {
  readonly owner: 0 | 1;
  readonly kind: "house" | "tower";
  readonly cell: CellPos;
}

export interface MapLayout {
  readonly width: number;
  readonly depth: number;
  readonly terrain: readonly TerrainRectSpec[];
  readonly startBuildings: readonly StartBuildingSpec[];
  readonly townCenters: readonly [CellPos, CellPos];
  readonly villagerSpawns: readonly [readonly Pos[], readonly Pos[]];
  readonly nodes: readonly NodeSpec[];
}

export interface CellPos {
  readonly x: number;
  readonly z: number;
}

export interface Pos {
  readonly x: number;
  readonly z: number;
}

export interface NodeSpec {
  readonly owner: 0 | 1;
  readonly kind: ResourceKind;
  readonly cell: CellPos;
}

const TC = BALANCE.buildings.townCenter.footprint;

// Mitad izquierda del mapa; la derecha se obtiene por simetría especular respecto a x = MAP_WIDTH / 2.
const HALF_TERRAIN: readonly TerrainRectSpec[] = [
  { x: 32, z: 10, w: 3, h: 12 },
  { x: 32, z: 42, w: 3, h: 12 },
  { x: 38, z: 0, w: 10, h: 6, kind: "water" },
  { x: 38, z: 58, w: 10, h: 6, kind: "water" },
];

// P6: río de borde a borde (x 61..66) con un único puente de 6 celdas (z 29..34) alineado con la salida de las bases.
const RIVER: readonly TerrainRectSpec[] = [
  { x: 61, z: 0, w: 6, h: 29, kind: "water" },
  { x: 61, z: 29, w: 6, h: 6, kind: "bridge" },
  { x: 61, z: 35, w: 6, h: 29, kind: "water" },
];

// P7: bosques (obstáculo con arbolado denso) lejos de la aldea, los nodos y el pasillo del puente; mitad izquierda.
const HALF_FOREST: readonly TerrainRectSpec[] = [
  { x: 2, z: 0, w: 14, h: 9, kind: "forest" },
  { x: 20, z: 0, w: 12, h: 4, kind: "forest" },
  { x: 2, z: 55, w: 14, h: 9, kind: "forest" },
  { x: 20, z: 60, w: 12, h: 4, kind: "forest" },
  { x: 24, z: 13, w: 6, h: 5, kind: "forest" },
  { x: 24, z: 46, w: 6, h: 5, kind: "forest" },
  { x: 50, z: 9, w: 7, h: 6, kind: "forest" },
  { x: 50, z: 49, w: 7, h: 6, kind: "forest" },
];

const mirrorRect = (t: TerrainRectSpec): TerrainRectSpec => ({ ...t, x: MAP_WIDTH - t.x - t.w });

const LEFT_TERRAIN: readonly TerrainRectSpec[] = [...HALF_TERRAIN, ...HALF_FOREST];
const TERRAIN: readonly TerrainRectSpec[] = [...LEFT_TERRAIN, ...LEFT_TERRAIN.map(mirrorRect), ...RIVER];

// P6/P7: aldea inicial del jugador 0 (12 casas en cuatro hileras y 2 torres de 2 × 2); el jugador 1 es el espejo.
const START_BUILDINGS_HALF: readonly { kind: "house" | "tower"; cell: CellPos }[] = [
  ...[4, 7, 10].flatMap((x) => [25, 37].map((z) => ({ kind: "house" as const, cell: { x, z } }))),
  ...[4, 7, 10].flatMap((x) => [22, 40].map((z) => ({ kind: "house" as const, cell: { x, z } }))),
  { kind: "tower", cell: { x: 19, z: 27 } },
  { kind: "tower", cell: { x: 19, z: 35 } },
];

// Bosque propio del jugador 0: la hilera de P1 más una segunda capa irregular hacia el centro.
const WOOD_CELLS: readonly CellPos[] = [
  ...Array.from({ length: 8 }, (_, i) => ({ x: 15, z: 35 + i })),
  ...Array.from({ length: 6 }, (_, i) => ({ x: 16, z: 36 + i })),
  { x: 17, z: 38 },
  { x: 17, z: 39 },
];

// P3: yacimiento de piedra propio, un bloque de 2 × 2 celdas al sur del bosque; deja libres los accesos al centro y a las bases.
const STONE_CELLS: readonly CellPos[] = [
  { x: 15, z: 46 },
  { x: 16, z: 46 },
  { x: 15, z: 47 },
  { x: 16, z: 47 },
];

function build(): MapLayout {
  const tc0: CellPos = { x: 8, z: 30 };
  const tc1: CellPos = { x: MAP_WIDTH - tc0.x - TC, z: tc0.z };

  const spawns0: Pos[] = [
    { x: 13.5, z: 31 },
    { x: 13.5, z: 32 },
    { x: 13.5, z: 33 },
  ];
  const spawns1: Pos[] = spawns0.map((p) => ({ x: MAP_WIDTH - p.x, z: p.z }));

  const nodes: NodeSpec[] = [];
  for (let i = 0; i < BALANCE.nodesPerKindPerPlayer; i++) {
    nodes.push({ owner: 0, kind: "food", cell: { x: 15, z: 22 + i } });
    nodes.push({ owner: 1, kind: "food", cell: { x: MAP_WIDTH - 1 - 15, z: 22 + i } });
  }
  for (const cell of WOOD_CELLS) {
    nodes.push({ owner: 0, kind: "wood", cell });
    nodes.push({ owner: 1, kind: "wood", cell: { x: MAP_WIDTH - 1 - cell.x, z: cell.z } });
  }
  for (const cell of STONE_CELLS) {
    nodes.push({ owner: 0, kind: "stone", cell });
    nodes.push({ owner: 1, kind: "stone", cell: { x: MAP_WIDTH - 1 - cell.x, z: cell.z } });
  }

  const startBuildings: StartBuildingSpec[] = [];
  for (const b of START_BUILDINGS_HALF) {
    const size = BALANCE.buildings[b.kind].footprint;
    startBuildings.push({ owner: 0, kind: b.kind, cell: b.cell });
    startBuildings.push({ owner: 1, kind: b.kind, cell: { x: MAP_WIDTH - b.cell.x - size, z: b.cell.z } });
  }

  return { width: MAP_WIDTH, depth: MAP_DEPTH, terrain: TERRAIN, startBuildings, townCenters: [tc0, tc1], villagerSpawns: [spawns0, spawns1], nodes };
}

export const MAP_LAYOUT: MapLayout = build();

// La alcanzabilidad (§4.1) requiere navegación y se valida en core/map-check.
export function validateMapLayout(layout: MapLayout): void {
  const occupied = new Set<string>();
  const claim = (x: number, z: number, w: number, what: string): void => {
    if (x < 0 || z < 0 || x + w > layout.width || z + w > layout.depth) {
      throw new Error(`Mapa inválido: ${what} fuera de límites`);
    }
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < w; j++) {
        const key = `${x + i},${z + j}`;
        if (occupied.has(key)) throw new Error(`Mapa inválido: solape en ${key} (${what})`);
        occupied.add(key);
      }
    }
  };
  for (const tc of layout.townCenters) claim(tc.x, tc.z, TC, "centro principal");
  for (const n of layout.nodes) claim(n.cell.x, n.cell.z, 1, `nodo ${n.kind}`);
  for (const b of layout.startBuildings) claim(b.cell.x, b.cell.z, BALANCE.buildings[b.kind].footprint, `edificio inicial ${b.kind}`);
  for (const b of layout.startBuildings.filter((s) => s.owner === 0)) {
    const size = BALANCE.buildings[b.kind].footprint;
    const mirror = layout.startBuildings.find((m) => m.owner === 1 && m.kind === b.kind && m.cell.x === layout.width - b.cell.x - size && m.cell.z === b.cell.z);
    if (!mirror) throw new Error(`Mapa inválido: edificio inicial ${b.kind} sin simétrico`);
  }
  for (const t of layout.terrain) {
    for (let i = 0; i < t.w; i++) for (let j = 0; j < t.h; j++) claim(t.x + i, t.z + j, 1, "terreno");
    const mirrored = layout.terrain.some((m) => m.x === layout.width - t.x - t.w && m.z === t.z && m.w === t.w && m.h === t.h && m.kind === t.kind);
    if (!mirrored) throw new Error("Mapa inválido: terreno no simétrico");
  }

  const [tc0, tc1] = layout.townCenters;
  if (tc0.z !== tc1.z || tc0.x + TC + tc1.x !== layout.width) {
    throw new Error("Mapa inválido: centros no simétricos");
  }
  const expected: Record<ResourceKind, number> = { food: BALANCE.nodesPerKindPerPlayer, wood: BALANCE.woodNodesPerPlayer, stone: BALANCE.stoneNodesPerPlayer };
  for (const kind of ["food", "wood", "stone"] as const) {
    for (const owner of [0, 1] as const) {
      const count = layout.nodes.filter((n) => n.owner === owner && n.kind === kind).length;
      if (count !== expected[kind]) {
        throw new Error(`Mapa inválido: ${count} nodos ${kind} para jugador ${owner}`);
      }
    }
  }
  for (const n of layout.nodes.filter((n) => n.owner === 0)) {
    const mirror = layout.nodes.find(
      (m) => m.owner === 1 && m.kind === n.kind && m.cell.x === layout.width - 1 - n.cell.x && m.cell.z === n.cell.z,
    );
    if (!mirror) throw new Error(`Mapa inválido: nodo ${n.kind} sin simétrico`);
  }
}
