import { PATH_CLEARANCE, SMOOTH_LOOKAHEAD } from "./config";
import type { Cell, NavGrid } from "./grid";

export interface Point {
  x: number;
  z: number;
}

/** Un círculo de radio r centrado en (x,z) no solapa celdas bloqueadas ni sale del mapa. */
export function circleClear(grid: NavGrid, x: number, z: number, r: number): boolean {
  for (let cz = Math.floor(z - r); cz <= Math.floor(z + r); cz++) {
    for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) {
      if (!grid.isBlocked(cx, cz)) continue;
      const nx = Math.min(Math.max(x, cx), cx + 1);
      const nz = Math.min(Math.max(z, cz), cz + 1);
      if ((x - nx) ** 2 + (z - nz) ** 2 < r * r) return false;
    }
  }
  return true;
}

export function segmentClear(grid: NavGrid, a: Point, b: Point, r: number): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const samples = Math.max(1, Math.ceil(len / 0.2));
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    if (!circleClear(grid, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, r)) return false;
  }
  return true;
}

/** Convierte celdas de A* en puntos de paso, saltando los que tienen línea de visión con holgura. */
export function smoothPath(grid: NavGrid, from: Point, cells: readonly Cell[]): Point[] {
  const points: Point[] = [from, ...cells.map((c) => ({ x: c.x + 0.5, z: c.z + 0.5 }))];
  const out: Point[] = [];
  let cur = 0;
  const last = points.length - 1;
  while (cur < last) {
    let next = cur + 1;
    for (let j = Math.min(last, cur + SMOOTH_LOOKAHEAD); j > cur + 1; j--) {
      if (segmentClear(grid, points[cur]!, points[j]!, PATH_CLEARANCE)) {
        next = j;
        break;
      }
    }
    out.push(points[next]!);
    cur = next;
  }
  return out;
}

/** Empuja un círculo fuera de las celdas bloqueadas que solapa. */
export function resolveStatic(grid: NavGrid, pos: Point, r: number): void {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (let cz = Math.floor(pos.z - r); cz <= Math.floor(pos.z + r); cz++) {
      for (let cx = Math.floor(pos.x - r); cx <= Math.floor(pos.x + r); cx++) {
        if (!grid.isBlocked(cx, cz)) continue;
        const nx = Math.min(Math.max(pos.x, cx), cx + 1);
        const nz = Math.min(Math.max(pos.z, cz), cz + 1);
        const dx = pos.x - nx;
        const dz = pos.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        moved = true;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          pos.x += (dx / d) * (r - d);
          pos.z += (dz / d) * (r - d);
        } else {
          // Centro dentro de la celda: salir por el borde más cercano.
          const left = pos.x - cx;
          const right = cx + 1 - pos.x;
          const top = pos.z - cz;
          const bottom = cz + 1 - pos.z;
          const m = Math.min(left, right, top, bottom);
          if (m === left) pos.x = cx - r;
          else if (m === right) pos.x = cx + 1 + r;
          else if (m === top) pos.z = cz - r;
          else pos.z = cz + 1 + r;
        }
      }
    }
    if (!moved) break;
  }
}
