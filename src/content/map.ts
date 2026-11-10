import { BALANCE, type ResourceKind, type UnitKind } from "./balance";

// P2: 128 × 64 = 8192 celdas, el doble de la superficie de P1 (64 × 64) duplicando el eje que une las bases.
export const MAP_WIDTH = 128;
export const MAP_DEPTH = 64;

export interface TerrainRectSpec {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly h: number;
  readonly kind?: "water" | "bridge" | "forest" | "mountain" | "valley" | "camp";
}

export interface StartBuildingSpec {
  readonly owner: 0 | 1;
  readonly kind: "house" | "tower";
  readonly cell: CellPos;
}

export interface StartUnitSpec extends Pos {
  readonly kind: UnitKind;
}

export interface MapLayout {
  readonly width: number;
  readonly depth: number;
  readonly terrain: readonly TerrainRectSpec[];
  readonly startBuildings: readonly StartBuildingSpec[];
  readonly townCenters: readonly [CellPos, CellPos];
  readonly villagerSpawns: readonly [readonly Pos[], readonly Pos[]];
  /** Militares con los que empieza cada bando en el modo villa. */
  readonly startArmy: readonly [readonly StartUnitSpec[], readonly StartUnitSpec[]];
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
    { x: 12.9, z: 31.5 },
    { x: 14.1, z: 31.5 },
    { x: 12.9, z: 33.5 },
    { x: 14.1, z: 33.5 },
  ];
  const spawns1: Pos[] = spawns0.map((p) => ({ x: MAP_WIDTH - p.x, z: p.z }));

  // Pasillo libre entre las dos torres, delante de la aldea: un soldado, un arquero, un caballero y un cañón.
  const army0: StartUnitSpec[] = [
    { kind: "soldier", x: 17.2, z: 31.0 },
    { kind: "archer", x: 17.2, z: 33.0 },
    { kind: "knight", x: 19.6, z: 31.0 },
    { kind: "cannon", x: 19.6, z: 33.0 },
  ];
  const army1: StartUnitSpec[] = army0.map((u) => ({ ...u, x: MAP_WIDTH - u.x }));

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

  return { width: MAP_WIDTH, depth: MAP_DEPTH, terrain: TERRAIN, startBuildings, townCenters: [tc0, tc1],   villagerSpawns: [spawns0, spawns1], startArmy: [army0, army1], nodes };
}

export const MAP_LAYOUT: MapLayout = build();

/** Centro del centro urbano del jugador 0: punto de partida de la cámara. */
export function homeView(layout: MapLayout): Pos {
  const tc = layout.townCenters[0];
  return { x: tc.x + TC / 2, z: tc.z + TC / 2 };
}

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
  for (const owner of [0, 1] as const) {
    layout.startArmy[owner].forEach((u, i) => {
      if (occupied.has(`${Math.floor(u.x)},${Math.floor(u.z)}`)) throw new Error(`Mapa inválido: ${u.kind} inicial sobre una celda ocupada`);
      const twin = layout.startArmy[0][i]!;
      if (u.kind !== twin.kind || u.z !== twin.z || u.x !== (owner === 0 ? twin.x : layout.width - twin.x)) throw new Error(`Mapa inválido: ${u.kind} inicial sin simétrico`);
    });
  }
  if (layout.startArmy[0].length !== layout.startArmy[1].length) throw new Error("Mapa inválido: ejércitos iniciales desiguales");

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

export interface FormationSlot {
  readonly kind: UnitKind;
  readonly x: number;
  readonly z: number;
}

export interface BattleLayout {
  readonly width: number;
  readonly depth: number;
  readonly terrain: readonly TerrainRectSpec[];
  /** Formación inicial de cada bando; el jugador 1 es el giro de 180° del jugador 0. */
  readonly armies: readonly [readonly FormationSlot[], readonly FormationSlot[]];
}

// P10: terreno de la mitad del jugador 0 (x < 64); la mitad rival es su giro de 180° respecto al centro del mapa.
// El valle es transitable (solo cambia el aspecto); montañas, bosques, agua y tiendas impiden el paso; solo los puentes cruzan el agua.
// El afluente es un único cauce continuo que desemboca en el río principal (P10-R17).
// Las tiendas de campaña (P10-R20) son escenario fijo e indestructible detrás de cada ejército: cinco de 4 × 4 centradas en z = 32.
const BATTLE_HALF_TERRAIN: readonly TerrainRectSpec[] = [
  ...[14, 22, 30, 38, 46].map((z): TerrainRectSpec => ({ x: 6, z, w: 4, h: 4, kind: "camp" })),
  { x: 30, z: 0, w: 16, h: 13, kind: "mountain" },
  { x: 36, z: 51, w: 10, h: 13, kind: "mountain" },
  { x: 20, z: 2, w: 8, h: 10, kind: "forest" },
  { x: 46, z: 26, w: 7, h: 12, kind: "forest" },
  { x: 28, z: 13, w: 26, h: 8, kind: "valley" },
  { x: 26, z: 38, w: 12, h: 9, kind: "valley" },
  { x: 40, z: 44, w: 21, h: 3, kind: "water" },
];

// Río principal de borde a borde con tres cruces (z 12..14, 29..34 y 49..51); es simétrico por sí mismo.
const BATTLE_RIVER: readonly TerrainRectSpec[] = [
  { x: 61, z: 0, w: 6, h: 12, kind: "water" },
  { x: 61, z: 12, w: 6, h: 3, kind: "bridge" },
  { x: 61, z: 15, w: 6, h: 14, kind: "water" },
  { x: 61, z: 29, w: 6, h: 6, kind: "bridge" },
  { x: 61, z: 35, w: 6, h: 14, kind: "water" },
  { x: 61, z: 49, w: 6, h: 3, kind: "bridge" },
  { x: 61, z: 52, w: 6, h: 12, kind: "water" },
];

const rotateRect = (t: TerrainRectSpec): TerrainRectSpec => ({ ...t, x: MAP_WIDTH - t.x - t.w, z: MAP_DEPTH - t.z - t.h });

/** Posiciones del jugador 0 (mira hacia +x), centradas en z = 32; el espaciado entre centros es de 1,2 celdas o más. */
function armyOfPlayerZero(): FormationSlot[] {
  const slots: FormationSlot[] = [];
  const centre = MAP_DEPTH / 2;
  const row = (kind: UnitKind, x: number, count: number, step: number): void => {
    for (let i = 0; i < count; i++) slots.push({ kind, x, z: centre + (i - (count - 1) / 2) * step });
  };
  slots.push({ kind: "commander", x: 25, z: centre });
  for (const x of [22, 20.8, 19.6]) row("soldier", x, 15, 1.2);
  row("archer", 17.5, 11, 1.2);
  row("archer", 16.3, 11, 1.2);
  row("cannon", 14, 8, 3);
  for (const [x, zs] of [
    [22, [21, 19, 17]],
    [20.8, [20, 18, 16]],
    [19.6, [21, 19]],
    [22, [43, 45, 47]],
    [20.8, [44, 46, 48]],
    [19.6, [43]],
  ] as const) {
    for (const z of zs) slots.push({ kind: "knight", x, z });
  }
  return slots;
}

function buildBattle(): BattleLayout {
  const left = [...BATTLE_HALF_TERRAIN];
  const terrain = [...left, ...left.map(rotateRect), ...BATTLE_RIVER];
  const army0 = armyOfPlayerZero();
  const army1 = army0.map((s) => ({ ...s, x: MAP_WIDTH - s.x, z: MAP_DEPTH - s.z }));
  return { width: MAP_WIDTH, depth: MAP_DEPTH, terrain, armies: [army0, army1] };
}

export const BATTLE_LAYOUT: BattleLayout = buildBattle();

/** Centro del ejército del jugador 0: punto de partida de la cámara en batalla. */
export function battleHomeView(layout: BattleLayout): Pos {
  const army = layout.armies[0];
  return { x: army.reduce((s, u) => s + u.x, 0) / army.length, z: army.reduce((s, u) => s + u.z, 0) / army.length };
}

const EPS = 1e-9;

export function validateBattleLayout(layout: BattleLayout): void {
  const occupied = new Set<string>();
  for (const t of layout.terrain) {
    if (t.x < 0 || t.z < 0 || t.x + t.w > layout.width || t.z + t.h > layout.depth) throw new Error("Mapa de batalla inválido: terreno fuera de límites");
    for (let i = 0; i < t.w; i++) {
      for (let j = 0; j < t.h; j++) {
        const key = `${t.x + i},${t.z + j}`;
        if (occupied.has(key)) throw new Error(`Mapa de batalla inválido: solape de terreno en ${key}`);
        occupied.add(key);
      }
    }
    const turned = layout.terrain.some((m) => m.x === layout.width - t.x - t.w && m.z === layout.depth - t.z - t.h && m.w === t.w && m.h === t.h && m.kind === t.kind);
    if (!turned) throw new Error("Mapa de batalla inválido: terreno sin simetría de giro");
  }

  const blocking = (cx: number, cz: number): boolean => {
    const t = layout.terrain.find((r) => cx >= r.x && cx < r.x + r.w && cz >= r.z && cz < r.z + r.h);
    return t !== undefined && t.kind !== "bridge" && t.kind !== "valley";
  };
  const roster = BALANCE.battle.roster;
  for (const owner of [0, 1] as const) {
    const army = layout.armies[owner];
    for (const kind of Object.keys(roster) as (keyof typeof roster)[]) {
      const count = army.filter((s) => s.kind === kind).length;
      if (count !== roster[kind]) throw new Error(`Mapa de batalla inválido: ${count} ${kind} para el jugador ${owner}`);
    }
    for (const s of army) {
      const r = BALANCE.units[s.kind].radius;
      for (const cx of [Math.floor(s.x - r), Math.floor(s.x + r)]) {
        for (const cz of [Math.floor(s.z - r), Math.floor(s.z + r)]) {
          if (cx < 0 || cz < 0 || cx >= layout.width || cz >= layout.depth || blocking(cx, cz)) {
            throw new Error(`Mapa de batalla inválido: ${s.kind} en (${s.x}, ${s.z}) sobre terreno no transitable`);
          }
        }
      }
    }
  }
  for (const s of layout.armies[0]) {
    const turned = layout.armies[1].some((m) => m.kind === s.kind && Math.abs(m.x - (layout.width - s.x)) < EPS && Math.abs(m.z - (layout.depth - s.z)) < EPS);
    if (!turned) throw new Error(`Mapa de batalla inválido: ${s.kind} sin simétrico`);
  }
  let nearest = Infinity;
  for (const a of layout.armies[0]) for (const b of layout.armies[1]) nearest = Math.min(nearest, Math.hypot(a.x - b.x, a.z - b.z));
  if (nearest < BALANCE.battle.minArmyDistance) throw new Error(`Mapa de batalla inválido: ejércitos a ${nearest.toFixed(1)} celdas`);
}
