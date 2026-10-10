import { BALANCE, type BuildingKind, type UnitKind } from "../content/balance";
import type { NavGrid } from "../navigation/grid";
import { canEngage, findTarget, isMilitary } from "./combat";
import { clearTask } from "./movement";
import { previewPlacement } from "./placement";
import { addBuilding, populationOf } from "./state";
import { buildingRect, findApproachCell, inRange, nodeRect } from "./spatial";
import type { Building, Command, GameState, RejectCode, Unit } from "./types";

export type OrderOutcome = { code: RejectCode } | { assigned?: number; total?: number };

const fail = (code: RejectCode): OrderOutcome => ({ code });

function villagersOf(state: GameState, command: Command): Unit[] {
  const ids = new Set(command.entityIds);
  return state.units.filter((u) => ids.has(u.id) && u.kind === "villager").sort((a, b) => a.id - b.id);
}

function targetEntity(command: Command): number | null {
  const t = command.target;
  return t && "entityId" in t ? t.entityId : null;
}

function isBuildingKind(kind: unknown): kind is BuildingKind {
  return typeof kind === "string" && Object.hasOwn(BALANCE.buildings, kind);
}

function isUnitKind(kind: unknown): kind is UnitKind {
  return typeof kind === "string" && Object.hasOwn(BALANCE.units, kind);
}

function refund(state: GameState, owner: 0 | 1, cost: { food: number; wood: number }, ratio: number): void {
  const p = state.players[owner];
  p.food += Math.floor(cost.food * ratio);
  p.wood += Math.floor(cost.wood * ratio);
}

/** Gather: aldeanos hacia un nodo con recursos; la carga de otro tipo se entrega antes. */
export function issueGather(state: GameState, grid: NavGrid, command: Command): OrderOutcome {
  const nodeId = targetEntity(command);
  const node = state.resourceNodes.find((n) => n.id === nodeId);
  if (!node || node.remaining <= 0) return fail("INVALID_TARGET");
  const villagers = villagersOf(state, command);
  if (villagers.length === 0) return fail("INCOMPATIBLE_ENTITY");

  const rect = nodeRect(node);
  const reachable = villagers.filter((u) => inRange(u, rect) || findApproachCell(grid, u, rect) !== null);
  if (reachable.length === 0) return fail("UNREACHABLE");

  for (const unit of reachable) {
    const mustDeliver = unit.carry !== null && (unit.carry.kind !== node.kind || unit.carry.amount >= BALANCE.economy.carryCapacity);
    clearTask(unit);
    unit.job = { type: "gather", nodeId: node.id, stage: mustDeliver ? "return" : "approach", timer: 0, retries: 0 };
  }
  return { assigned: reachable.length, total: villagers.length };
}

/** Build: valida y cobra de forma atómica; el aldeano de menor ID con acceso a la huella construye. */
export function issueBuild(state: GameState, grid: NavGrid, command: Command): OrderOutcome {
  const kind = command.kind;
  const target = command.target;
  if (!isBuildingKind(kind) || !target || !("x" in target)) return fail("INVALID_TARGET");
  const builders = villagersOf(state, command);
  if (builders.length === 0) return fail("INCOMPATIBLE_ENTITY");

  const code = previewPlacement(state, grid, command.player, kind, target.x, target.z);
  if (code) return fail(code);

  const w = BALANCE.buildings[kind].footprint;
  const rect = { x: target.x, z: target.z, w, h: w };
  const builder = builders.find((u) => findApproachCell(grid, u, rect) !== null);
  if (!builder) return fail("UNREACHABLE");

  const cost = BALANCE.buildings[kind].cost;
  const player = state.players[command.player];
  player.food -= cost.food;
  player.wood -= cost.wood;

  const site = addBuilding(state, command.player, kind, target.x, target.z, false);
  clearTask(builder);
  builder.job = { type: "build", siteId: site.id, stage: "approach", retries: 0 };
  return { assigned: 1, total: builders.length };
}

/** ResumeBuild: otro aldeano retoma una obra pausada; una obra con constructor activo se rechaza. */
export function issueResumeBuild(state: GameState, grid: NavGrid, command: Command): OrderOutcome {
  const siteId = targetEntity(command);
  const site = state.buildings.find((b) => b.id === siteId);
  if (!site || site.complete) return fail("INVALID_TARGET");
  if (site.owner !== command.player) return fail("NOT_OWNER");
  const villagers = villagersOf(state, command);
  if (villagers.length === 0) return fail("INCOMPATIBLE_ENTITY");

  const rect = buildingRect(site);
  const builder = villagers.find((u) => inRange(u, rect) || findApproachCell(grid, u, rect) !== null);
  if (!builder) return fail("UNREACHABLE");

  const busy = state.units.some((u) => u.id !== builder.id && u.job?.type === "build" && u.job.siteId === site.id);
  if (busy) return fail("SITE_BUSY");

  clearTask(builder);
  builder.job = { type: "build", siteId: site.id, stage: "approach", retries: 0 };
  return { assigned: 1, total: villagers.length };
}

/** CancelBuild: devuelve el 75 % (redondeo hacia abajo) y libera la huella. */
export function issueCancelBuild(state: GameState, command: Command): OrderOutcome {
  const sites: Building[] = [];
  for (const id of command.entityIds) {
    const b = state.buildings.find((x) => x.id === id);
    if (!b || b.complete) return fail("INCOMPATIBLE_ENTITY");
    sites.push(b);
  }
  if (sites.length === 0) return fail("INVALID_TARGET");

  for (const site of sites) {
    refund(state, site.owner, BALANCE.buildings[site.kind].cost, BALANCE.economy.cancelRefundRatio);
    state.buildings = state.buildings.filter((b) => b.id !== site.id);
    for (const u of state.units) {
      if (u.job?.type === "build" && u.job.siteId === site.id) {
        u.job = null;
        clearTask(u);
      }
    }
    state.obstacleVersion += 1;
  }
  return { assigned: sites.length, total: sites.length };
}

/** Train: reserva una plaza de población, cobra y encola (máximo 5 por edificio). */
export function issueTrain(state: GameState, command: Command): OrderOutcome {
  if (command.entityIds.length !== 1 || !isUnitKind(command.kind)) return fail("INVALID_TARGET");
  const building = state.buildings.find((b) => b.id === command.entityIds[0]);
  if (!building) return fail("INCOMPATIBLE_ENTITY");
  const kind = command.kind;
  if (!BALANCE.buildings[building.kind].trains.includes(kind)) return fail("INCOMPATIBLE_ENTITY");
  if (!building.complete) return fail("NOT_COMPLETE");
  if (building.queue.length >= BALANCE.economy.queueLimit) return fail("QUEUE_FULL");

  const owner = state.players[building.owner];
  if (populationOf(state, building.owner) + 1 > owner.popCapacity) return fail("POPULATION_LIMIT");

  const def = BALANCE.units[kind];
  if (owner.food < def.cost.food || owner.wood < def.cost.wood) return fail("INSUFFICIENT_RESOURCES");

  owner.food -= def.cost.food;
  owner.wood -= def.cost.wood;
  building.queue.push({ id: state.nextEntityId++, kind, remaining: def.trainTicks });
  return {};
}

/** Attack: militares persiguen y atacan a un enemigo vivo; el resto de la selecci\u00f3n se ignora. */
export function issueAttack(state: GameState, grid: NavGrid, command: Command): OrderOutcome {
  const target = findTarget(state, targetEntity(command));
  if (!target || target.hp <= 0 || target.owner === command.player) return fail("INVALID_TARGET");

  const ids = new Set(command.entityIds);
  const soldiers = state.units.filter((u) => ids.has(u.id) && isMilitary(u)).sort((a, b) => a.id - b.id);
  if (soldiers.length === 0) return fail("INCOMPATIBLE_ENTITY");

  const able = soldiers.filter((u) => canEngage(grid, u, target));
  if (able.length === 0) return fail("UNREACHABLE");

  for (const unit of able) {
    clearTask(unit);
    unit.job = { type: "attack", targetId: target.id, anchor: null, retries: 0 };
    unit.idleReason = null;
  }
  return { assigned: able.length, total: soldiers.length };
}

/** CancelTraining: devuelve el coste completo y libera la plaza reservada. */
export function issueCancelTraining(state: GameState, command: Command): OrderOutcome {
  const itemId = targetEntity(command);
  if (command.entityIds.length !== 1) return fail("INVALID_TARGET");
  const building = state.buildings.find((b) => b.id === command.entityIds[0]);
  if (!building) return fail("INCOMPATIBLE_ENTITY");
  const index = building.queue.findIndex((q) => q.id === itemId);
  if (index < 0) return fail("INVALID_TARGET");

  const [item] = building.queue.splice(index, 1);
  refund(state, building.owner, BALANCE.units[item!.kind].cost, 1);
  return {};
}
