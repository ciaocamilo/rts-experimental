import { BALANCE, MAX_ACTIVE_TICKS } from "../content/balance";
import type { Cell, NavGrid } from "../navigation/grid";
import { clearTask, unitComponent, walkTo } from "./movement";
import { buildingRect, distanceToRect, findApproachCell, type CellRect } from "./spatial";
import type { Building, EntityId, GameState, IdleReason, PlayerId, StrikeEvent, Unit, Vec2 } from "./types";

export type Target = Unit | Building;

/** Un objetivo móvil que se aleja más de esto del destino de la persecución obliga a recalcular la ruta. */
const CHASE_DRIFT = 1.5;
/** Intentos de reanudar una persecución desde reposo antes de darla por inalcanzable. */
const MAX_CHASE_RETRIES = 5;
const RAY_STEP = 0.1;
/** El punto de mira se hunde esto dentro del edificio para no caer sobre el borde exacto. */
const AIM_INSET = 0.01;

export const isBuilding = (t: Target): t is Building => "queue" in t;

export function isMilitary(unit: Unit): boolean {
  return BALANCE.units[unit.kind].damage > 0;
}

export function findTarget(state: GameState, id: EntityId | null): Target | null {
  if (id === null) return null;
  return state.units.find((u) => u.id === id) ?? state.buildings.find((b) => b.id === id) ?? null;
}

/** Distancia entre bordes de las formas lógicas: círculo-círculo o círculo-rectángulo. */
export function edgeDistance(from: Unit, target: Target): number {
  const r = BALANCE.units[from.kind].radius;
  if (isBuilding(target)) return Math.max(0, distanceToRect(from.pos, buildingRect(target)) - r);
  const d = Math.hypot(target.pos.x - from.pos.x, target.pos.z - from.pos.z);
  return Math.max(0, d - r - BALANCE.units[target.kind].radius);
}

function aimPoint(from: Unit, target: Target): Vec2 {
  if (!isBuilding(target)) return target.pos;
  const r = buildingRect(target);
  return {
    x: Math.min(Math.max(from.pos.x, r.x + AIM_INSET), r.x + r.w - AIM_INSET),
    z: Math.min(Math.max(from.pos.z, r.z + AIM_INSET), r.z + r.h - AIM_INSET),
  };
}

/** Segmento sin obstáculos sólidos; la huella del propio objetivo no cuenta como obstáculo. */
export function hasLineOfFire(grid: NavGrid, from: Vec2, to: Vec2, ignore: CellRect | null): boolean {
  const samples = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / RAY_STEP));
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const cx = Math.floor(from.x + (to.x - from.x) * t);
    const cz = Math.floor(from.z + (to.z - from.z) * t);
    if (!grid.isBlocked(cx, cz)) continue;
    const inside = ignore !== null && cx >= ignore.x && cx < ignore.x + ignore.w && cz >= ignore.z && cz < ignore.z + ignore.h;
    if (!inside) return false;
  }
  return true;
}

function canStrike(grid: NavGrid, unit: Unit, target: Target): boolean {
  if (edgeDistance(unit, target) > BALANCE.units[unit.kind].range) return false;
  return hasLineOfFire(grid, unit.pos, aimPoint(unit, target), isBuilding(target) ? buildingRect(target) : null);
}

function reachable(grid: NavGrid, unit: Unit, target: Target): boolean {
  if (isBuilding(target)) return findApproachCell(grid, unit, buildingRect(target)) !== null;
  const comp = unitComponent(grid, unit);
  return comp >= 0 && comp === unitComponent(grid, target);
}

/** Puede atacar ya o llegar hasta el objetivo. */
export function canEngage(grid: NavGrid, unit: Unit, target: Target): boolean {
  return canStrike(grid, unit, target) || reachable(grid, unit, target);
}

function acquire(state: GameState, grid: NavGrid, unit: Unit): Target | null {
  const candidates: { target: Target; d: number }[] = [];
  const consider = (target: Target): void => {
    if (target.owner === unit.owner || target.hp <= 0) return;
    const d = edgeDistance(unit, target);
    if (d <= BALANCE.combat.acquireRange) candidates.push({ target, d });
  };
  state.units.forEach(consider);
  state.buildings.forEach(consider);
  candidates.sort((a, b) => a.d - b.d || a.target.id - b.target.id);
  return candidates.find((c) => canEngage(grid, unit, c.target))?.target ?? null;
}

function stopAttack(unit: Unit, reason: IdleReason): void {
  unit.job = null;
  unit.idleReason = reason;
  clearTask(unit);
}

function chase(state: GameState, grid: NavGrid, unit: Unit, target: Target): IdleReason | null {
  if (unit.task === "blocked") return "UNREACHABLE";
  if (isBuilding(target)) {
    if (unit.task === "moving") return null;
    const cell = findApproachCell(grid, unit, buildingRect(target));
    if (!cell) return "UNREACHABLE";
    walkTo(state, unit, cell);
    return null;
  }
  const following = unit.task === "moving" && unit.dest !== null && Math.hypot(unit.dest.x - target.pos.x, unit.dest.z - target.pos.z) <= CHASE_DRIFT;
  if (following) return null;
  if (unit.task !== "moving") {
    const job = unit.job;
    if (job?.type === "attack") {
      job.retries += 1;
      if (job.retries > MAX_CHASE_RETRIES) return "UNREACHABLE";
    }
  }
  const cell: Cell = { x: Math.floor(target.pos.x), z: Math.floor(target.pos.z) };
  walkTo(state, unit, cell);
  return null;
}

/**
 * Adquisición, persecución y ataques del tick. Los disparos válidos se reúnen primero y el daño se
 * aplica al final, de modo que todos los atacantes habilitados al inicio del tick golpean aunque mueran.
 * Devuelve los ataques efectuados para que la vista los represente; no alteran el estado.
 */
export function updateCombat(state: GameState, grid: NavGrid): StrikeEvent[] {
  const strikes: { attacker: Unit; target: Target }[] = [];
  const events: StrikeEvent[] = [];

  for (const unit of state.units) {
    if (unit.cooldown > 0) unit.cooldown -= 1;
    if (!isMilitary(unit)) continue;

    let job = unit.job;
    if (job && job.type !== "attack") continue;
    if (!job) {
      if (unit.task !== "idle") continue;
      const found = acquire(state, grid, unit);
      if (!found) continue;
      job = { type: "attack", targetId: found.id, anchor: { x: unit.pos.x, z: unit.pos.z }, retries: 0 };
      unit.job = job;
      unit.idleReason = null;
    }

    const target = findTarget(state, job.targetId);
    if (!target || target.hp <= 0 || target.owner === unit.owner) {
      stopAttack(unit, "TARGET_DEAD");
      continue;
    }

    if (canStrike(grid, unit, target)) {
      if (unit.task === "moving") clearTask(unit);
      job.retries = 0;
      if (unit.cooldown === 0) strikes.push({ attacker: unit, target });
      continue;
    }

    if (job.anchor && Math.hypot(unit.pos.x - job.anchor.x, unit.pos.z - job.anchor.z) > BALANCE.combat.leashRange) {
      // Fuera de la correa: abandona el objetivo y regresa al punto de adquisición.
      const home = { x: Math.floor(job.anchor.x), z: Math.floor(job.anchor.z) };
      unit.job = null;
      walkTo(state, unit, home);
      continue;
    }

    const failure = chase(state, grid, unit, target);
    if (failure) stopAttack(unit, failure);
  }

  for (const { attacker, target } of strikes) {
    const def = BALANCE.units[attacker.kind];
    events.push({
      tick: state.tick + 1,
      attackerId: attacker.id,
      attackerOwner: attacker.owner,
      attackerKind: attacker.kind,
      targetId: target.id,
      from: { x: attacker.pos.x, z: attacker.pos.z },
      to: { ...aimPoint(attacker, target) },
    });
    target.hp = Math.max(0, target.hp - def.damage);
    attacker.cooldown = def.attackIntervalTicks;
  }
  return events;
}

/** Fija el resultado: la destrucción de centros tiene prioridad sobre el límite de tiempo. */
export function resolveMatch(state: GameState, destroyedCenters: readonly PlayerId[]): void {
  if (destroyedCenters.length > 0) {
    const lost = new Set(destroyedCenters);
    const winner = lost.size === 2 ? null : lost.has(0) ? 1 : 0;
    state.outcome = { winner, reason: "TOWN_CENTER_DESTROYED" };
    state.matchStatus = "ended";
  } else if (state.tick >= MAX_ACTIVE_TICKS) {
    state.outcome = { winner: null, reason: "TIME_LIMIT" };
    state.matchStatus = "ended";
  }
}
