import { BALANCE } from "../content/balance";
import { BALANCE_VERSION, BATTLE_MAP_VERSION, GAME_VERSION, MAP_VERSION } from "../content/versions";
import { visibleEnemies } from "../core/battle";
import { activityOf } from "../core/economy";
import { populationOf } from "../core/state";
import type { CommandResult, GameState, PlayerId, Unit } from "../core/types";
import { PROTOCOL_VERSION, type ObserveMessage, type OrderResult } from "./protocol";

export interface ObservationContext {
  sessionId: string;
  workerGeneration: number;
  requestId: number;
  playerId: PlayerId;
  previousResults: OrderResult[];
}

export function toOrderResult(result: CommandResult): OrderResult {
  return result.accepted
    ? { command_id: result.commandId, accepted: true, code: null }
    : { command_id: result.commandId, accepted: false, code: result.code };
}

const byId = <T extends { id: number }>(items: readonly T[]): T[] => [...items].sort((a, b) => a.id - b.id);

/** En batalla la IA solo recibe sus unidades y las enemigas que ve; en villa recibe todas. */
function observedUnits(state: GameState, player: PlayerId): Unit[] {
  if (state.mode !== "battle") return state.units;
  const seen = new Set(visibleEnemies(state, player).map((u) => u.id));
  return state.units.filter((u) => u.owner === player || seen.has(u.id));
}

/** Copia lógica del estado: solo datos planos, ordenados por ID y sin referencias mutables. */
export function buildObservation(state: GameState, ctx: ObservationContext): ObserveMessage {
  return {
    type: "OBSERVE",
    protocol_version: PROTOCOL_VERSION,
    session_id: ctx.sessionId,
    worker_generation: ctx.workerGeneration,
    request_id: ctx.requestId,
    observation_tick: state.tick,
    player_id: ctx.playerId,
    seed: state.seed,
    game_version: GAME_VERSION,
    map_version: state.mode === "battle" ? BATTLE_MAP_VERSION : MAP_VERSION,
    balance_version: BALANCE_VERSION,
    mode: state.mode,
    players: state.players.map((p) => ({
      id: p.id,
      food: p.food,
      wood: p.wood,
      stone: p.stone,
      pop: populationOf(state, p.id),
      pop_capacity: p.popCapacity,
    })),
    units: byId(observedUnits(state, ctx.playerId)).map((u) => ({
      id: u.id,
      owner: u.owner,
      kind: u.kind,
      x: u.pos.x,
      z: u.pos.z,
      hp: u.hp,
      task: u.task,
      activity: activityOf(u),
      dest: u.dest ? { x: u.dest.x, z: u.dest.z } : null,
      blocked_reason: u.blockedReason,
      carry: u.carry ? { kind: u.carry.kind, amount: u.carry.amount } : null,
      target_id: !u.job ? null : u.job.type === "gather" ? u.job.nodeId : u.job.type === "build" ? u.job.siteId : u.job.targetId,
      defending: u.job?.type === "attack" && u.job.defense,
    })),
    buildings: byId(state.buildings).map((b) => ({
      id: b.id,
      owner: b.owner,
      kind: b.kind,
      cell_x: b.cell.x,
      cell_z: b.cell.z,
      hp: b.hp,
      complete: b.complete,
      build_done: b.buildDone,
      queue: b.queue.map((q) => ({ id: q.id, kind: q.kind, remaining: q.remaining })),
    })),
    resource_nodes: byId(state.resourceNodes).map((n) => ({
      id: n.id,
      kind: n.kind,
      cell_x: n.cell.x,
      cell_z: n.cell.z,
      remaining: n.remaining,
    })),
    map: { width: state.mapWidth, depth: state.mapDepth, terrain: state.terrain.map((t) => ({ x: t.x, z: t.z, w: t.w, h: t.h, ...(t.kind ? { kind: t.kind } : {}) })) },
    rules: {
      max_population: BALANCE.maxPopulation,
      queue_limit: BALANCE.economy.queueLimit,
      house_housing: BALANCE.buildings.house.housing,
      unit_cost: {
        villager: { ...BALANCE.units.villager.cost },
        soldier: { ...BALANCE.units.soldier.cost },
        archer: { ...BALANCE.units.archer.cost },
        knight: { ...BALANCE.units.knight.cost },
        cannon: { ...BALANCE.units.cannon.cost },
        commander: { ...BALANCE.units.commander.cost },
      },
      building_cost: {
        house: { ...BALANCE.buildings.house.cost },
        barracks: { ...BALANCE.buildings.barracks.cost },
        tower: { ...BALANCE.buildings.tower.cost },
        stable: { ...BALANCE.buildings.stable.cost },
        armory: { ...BALANCE.buildings.armory.cost },
      },
      footprint: {
        townCenter: BALANCE.buildings.townCenter.footprint,
        house: BALANCE.buildings.house.footprint,
        barracks: BALANCE.buildings.barracks.footprint,
        tower: BALANCE.buildings.tower.footprint,
        stable: BALANCE.buildings.stable.footprint,
        armory: BALANCE.buildings.armory.footprint,
      },
    },
    previous_results: ctx.previousResults,
  };
}
