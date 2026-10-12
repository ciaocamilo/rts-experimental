import { BALANCE, type ResourceKind } from "../content/balance";
import type { NavGrid } from "../navigation/grid";
import { walkTo } from "./movement";
import { buildingRect, distanceToRect, findApproachCell, inRange, nodeRect, ringCells, type CellRect } from "./spatial";
import { addUnit, capacityOf, initialSiteHp, populationOf, rollGender } from "./state";
import type { Building, BuildingDestroyedEvent, DeathEvent, GameState, Job, MainBuildingFinal, PlayerId, SpawnEvent, Unit, WorkEvent } from "./types";

/** Intentos de aproximación antes de abandonar un trabajo (multitudes que no llegan al borde). */
const MAX_APPROACH_ATTEMPTS = 3;

/** Un golpe de martillo audible cada medio segundo de trabajo efectivo. */
const BUILD_SOUND_TICKS = 10;

export type Activity = "idle" | "moving" | "blocked" | "gathering" | "delivering" | "building" | "attacking";

/** Actividad visible de una unidad (§4.2): combina movimiento y trabajo. */
export function activityOf(unit: Unit): Activity {
  const job = unit.job;
  if (job?.type === "attack") return unit.task === "moving" ? "moving" : unit.task === "blocked" ? "blocked" : "attacking";
  if (job && unit.task !== "moving" && unit.task !== "blocked") {
    if (job.type === "gather") return job.stage === "harvest" ? "gathering" : job.stage === "return" ? "delivering" : "moving";
    return job.stage === "work" ? "building" : "moving";
  }
  if (job && unit.task === "moving") return job.type === "gather" && job.stage === "return" ? "delivering" : "moving";
  return unit.task;
}

function approach(state: GameState, grid: NavGrid, unit: Unit, job: Job, rect: CellRect): boolean {
  if (job.retries >= MAX_APPROACH_ATTEMPTS) return false;
  const cell = findApproachCell(grid, unit, rect, state.units);
  if (!cell) return false;
  job.retries += 1;
  walkTo(state, unit, cell);
  return true;
}

/**
 * Respuesta controlada ante un nodo agotado (P3-H02 CA04): el recolector pasa al nodo del mismo recurso
 * más cercano con acceso; si no hay ninguno, cancela el trabajo en lugar de reintentar el nodo desaparecido.
 */
function retarget(state: GameState, grid: NavGrid, unit: Unit, job: Extract<Job, { type: "gather" }>, kind: ResourceKind): void {
  let best: GameState["resourceNodes"][number] | null = null;
  let bestD = Infinity;
  for (const n of state.resourceNodes) {
    if (n.kind !== kind || n.remaining <= 0) continue;
    const d = distanceToRect(unit.pos, nodeRect(n));
    if (d >= bestD) continue;
    const rect = nodeRect(n);
    if (!inRange(unit, rect) && findApproachCell(grid, unit, rect) === null) continue;
    best = n;
    bestD = d;
  }
  if (!best) {
    unit.job = null;
    return;
  }
  job.nodeId = best.id;
  job.stage = "approach";
  job.retries = 0;
}

function stepGather(state: GameState, grid: NavGrid, unit: Unit, job: Extract<Job, { type: "gather" }>, works: WorkEvent[]): void {
  const node = state.resourceNodes.find((n) => n.id === job.nodeId);
  const alive = node !== undefined && node.remaining > 0;

  if (job.stage === "approach") {
    if (!alive) {
      if (unit.carry) {
        job.stage = "return";
        job.retries = 0;
      } else retarget(state, grid, unit, job, job.kind);
      return;
    }
    const rect = nodeRect(node);
    if (inRange(unit, rect)) {
      job.stage = "harvest";
      job.timer = BALANCE.economy.harvestIntervalTicks;
    } else if (!approach(state, grid, unit, job, rect)) {
      unit.job = null;
    }
    return;
  }

  if (job.stage === "harvest") {
    if (!alive) {
      if (unit.carry) {
        job.stage = "return";
        job.retries = 0;
      } else retarget(state, grid, unit, job, job.kind);
      return;
    }
    if (!inRange(unit, nodeRect(node))) {
      job.stage = "approach";
      job.retries = 0;
      return;
    }
    job.timer -= 1;
    if (job.timer > 0) return;
    job.timer = BALANCE.economy.harvestIntervalTicks;
    node.remaining -= 1;
    works.push({ tick: state.tick + 1, unitId: unit.id, owner: unit.owner, kind: node.kind, pos: { x: unit.pos.x, z: unit.pos.z } });
    unit.carry = { kind: node.kind, amount: (unit.carry?.amount ?? 0) + 1 };
    if (node.remaining === 0) {
      // El nodo agotado desaparece: deja de ser objetivo económico y obstáculo de navegación.
      state.resourceNodes = state.resourceNodes.filter((n) => n.id !== node.id);
      state.obstacleVersion += 1;
    }
    if (unit.carry.amount >= BALANCE.economy.carryCapacity || node.remaining === 0) {
      job.stage = "return";
      job.retries = 0;
    }
    return;
  }

  // Entrega en el centro urbano propio y completo más cercano.
  if (!unit.carry) {
    job.stage = "approach";
    job.retries = 0;
    return;
  }
  let target: Building | null = null;
  let bestD = Infinity;
  for (const b of state.buildings) {
    if (b.owner !== unit.owner || b.kind !== "townCenter" || !b.complete) continue;
    const d = distanceToRect(unit.pos, buildingRect(b));
    if (d < bestD) {
      bestD = d;
      target = b;
    }
  }
  if (!target) {
    unit.job = null; // Sin punto de entrega: conserva la carga.
    return;
  }
  const rect = buildingRect(target);
  if (inRange(unit, rect)) {
    state.players[unit.owner][unit.carry.kind] += unit.carry.amount;
    unit.carry = null;
    if (alive) {
      job.stage = "approach";
      job.retries = 0;
    } else {
      retarget(state, grid, unit, job, job.kind);
    }
  } else if (!approach(state, grid, unit, job, rect)) {
    unit.job = null;
  }
}

function stepBuild(state: GameState, grid: NavGrid, unit: Unit, job: Extract<Job, { type: "build" }>, works: WorkEvent[]): void {
  const site = state.buildings.find((b) => b.id === job.siteId);
  if (!site || site.complete) {
    unit.job = null;
    return;
  }
  const rect = buildingRect(site);
  if (!inRange(unit, rect)) {
    if (job.stage === "work") {
      job.stage = "approach";
      job.retries = 0;
    } else if (!approach(state, grid, unit, job, rect)) {
      unit.job = null;
    }
    return;
  }
  if (job.stage === "approach") {
    job.stage = "work";
    return;
  }

  // La vida crece en proporción al trabajo sin borrar el daño recibido.
  const def = BALANCE.buildings[site.kind];
  const pool = def.hp - initialSiteHp(site.kind);
  const gain = (done: number): number => Math.floor((pool * done) / def.buildTicks);
  site.buildDone += 1;
  site.hp += gain(site.buildDone) - gain(site.buildDone - 1);
  if (site.buildDone % BUILD_SOUND_TICKS === 0) {
    works.push({ tick: state.tick + 1, unitId: unit.id, owner: unit.owner, kind: "build", pos: { x: unit.pos.x, z: unit.pos.z } });
  }
  if (site.buildDone >= def.buildTicks) {
    site.complete = true;
    unit.job = null;
  }
}

/** Recolección, entrega y construcción. Las unidades se procesan por orden de lista (ID creciente). Devuelve los golpes de trabajo. */
export function updateJobs(state: GameState, grid: NavGrid): WorkEvent[] {
  const works: WorkEvent[] = [];
  for (const unit of state.units) {
    const job = unit.job;
    if (!job || job.type === "attack" || unit.task === "moving") continue;
    if (unit.task === "blocked") {
      unit.job = null; // Bloqueada: cancela el trabajo y conserva la carga.
      continue;
    }
    if (job.type === "gather") stepGather(state, grid, unit, job, works);
    else stepBuild(state, grid, unit, job, works);
  }
  return works;
}

function findExitCell(state: GameState, grid: NavGrid, building: Building): { x: number; z: number } | null {
  const rect = buildingRect(building);
  const cx = rect.x + rect.w / 2;
  const cz = rect.z + rect.h / 2;
  const candidates = ringCells(rect)
    .filter((c) => !grid.isBlocked(c.x, c.z))
    .sort((a, b) => (a.x + 0.5 - cx) ** 2 + (a.z + 0.5 - cz) ** 2 - ((b.x + 0.5 - cx) ** 2 + (b.z + 0.5 - cz) ** 2) || a.z - b.z || a.x - b.x);
  const clearance = 2 * BALANCE.units.villager.radius;
  return (
    candidates.find((c) => !state.units.some((u) => Math.hypot(u.pos.x - (c.x + 0.5), u.pos.z - (c.z + 0.5)) < clearance)) ?? null
  );
}

/** Solo avanza el primer elemento de cada cola; sin salida libre queda listo y bloquea a los siguientes. Devuelve las unidades nacidas. */
export function updateProduction(state: GameState, grid: NavGrid): SpawnEvent[] {
  const spawns: SpawnEvent[] = [];
  for (const building of state.buildings) {
    if (!building.complete || building.queue.length === 0) continue;
    // Con población por encima de la capacidad (casa destruida) la producción pagada se detiene.
    if (populationOf(state, building.owner) > state.players[building.owner].popCapacity) continue;
    const item = building.queue[0]!;
    if (item.remaining > 0) item.remaining -= 1;
    if (item.remaining > 0) continue;
    const cell = findExitCell(state, grid, building);
    if (!cell) continue;
    building.queue.shift();
    const gender = item.kind === "villager" ? rollGender(state.seed, state.nextEntityId) : "male";
    const unit = addUnit(state, building.owner, item.kind, cell.x + 0.5, cell.z + 0.5, gender);
    spawns.push({ tick: state.tick + 1, buildingId: building.id, unitId: unit.id, owner: unit.owner, kind: unit.kind, pos: { x: unit.pos.x, z: unit.pos.z } });
  }
  return spawns;
}

/** Instant\u00e1nea de los edificios principales con la vida vigente; `destroyed` se deriva de la misma vida que retira la entidad. */
export function snapshotMainBuildings(state: GameState): MainBuildingFinal[] {
  return state.buildings
    .filter((b) => b.kind === "townCenter")
    .map((b) => {
      const def = BALANCE.buildings[b.kind];
      return {
        id: b.id,
        owner: b.owner,
        kind: b.kind,
        hp: Math.max(0, b.hp),
        maxHp: def.hp,
        destroyed: b.hp <= 0,
        complete: b.complete,
        buildProgress: def.buildTicks === 0 ? 1 : Math.min(1, b.buildDone / def.buildTicks),
      };
    });
}

export interface DeadResult {
  /** Due\u00f1os cuyo centro urbano cay\u00f3 en este tick. */
  lostCenters: PlayerId[];
  /** Edificios retirados en este tick, para el colapso visual. */
  destroyed: BuildingDestroyedEvent[];
  /** Unidades retiradas en este tick, para el audio. */
  deaths: DeathEvent[];
}

/** Retira entidades con vida agotada: la carga muere con la unidad y las colas se pierden sin reembolso. Acumula las bajas. */
export function removeDead(state: GameState): DeadResult {
  const lostCenters: PlayerId[] = [];
  const destroyed: BuildingDestroyedEvent[] = [];
  const deaths: DeathEvent[] = [];
  if (state.units.some((u) => u.hp <= 0)) {
    for (const u of state.units) {
      if (u.hp > 0) continue;
      state.losses.units[u.owner] += 1;
      deaths.push({ tick: state.tick + 1, id: u.id, owner: u.owner, kind: u.kind, pos: { x: u.pos.x, z: u.pos.z } });
    }
    state.units = state.units.filter((u) => u.hp > 0);
  }
  if (state.buildings.some((b) => b.hp <= 0)) {
    for (const b of state.buildings) {
      if (b.hp > 0) continue;
      if (b.kind === "townCenter" && !lostCenters.includes(b.owner)) lostCenters.push(b.owner);
      state.losses.buildings[b.owner] += 1;
      destroyed.push({ tick: state.tick + 1, id: b.id, owner: b.owner, kind: b.kind, cell: { x: b.cell.x, z: b.cell.z }, complete: b.complete });
    }
    state.buildings = state.buildings.filter((b) => b.hp > 0);
    state.obstacleVersion += 1;
  }
  return { lostCenters, destroyed, deaths };
}

export function refreshCapacity(state: GameState): void {
  for (const p of state.players) p.popCapacity = capacityOf(state, p.id);
}
