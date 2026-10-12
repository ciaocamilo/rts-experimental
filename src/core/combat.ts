import { BALANCE, MAX_ACTIVE_TICKS } from "../content/balance";
import type { Cell, NavGrid } from "../navigation/grid";
import { clearTask, unitComponent, walkTo } from "./movement";
import { buildingRect, distanceToRect, findApproachCell, type CellRect } from "./spatial";
import type { Building, EntityId, GameState, IdleReason, MainBuildingFinal, PlayerId, StrikeEvent, Unit, Vec2 } from "./types";

export type Target = Unit | Building;

/** Un objetivo móvil que se aleja más de esto del destino de la persecución obliga a recalcular la ruta. */
const CHASE_DRIFT = 1.5;
/** Intentos de reanudar una persecución desde reposo antes de darla por inalcanzable. */
const MAX_CHASE_RETRIES = 5;
/** Ticks durante los que no se vuelve a adquirir automáticamente un objetivo que resultó inalcanzable (5 s). */
const AVOID_TICKS = 100;
const RAY_STEP = 0.1;
/** El punto de mira se hunde esto dentro del edificio para no caer sobre el borde exacto. */
const AIM_INSET = 0.01;
/** Separación lateral entre flechas de un mismo disparo múltiple. */
const ARROW_SPREAD = 0.3;

export const isBuilding = (t: Target): t is Building => "queue" in t;

/** Unidad de combate: adquiere objetivos sola. El aldeano solo se defiende o ataca por orden expresa (`canFight`). */
export function isMilitary(unit: Unit): boolean {
  return unit.kind !== "villager" && BALANCE.units[unit.kind].damage > 0;
}

/** Puede dar golpes: los militares y los aldeanos (estos solo en defensa o por orden). */
export function canFight(unit: Unit): boolean {
  return BALANCE.units[unit.kind].damage > 0;
}

/** Torre: edificio con arma. */
export function isArmed(b: Building): boolean {
  return BALANCE.buildings[b.kind].weapon !== null;
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
    if (unit.avoid && unit.avoid.targetId === target.id && unit.avoid.until > state.tick) return;
    const d = edgeDistance(unit, target);
    if (d <= BALANCE.combat.acquireRange) candidates.push({ target, d });
  };
  state.units.forEach(consider);
  state.buildings.forEach(consider);
  candidates.sort((a, b) => a.d - b.d || a.target.id - b.target.id);
  return candidates.find((c) => canEngage(grid, unit, c.target))?.target ?? null;
}

function stopAttack(state: GameState, grid: NavGrid, unit: Unit, reason: IdleReason): void {
  const job = unit.job;
  if (job?.type === "attack" && reason === "UNREACHABLE") unit.avoid = { targetId: job.targetId, until: state.tick + AVOID_TICKS };
  unit.job = null;
  unit.idleReason = reason;
  clearTask(unit);
  if (job?.type === "attack" && restoreAfterDefense(state, grid, unit, job)) return;
  // La defensa es temporal: si interrumpió un movimiento, se reanuda mientras el destino siga siendo alcanzable.
  if (job?.type === "attack" && job.resume) resumeMove(state, grid, unit, job.resume);
}

function resumeMove(state: GameState, grid: NavGrid, unit: Unit, dest: Vec2): void {
  const cell: Cell = { x: Math.floor(dest.x), z: Math.floor(dest.z) };
  const comp = unitComponent(grid, unit);
  if (grid.isBlocked(cell.x, cell.z) || comp < 0 || grid.componentAt(cell.x, cell.z) !== comp) return;
  walkTo(state, unit, cell);
}

/**
 * Convierte el último impacto hostil en un objetivo defensivo temporal. Se consume siempre: un impacto repetido del
 * mismo agresor no apila órdenes y no reinicia la ruta mientras la defensa siga activa.
 */
function defenseJob(state: GameState, grid: NavGrid, unit: Unit): Extract<NonNullable<Unit["job"]>, { type: "attack" }> | null {
  const threat = unit.threat;
  unit.threat = null;
  if (!threat) return null;
  const attacker = findTarget(state, threat.attackerId);
  if (!attacker || attacker.hp <= 0 || attacker.owner === unit.owner || !canEngage(grid, unit, attacker)) return null;
  if (!isMilitary(unit) && isBuilding(attacker)) return null;
  const previous = unit.job?.type === "attack" ? unit.job : null;
  const back = previous && !previous.defense ? { targetId: previous.targetId, anchor: previous.anchor } : (previous?.back ?? null);
  const resume = !unit.job && unit.task === "moving" && unit.dest ? { x: unit.dest.x, z: unit.dest.z } : null;
  return { type: "attack", targetId: attacker.id, anchor: { x: unit.pos.x, z: unit.pos.z }, retries: 0, defense: true, resume, back };
}

/** Al acabar una defensa, retoma el ataque a un edificio que interrumpió si sigue siendo válido y alcanzable. */
function restoreAfterDefense(state: GameState, grid: NavGrid, unit: Unit, job: AttackJob): boolean {
  if (!job.defense || !job.back) return false;
  const target = findTarget(state, job.back.targetId);
  if (!target || target.hp <= 0 || target.owner === unit.owner || !canEngage(grid, unit, target)) return false;
  clearTask(unit);
  unit.job = { type: "attack", targetId: target.id, anchor: job.back.anchor, retries: 0, defense: false, resume: null, back: null };
  unit.idleReason = null;
  return true;
}

function chase(state: GameState, grid: NavGrid, unit: Unit, target: Target): IdleReason | null {
  if (unit.task === "blocked") return "UNREACHABLE";
  if (isBuilding(target)) {
    if (unit.task === "moving") return null;
    const job = unit.job;
    if (job?.type === "attack") {
      job.retries += 1;
      if (job.retries > MAX_CHASE_RETRIES) return "UNREACHABLE";
    }
    const cell = findApproachCell(grid, unit, buildingRect(target), state.units);
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

type AttackJob = Extract<NonNullable<Unit["job"]>, { type: "attack" }>;

/** Un disparo reunido durante el tick: de una unidad o de una torre. */
interface Strike {
  attacker: Unit | Building;
  target: Target;
}

/** Distancia entre bordes de un edificio armado y una unidad (la torre dispara desde su huella). */
function towerReach(tower: Building, target: Unit): number {
  return Math.max(0, distanceToRect(target.pos, buildingRect(tower)) - BALANCE.units[target.kind].radius);
}

function towerCenter(tower: Building): Vec2 {
  const r = buildingRect(tower);
  return { x: r.x + r.w / 2, z: r.z + r.h / 2 };
}

/**
 * Objetivo de una torre completa: sin alcance mínimo, hasta el alcance vigente del arma (el del arquero).
 * Prioriza a quien ataca a una entidad aliada dentro de su radio; después el más cercano; empate por ID.
 */
function pickTowerTarget(state: GameState, grid: NavGrid, tower: Building): Unit | null {
  const weapon = BALANCE.units[BALANCE.buildings[tower.kind].weapon!];
  const rect = buildingRect(tower);
  const from = towerCenter(tower);
  let best: Unit | null = null;
  let bestKey: [number, number, number] | null = null;
  for (const u of state.units) {
    if (u.owner === tower.owner || u.hp <= 0) continue;
    const d = towerReach(tower, u);
    if (d > weapon.range) continue;
    if (!hasLineOfFire(grid, from, u.pos, rect)) continue;
    const victim = u.job?.type === "attack" ? findTarget(state, u.job.targetId) : null;
    const threatens = victim !== null && victim.owner === tower.owner;
    const key: [number, number, number] = [threatens ? 0 : 1, d, u.id];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = u;
      bestKey = key;
    }
  }
  return best;
}

/**
 * Adquisición, persecución y ataques del tick. Los disparos válidos se reúnen primero y el daño se
 * aplica al final, de modo que todos los atacantes habilitados al inicio del tick golpean aunque mueran.
 * Devuelve los ataques efectuados para que la vista los represente; no alteran el estado.
 */
export function updateCombat(state: GameState, grid: NavGrid): StrikeEvent[] {
  const strikes: Strike[] = [];
  const events: StrikeEvent[] = [];

  for (const unit of state.units) {
    if (unit.cooldown > 0) unit.cooldown -= 1;
    if (!canFight(unit)) continue;
    const worker = !isMilitary(unit);

    let job: AttackJob | null = null;
    if (unit.job && unit.job.type !== "attack") {
      // El aldeano abandona su trabajo solo si lo agreden; el militar con otra orden la mantiene.
      const reaction = worker ? defenseJob(state, grid, unit) : null;
      if (!reaction) {
        if (worker) unit.threat = null;
        continue;
      }
      clearTask(unit);
      unit.job = reaction;
      unit.idleReason = null;
    }
    job = unit.job;

    // Defensa automática (P3-R01): cede ante un agresor un ataque a un edificio (manual o automático); no un ataque a una unidad.
    const current = job ? findTarget(state, job.targetId) : null;
    const mayDefend = job === null || (!job.defense && current !== null && isBuilding(current));
    const defense = mayDefend ? defenseJob(state, grid, unit) : null;
    if (!mayDefend) unit.threat = null;
    if (defense) {
      job = defense;
      unit.job = defense;
      unit.idleReason = null;
    }
    if (!job) {
      if (worker || unit.task !== "idle") continue;
      const found = acquire(state, grid, unit);
      if (!found) continue;
      job = { type: "attack", targetId: found.id, anchor: { x: unit.pos.x, z: unit.pos.z }, retries: 0, defense: false, resume: null, back: null };
      unit.job = job;
      unit.idleReason = null;
    }

    const target = findTarget(state, job.targetId);
    if (!target || target.hp <= 0 || target.owner === unit.owner) {
      stopAttack(state, grid, unit, "TARGET_DEAD");
      continue;
    }

    if (canStrike(grid, unit, target)) {
      if (unit.task === "moving") clearTask(unit);
      job.retries = 0;
      if (unit.cooldown === 0) strikes.push({ attacker: unit, target });
      continue;
    }

    if (job.anchor && Math.hypot(unit.pos.x - job.anchor.x, unit.pos.z - job.anchor.z) > BALANCE.combat.leashRange) {
      // Fuera de la correa: abandona el objetivo y regresa al destino interrumpido o al punto de adquisición.
      unit.job = null;
      if (restoreAfterDefense(state, grid, unit, job)) continue;
      if (job.resume) {
        clearTask(unit);
        resumeMove(state, grid, unit, job.resume);
      } else {
        walkTo(state, unit, { x: Math.floor(job.anchor.x), z: Math.floor(job.anchor.z) });
      }
      continue;
    }

    const failure = chase(state, grid, unit, target);
    if (failure) stopAttack(state, grid, unit, failure);
  }

  // Torres: disparan sin orden, con el daño, la cadencia y el alcance del arma que usan.
  for (const tower of state.buildings) {
    if (!isArmed(tower) || !tower.complete || tower.hp <= 0) continue;
    if (tower.cooldown > 0) tower.cooldown -= 1;
    if (tower.cooldown > 0) continue;
    const target = pickTowerTarget(state, grid, tower);
    if (target) strikes.push({ attacker: tower, target });
  }

  for (const { attacker, target } of strikes) {
    if (isBuilding(attacker)) {
      const def = BALANCE.units[BALANCE.buildings[attacker.kind].weapon!];
      const arrows = BALANCE.buildings[attacker.kind].arrows ?? 1;
      const from = towerCenter(attacker);
      const aim = target as Unit;
      // Las flechas adicionales se abren en abanico solo para la vista; el daño se aplica de una vez.
      const length = Math.hypot(aim.pos.x - from.x, aim.pos.z - from.z) || 1;
      for (let i = 0; i < arrows; i++) {
        const spread = (i - (arrows - 1) / 2) * ARROW_SPREAD;
        events.push({
          tick: state.tick + 1,
          attackerId: attacker.id,
          attackerOwner: attacker.owner,
          attackerKind: "tower",
          targetId: target.id,
          targetOwner: target.owner,
          from,
          to: { x: aim.pos.x - ((aim.pos.z - from.z) / length) * spread, z: aim.pos.z + ((aim.pos.x - from.x) / length) * spread },
        });
      }
      target.hp = Math.max(0, target.hp - def.damage * arrows);
      attacker.cooldown = def.attackIntervalTicks;
      if (canFight(target as Unit) && target.hp > 0) (target as Unit).threat = { attackerId: attacker.id, tick: state.tick + 1 };
      continue;
    }
    const def = BALANCE.units[attacker.kind];
    events.push({
      tick: state.tick + 1,
      attackerId: attacker.id,
      attackerOwner: attacker.owner,
      attackerKind: attacker.kind,
      targetId: target.id,
      targetOwner: target.owner,
      from: { x: attacker.pos.x, z: attacker.pos.z },
      to: { ...aimPoint(attacker, target) },
    });
    target.hp = Math.max(0, target.hp - def.damage);
    attacker.cooldown = def.attackIntervalTicks;
    // El agresor queda registrado para que una unidad militar herida pueda contraatacar.
    if (!isBuilding(target) && canFight(target) && target.hp > 0) target.threat = { attackerId: attacker.id, tick: state.tick + 1 };
  }
  return events;
}

/** Fija el resultado: la destrucción de centros tiene prioridad sobre el límite de tiempo. */
export function resolveMatch(state: GameState, destroyedCenters: readonly PlayerId[], mainBuildings: readonly MainBuildingFinal[]): void {
  const reason = destroyedCenters.length > 0 ? "TOWN_CENTER_DESTROYED" : state.tick >= MAX_ACTIVE_TICKS ? "TIME_LIMIT" : null;
  if (!reason) return;
  const lost = new Set(destroyedCenters);
  const winner = reason === "TIME_LIMIT" || lost.size === 2 ? null : lost.has(0) ? 1 : 0;
  state.outcome = {
    winner,
    reason,
    endTick: state.tick,
    mainBuildings: mainBuildings.map((b) => ({ ...b })),
    casualties: { units: [...state.losses.units], buildings: [...state.losses.buildings] },
  };
  state.matchStatus = "ended";
}
