// Valores de §4.4 y §4.2 del SDD v0.3: hipótesis de prueba, no balance final.

export const TICKS_PER_SECOND = 20;
export const TICK_MS = 1000 / TICKS_PER_SECOND;
export const MAX_CATCHUP_STEPS = 5;
export const MAX_ACTIVE_TICKS = 24_000;

export type UnitKind = "villager" | "soldier" | "archer";
export type BuildingKind = "townCenter" | "house" | "barracks" | "tower";
export type ResourceKind = "food" | "wood" | "stone";

export interface Cost {
  readonly food: number;
  readonly wood: number;
  /** P3: la piedra solo se gasta en la torre (300). */
  readonly stone: number;
}

export interface UnitDef {
  readonly cost: Cost;
  readonly trainTicks: number;
  readonly hp: number;
  readonly speedCellsPerSec: number;
  readonly damage: number;
  readonly attackIntervalTicks: number;
  readonly range: number;
  readonly radius: number;
}

export interface BuildingDef {
  readonly cost: Cost;
  readonly buildTicks: number;
  readonly hp: number;
  readonly footprint: number;
  readonly housing: number;
  readonly constructible: boolean;
  readonly trains: readonly UnitKind[];
  /** P3: unidad cuyo daño, cadencia y alcance usa el edificio para atacar; null si no ataca. */
  readonly weapon: UnitKind | null;
  /** Flechas por disparo (por defecto 1); el daño del disparo es `arrows` veces el del arma. */
  readonly arrows?: number;
}

export interface EconomyDef {
  readonly harvestIntervalTicks: number;
  readonly carryCapacity: number;
  readonly queueLimit: number;
  readonly cancelRefundRatio: number;
  readonly siteInitialHpRatio: number;
}

export interface CombatDef {
  /** Radio, desde el borde del objetivo, en que un militar inactivo adquiere enemigos. */
  readonly acquireRange: number;
  /** Distancia máxima al punto de adquisición antes de abandonar la persecución. */
  readonly leashRange: number;
}

export interface Balance {
  readonly start: { readonly food: number; readonly wood: number; readonly stone: number; readonly villagers: number; readonly popCapacity: number };
  readonly maxPopulation: number;
  readonly nodesPerKindPerPlayer: number;
  /** P2: el doble de nodos de madera por jugador; la cantidad por nodo no cambia. */
  readonly woodNodesPerPlayer: number;
  /** P3: nodos de piedra por jugador (bloque de 2 × 2 celdas). */
  readonly stoneNodesPerPlayer: number;
  readonly nodeAmount: number;
  readonly economy: EconomyDef;
  readonly combat: CombatDef;
  readonly units: Readonly<Record<UnitKind, UnitDef>>;
  readonly buildings: Readonly<Record<BuildingKind, BuildingDef>>;
}

const s = (seconds: number): number => Math.round(seconds * TICKS_PER_SECOND);

export const BALANCE: Balance = {
  start: { food: 200, wood: 200, stone: 0, villagers: 3, popCapacity: 10 },
  maxPopulation: 50,
  nodesPerKindPerPlayer: 8,
  woodNodesPerPlayer: 16,
  stoneNodesPerPlayer: 4,
  nodeAmount: 500,
  economy: { harvestIntervalTicks: 20, carryCapacity: 10, queueLimit: 5, cancelRefundRatio: 0.75, siteInitialHpRatio: 0.1 },
  combat: { acquireRange: 6, leashRange: 8 },
  units: {
    // El aldeano solo golpea en defensa propia (cuerpo a cuerpo, débil); nunca adquiere ni recibe órdenes de ataque.
    villager: { cost: { food: 50, wood: 0, stone: 0 }, trainTicks: s(10), hp: 40, speedCellsPerSec: 2.5, damage: 3, attackIntervalTicks: s(1.5), range: 0.5, radius: 0.3 },
    soldier: { cost: { food: 60, wood: 20, stone: 0 }, trainTicks: s(12), hp: 100, speedCellsPerSec: 2.5, damage: 10, attackIntervalTicks: s(1), range: 0.5, radius: 0.3 },
    archer: { cost: { food: 40, wood: 50, stone: 0 }, trainTicks: s(15), hp: 60, speedCellsPerSec: 2.5, damage: 8, attackIntervalTicks: s(1.5), range: 5, radius: 0.3 },
  },
  buildings: {
    // El centro urbano dispara como la torre, pero con 3 flechas por disparo (triple daño).
    townCenter: { cost: { food: 0, wood: 0, stone: 0 }, buildTicks: 0, hp: 1500, footprint: 4, housing: 0, constructible: false, trains: ["villager"], weapon: "archer", arrows: 3 },
    house: { cost: { food: 0, wood: 50, stone: 0 }, buildTicks: s(15), hp: 300, footprint: 2, housing: 5, constructible: true, trains: [], weapon: null },
    barracks: { cost: { food: 0, wood: 150, stone: 0 }, buildTicks: s(25), hp: 600, footprint: 3, housing: 0, constructible: true, trains: ["soldier", "archer"], weapon: null },
    // P3: la torre usa el daño, la cadencia y el alcance del arquero (`weapon`); sin alcance mínimo.
    tower: { cost: { food: 0, wood: 0, stone: 300 }, buildTicks: s(30), hp: 800, footprint: 2, housing: 0, constructible: true, trains: [], weapon: "archer" },
  },
};

export function validateBalance(balance: Balance): void {
  const check = (name: string, value: number, min = 0): void => {
    if (!Number.isFinite(value) || value < min) {
      throw new Error(`Balance inválido: ${name}=${value}`);
    }
  };
  check("start.food", balance.start.food);
  check("start.wood", balance.start.wood);
  check("start.stone", balance.start.stone);
  check("start.villagers", balance.start.villagers);
  check("start.popCapacity", balance.start.popCapacity);
  check("maxPopulation", balance.maxPopulation, 1);
  check("nodesPerKindPerPlayer", balance.nodesPerKindPerPlayer);
  check("woodNodesPerPlayer", balance.woodNodesPerPlayer);
  check("stoneNodesPerPlayer", balance.stoneNodesPerPlayer);
  check("nodeAmount", balance.nodeAmount, 1);
  check("economy.harvestIntervalTicks", balance.economy.harvestIntervalTicks, 1);
  check("economy.carryCapacity", balance.economy.carryCapacity, 1);
  check("economy.queueLimit", balance.economy.queueLimit, 1);
  check("economy.cancelRefundRatio", balance.economy.cancelRefundRatio);
  check("economy.siteInitialHpRatio", balance.economy.siteInitialHpRatio);
  if (balance.economy.cancelRefundRatio > 1 || balance.economy.siteInitialHpRatio >= 1) {
    throw new Error("Balance inválido: proporciones de economía fuera de rango");
  }
  check("combat.acquireRange", balance.combat.acquireRange);
  check("combat.leashRange", balance.combat.leashRange, balance.combat.acquireRange);
  for (const [kind, def] of Object.entries(balance.units)) {
    check(`${kind}.cost.food`, def.cost.food);
    check(`${kind}.cost.wood`, def.cost.wood);
    check(`${kind}.cost.stone`, def.cost.stone);
    check(`${kind}.trainTicks`, def.trainTicks, 1);
    check(`${kind}.hp`, def.hp, 1);
    check(`${kind}.speed`, def.speedCellsPerSec, 0.001);
    check(`${kind}.damage`, def.damage);
    check(`${kind}.attackIntervalTicks`, def.attackIntervalTicks);
    check(`${kind}.range`, def.range);
    check(`${kind}.radius`, def.radius, 0.001);
  }
  for (const [kind, def] of Object.entries(balance.buildings)) {
    check(`${kind}.cost.food`, def.cost.food);
    check(`${kind}.cost.wood`, def.cost.wood);
    check(`${kind}.cost.stone`, def.cost.stone);
    check(`${kind}.buildTicks`, def.buildTicks);
    check(`${kind}.hp`, def.hp, 1);
    check(`${kind}.footprint`, def.footprint, 1);
    check(`${kind}.housing`, def.housing);
  }
}
