import { BALANCE, TICKS_PER_SECOND } from "../content/balance";
import { findPath } from "../navigation/astar";
import { MAX_REPATHS, PATH_BUDGET_PER_TICK, STUCK_TICKS } from "../navigation/config";
import { resolveStatic, segmentClear, smoothPath } from "../navigation/geometry";
import type { Cell, NavGrid } from "../navigation/grid";
import type { Command, GameState, RejectCode, Unit } from "./types";

const UNIT_RADIUS = BALANCE.units.villager.radius;

function stepLength(unit: Unit): number {
  return BALANCE.units[unit.kind].speedCellsPerSec / TICKS_PER_SECOND;
}

function enqueue(state: GameState, unit: Unit): void {
  unit.needsPath = true;
  unit.path = [];
  if (!state.pathQueue.includes(unit.id)) state.pathQueue.push(unit.id);
}

export function unitComponent(grid: NavGrid, unit: Unit): number {
  const cx = Math.floor(unit.pos.x);
  const cz = Math.floor(unit.pos.z);
  const direct = grid.componentAt(cx, cz);
  if (direct >= 0) return direct;
  const near = grid.nearestFree(cx, cz);
  return near ? grid.componentAt(near.x, near.z) : -1;
}

export function clearTask(unit: Unit): void {
  unit.task = "idle";
  unit.dest = null;
  unit.path = [];
  unit.needsPath = false;
  unit.stuckTicks = 0;
  unit.repaths = 0;
  unit.blockedReason = null;
}

export type MoveOutcome = { assigned: number; total: number } | { code: RejectCode };

/** Ordena a una unidad caminar a una celda; no toca su trabajo ni su carga. */
export function walkTo(state: GameState, unit: Unit, cell: Cell): void {
  clearTask(unit);
  unit.task = "moving";
  unit.dest = { x: cell.x + 0.5, z: cell.z + 0.5 };
  enqueue(state, unit);
}

/** Asigna destinos libres y distintos, por orden estable de ID, alrededor del punto objetivo. */
export function issueMove(state: GameState, grid: NavGrid, command: Command): MoveOutcome {
  const target = command.target;
  if (!target || !("x" in target) || !Number.isFinite(target.x) || !Number.isFinite(target.z)) {
    return { code: "INVALID_TARGET" };
  }
  if (target.x < 0 || target.z < 0 || target.x > state.mapSize || target.z > state.mapSize) {
    return { code: "INVALID_TARGET" };
  }

  const ids = new Set(command.entityIds);
  const units = state.units.filter((u) => ids.has(u.id)).sort((a, b) => a.id - b.id);
  if (units.length === 0) return { code: "INCOMPATIBLE_ENTITY" };

  const free: { x: number; z: number; d: number }[] = [];
  for (let cz = 0; cz < grid.size; cz++) {
    for (let cx = 0; cx < grid.size; cx++) {
      if (grid.isBlocked(cx, cz)) continue;
      free.push({ x: cx, z: cz, d: (cx + 0.5 - target.x) ** 2 + (cz + 0.5 - target.z) ** 2 });
    }
  }
  free.sort((a, b) => a.d - b.d || a.z - b.z || a.x - b.x);
  if (free.length === 0) return { code: "UNREACHABLE" };

  const tx = Math.min(grid.size - 1, Math.floor(target.x));
  const tz = Math.min(grid.size - 1, Math.floor(target.z));
  const comp = grid.isBlocked(tx, tz) ? grid.componentAt(free[0]!.x, free[0]!.z) : grid.componentAt(tx, tz);

  const reachable = units.filter((u) => unitComponent(grid, u) === comp);
  const slots = free.filter((c) => grid.componentAt(c.x, c.z) === comp).slice(0, reachable.length);
  if (slots.length === 0) return { code: "UNREACHABLE" };

  const pool = [...slots];
  for (const unit of reachable.slice(0, slots.length)) {
    let best = 0;
    let bestD = Infinity;
    pool.forEach((s, i) => {
      const d = (s.x + 0.5 - unit.pos.x) ** 2 + (s.z + 0.5 - unit.pos.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const slot = pool.splice(best, 1)[0]!;
    unit.job = null; // Una orden nueva cancela el trabajo, pero conserva la carga.
    walkTo(state, unit, slot);
  }
  return { assigned: slots.length, total: units.length };
}

export function issueStop(state: GameState, command: Command): void {
  const ids = new Set(command.entityIds);
  for (const unit of state.units) {
    if (!ids.has(unit.id)) continue;
    unit.job = null;
    clearTask(unit);
  }
}

/** Invalida rutas que cruzan obstáculos nuevos; no recalcula todas en cada fotograma. */
export function invalidateBlockedPaths(state: GameState, grid: NavGrid): void {
  for (const unit of state.units) {
    if (unit.task !== "moving" || unit.needsPath || unit.path.length === 0) continue;
    let from = unit.pos;
    let clear = true;
    for (const wp of unit.path) {
      if (!segmentClear(grid, from, wp, UNIT_RADIUS)) {
        clear = false;
        break;
      }
      from = wp;
    }
    if (!clear) enqueue(state, unit);
  }
}

function blockUnit(unit: Unit, reason: "UNREACHABLE" | "STUCK"): void {
  unit.task = "blocked";
  unit.blockedReason = reason;
  unit.dest = null;
  unit.path = [];
  unit.needsPath = false;
  unit.stuckTicks = 0;
}

/** Atiende hasta PATH_BUDGET_PER_TICK búsquedas; el resto sigue en cola. */
export function processPathQueue(state: GameState, grid: NavGrid): void {
  let budget = PATH_BUDGET_PER_TICK;
  const byId = new Map(state.units.map((u) => [u.id, u]));
  const rest: number[] = [];

  for (const id of state.pathQueue) {
    const unit = byId.get(id);
    if (!unit || unit.task !== "moving" || !unit.needsPath || !unit.dest) continue;
    if (budget <= 0) {
      rest.push(id);
      continue;
    }
    budget--;

    const start = grid.nearestFree(Math.floor(unit.pos.x), Math.floor(unit.pos.z));
    const goal = grid.nearestFree(Math.floor(unit.dest.x), Math.floor(unit.dest.z));
    const cells: Cell[] | null = start && goal ? findPath(grid, start, goal) : null;
    if (!cells || !goal) {
      blockUnit(unit, "UNREACHABLE");
      continue;
    }
    unit.dest = { x: goal.x + 0.5, z: goal.z + 0.5 };
    unit.path = cells.length === 0 ? [{ ...unit.dest }] : smoothPath(grid, unit.pos, cells);
    unit.needsPath = false;
    unit.stuckTicks = 0;
  }
  state.pathQueue = rest;
}

function separate(state: GameState): void {
  const diameter = 2 * UNIT_RADIUS;
  for (let iter = 0; iter < 2; iter++) {
    const buckets = new Map<number, Unit[]>();
    for (const u of state.units) {
      const key = Math.floor(u.pos.z) * 4096 + Math.floor(u.pos.x);
      const list = buckets.get(key);
      if (list) list.push(u);
      else buckets.set(key, [u]);
    }
    for (const a of state.units) {
      const bx = Math.floor(a.pos.x);
      const bz = Math.floor(a.pos.z);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const list = buckets.get((bz + dz) * 4096 + bx + dx);
          if (!list) continue;
          for (const b of list) {
            if (b.id <= a.id) continue;
            const ex = b.pos.x - a.pos.x;
            const ez = b.pos.z - a.pos.z;
            const d2 = ex * ex + ez * ez;
            if (d2 >= diameter * diameter) continue;
            const d = Math.sqrt(d2);
            // Con coincidencia exacta, separar en un eje estable según el ID.
            const nx = d > 1e-6 ? ex / d : 1;
            const nz = d > 1e-6 ? ez / d : 0;
            const push = (diameter - d) / 2;
            a.pos.x -= nx * push;
            a.pos.z -= nz * push;
            b.pos.x += nx * push;
            b.pos.z += nz * push;
          }
        }
      }
    }
  }
}

/** Avanza unidades, resuelve penetraciones y gestiona el atasco (reintentos y bloqueo). */
export function moveUnits(state: GameState, grid: NavGrid): void {
  const before = state.units.map((u) => ({ x: u.pos.x, z: u.pos.z }));

  for (const unit of state.units) {
    if (unit.task !== "moving" || unit.needsPath || unit.path.length === 0) continue;
    let remaining = stepLength(unit);
    while (remaining > 1e-9 && unit.path.length > 0) {
      const wp = unit.path[0]!;
      const dx = wp.x - unit.pos.x;
      const dz = wp.z - unit.pos.z;
      const d = Math.hypot(dx, dz);
      if (d <= remaining) {
        unit.pos.x = wp.x;
        unit.pos.z = wp.z;
        remaining -= d;
        unit.path.shift();
      } else {
        unit.pos.x += (dx / d) * remaining;
        unit.pos.z += (dz / d) * remaining;
        remaining = 0;
      }
    }
  }

  separate(state);
  for (const unit of state.units) resolveStatic(grid, unit.pos, UNIT_RADIUS);

  state.units.forEach((unit, i) => {
    if (unit.task !== "moving" || unit.needsPath) return;
    if (unit.path.length === 0) {
      clearTask(unit);
      return;
    }
    const prev = before[i]!;
    const moved = Math.hypot(unit.pos.x - prev.x, unit.pos.z - prev.z);
    unit.stuckTicks = moved < 0.25 * stepLength(unit) ? unit.stuckTicks + 1 : 0;
    if (unit.stuckTicks < STUCK_TICKS) return;

    const dest = unit.dest!;
    if (Math.hypot(dest.x - unit.pos.x, dest.z - unit.pos.z) < 1.5) {
      clearTask(unit); // La multitud ocupa el destino: se da por llegada.
    } else if (unit.repaths + 1 >= MAX_REPATHS) {
      blockUnit(unit, "STUCK");
    } else {
      unit.repaths += 1;
      unit.stuckTicks = 0;
      enqueue(state, unit);
    }
  });
}
