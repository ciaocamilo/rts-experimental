import { BALANCE } from "../content/balance";
import { BALANCE_VERSION, GAME_VERSION, MAP_VERSION } from "../content/versions";
import { activityOf } from "../core/economy";
import { populationOf } from "../core/state";
import type { CommandResult, GameState, PlayerId } from "../core/types";
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
    map_version: MAP_VERSION,
    balance_version: BALANCE_VERSION,
    players: state.players.map((p) => ({
      id: p.id,
      food: p.food,
      wood: p.wood,
      pop: populationOf(state, p.id),
      pop_capacity: p.popCapacity,
    })),
    units: byId(state.units).map((u) => ({
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
    map: { width: state.mapWidth, depth: state.mapDepth, terrain: state.terrain.map((t) => ({ x: t.x, z: t.z, w: t.w, h: t.h })) },
    rules: {
      max_population: BALANCE.maxPopulation,
      queue_limit: BALANCE.economy.queueLimit,
      house_housing: BALANCE.buildings.house.housing,
      unit_cost: {
        villager: { ...BALANCE.units.villager.cost },
        soldier: { ...BALANCE.units.soldier.cost },
        archer: { ...BALANCE.units.archer.cost },
      },
      building_cost: { house: { ...BALANCE.buildings.house.cost }, barracks: { ...BALANCE.buildings.barracks.cost } },
      footprint: {
        townCenter: BALANCE.buildings.townCenter.footprint,
        house: BALANCE.buildings.house.footprint,
        barracks: BALANCE.buildings.barracks.footprint,
      },
    },
    previous_results: ctx.previousResults,
  };
}
