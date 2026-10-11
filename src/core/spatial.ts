import { BALANCE } from "../content/balance";
import type { Cell, NavGrid } from "../navigation/grid";
import { unitComponent } from "./movement";
import type { Building, ResourceNode, Unit } from "./types";

/** Rectángulo alineado a celdas: esquina mínima y tamaño. */
export interface CellRect {
  x: number;
  z: number;
  w: number;
  h: number;
}

/** Distancia máxima, desde el centro de una unidad al borde de su objetivo, para interactuar. */
export const INTERACT_RANGE = 1.5;

export function buildingRect(b: Building): CellRect {
  const w = BALANCE.buildings[b.kind].footprint;
  return { x: b.cell.x, z: b.cell.z, w, h: w };
}

export function nodeRect(n: ResourceNode): CellRect {
  return { x: n.cell.x, z: n.cell.z, w: 1, h: 1 };
}

export function distanceToRect(p: { x: number; z: number }, r: CellRect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dz = Math.max(r.z - p.z, 0, p.z - (r.z + r.h));
  return Math.hypot(dx, dz);
}

export function inRange(unit: Unit, r: CellRect): boolean {
  return distanceToRect(unit.pos, r) <= INTERACT_RANGE;
}

/** Celdas del anillo exterior (incluye diagonales) que rodea a un rectángulo. */
export function ringCells(r: CellRect): Cell[] {
  const out: Cell[] = [];
  for (let z = r.z - 1; z <= r.z + r.h; z++) {
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      const inside = x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.h;
      if (!inside) out.push({ x, z });
    }
  }
  return out;
}

/** Una unidad quieta bloquea una celda de interacci\u00f3n si su cuerpo solapa el centro de la celda. */
const CELL_CLEARANCE = 0.55;

/**
 * Celda libre del anillo, en la misma regi\u00f3n que la unidad, m\u00e1s cercana a ella (desempate z, x por orden de recorrido).
 * Con `others`, prefiere las celdas que ninguna otra unidad quieta ocupa; si todas est\u00e1n ocupadas, usa la m\u00e1s cercana
 * (la ocupaci\u00f3n es temporal y no hace inaccesible el objetivo).
 */
export function findApproachCell(grid: NavGrid, unit: Unit, r: CellRect, others: readonly Unit[] = []): Cell | null {
  const comp = unitComponent(grid, unit);
  if (comp < 0) return null;
  let best: Cell | null = null;
  let bestD = Infinity;
  let bestFree: Cell | null = null;
  let bestFreeD = Infinity;
  for (const c of ringCells(r)) {
    if (grid.isBlocked(c.x, c.z) || grid.componentAt(c.x, c.z) !== comp) continue;
    const d = (c.x + 0.5 - unit.pos.x) ** 2 + (c.z + 0.5 - unit.pos.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
    if (d < bestFreeD && !others.some((o) => o !== unit && o.task !== "moving" && Math.hypot(o.pos.x - (c.x + 0.5), o.pos.z - (c.z + 0.5)) < CELL_CLEARANCE)) {
      bestFreeD = d;
      bestFree = c;
    }
  }
  return bestFree ?? best;
}

/** ¿Un círculo de radio r en (x,z) solapa el rectángulo? */
export function circleOverlapsRect(x: number, z: number, r: number, rect: CellRect): boolean {
  return distanceToRect({ x, z }, rect) < r;
}

export function rectsOverlap(a: CellRect, b: CellRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.h && b.z < a.z + a.h;
}
