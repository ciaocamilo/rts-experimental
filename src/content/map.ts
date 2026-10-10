import { BALANCE, type ResourceKind } from "./balance";

export const MAP_SIZE = 64;

export interface TerrainRectSpec {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly h: number;
}

export interface MapLayout {
  readonly size: number;
  readonly terrain: readonly TerrainRectSpec[];
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

// Dos bloques centrales (x 30..33) dejan un paso central de 12 celdas y corredores de 8 en los bordes.
const TERRAIN: readonly TerrainRectSpec[] = [
  { x: 30, z: 8, w: 4, h: 18 },
  { x: 30, z: 38, w: 4, h: 18 },
];

// Simetría especular respecto al eje vertical del mapa: una celda 1×1 en x pasa a MAP_SIZE-1-x.
function build(): MapLayout {
  const tc0: CellPos = { x: 8, z: 30 };
  const tc1: CellPos = { x: MAP_SIZE - tc0.x - TC, z: tc0.z };

  const spawns0: Pos[] = [
    { x: 13.5, z: 31 },
    { x: 13.5, z: 32 },
    { x: 13.5, z: 33 },
  ];
  const spawns1: Pos[] = spawns0.map((p) => ({ x: MAP_SIZE - p.x, z: p.z }));

  const nodes: NodeSpec[] = [];
  for (let i = 0; i < BALANCE.nodesPerKindPerPlayer; i++) {
    nodes.push({ owner: 0, kind: "food", cell: { x: 15, z: 22 + i } });
    nodes.push({ owner: 0, kind: "wood", cell: { x: 15, z: 35 + i } });
    nodes.push({ owner: 1, kind: "food", cell: { x: MAP_SIZE - 1 - 15, z: 22 + i } });
    nodes.push({ owner: 1, kind: "wood", cell: { x: MAP_SIZE - 1 - 15, z: 35 + i } });
  }

  return { size: MAP_SIZE, terrain: TERRAIN, townCenters: [tc0, tc1], villagerSpawns: [spawns0, spawns1], nodes };
}

export const MAP_LAYOUT: MapLayout = build();

// La alcanzabilidad (§4.1) requiere navegación y se valida en P0-B.
export function validateMapLayout(layout: MapLayout): void {
  const occupied = new Set<string>();
  const claim = (x: number, z: number, w: number, what: string): void => {
    if (x < 0 || z < 0 || x + w > layout.size || z + w > layout.size) {
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
  for (const t of layout.terrain) {
    for (let i = 0; i < t.w; i++) for (let j = 0; j < t.h; j++) claim(t.x + i, t.z + j, 1, "terreno");
    const mirrored = layout.terrain.some((m) => m.x === layout.size - t.x - t.w && m.z === t.z && m.w === t.w && m.h === t.h);
    if (!mirrored) throw new Error("Mapa inválido: terreno no simétrico");
  }

  const [tc0, tc1] = layout.townCenters;
  if (tc0.z !== tc1.z || tc0.x + TC + tc1.x !== layout.size) {
    throw new Error("Mapa inválido: centros no simétricos");
  }
  for (const kind of ["food", "wood"] as const) {
    for (const owner of [0, 1] as const) {
      const count = layout.nodes.filter((n) => n.owner === owner && n.kind === kind).length;
      if (count !== BALANCE.nodesPerKindPerPlayer) {
        throw new Error(`Mapa inválido: ${count} nodos ${kind} para jugador ${owner}`);
      }
    }
  }
  for (const n of layout.nodes.filter((n) => n.owner === 0)) {
    const mirror = layout.nodes.find(
      (m) => m.owner === 1 && m.kind === n.kind && m.cell.x === layout.size - 1 - n.cell.x && m.cell.z === n.cell.z,
    );
    if (!mirror) throw new Error(`Mapa inválido: nodo ${n.kind} sin simétrico`);
  }
}
