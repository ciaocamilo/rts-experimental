import { BALANCE, type UnitKind } from "../content/balance";
import { BATTLE_LAYOUT } from "../content/map";
import { createEmptyState, capacityOf, makeUnit } from "./state";
import type { EntityId, GameState, PlayerId, Unit } from "./types";

/** Modo batalla: sin edificios, nodos ni recursos; cada bando empieza en su formación, inactivo y sin objetivo. */
export function createBattleState(seed: number): GameState {
  const state = createEmptyState(seed, BATTLE_LAYOUT.width, BATTLE_LAYOUT.depth, "battle");
  state.terrain = BATTLE_LAYOUT.terrain.map((t) => ({ ...t }));
  for (const owner of [0, 1] as const satisfies readonly PlayerId[]) {
    for (const slot of BATTLE_LAYOUT.armies[owner]) {
      state.units.push(makeUnit(state.nextEntityId++, owner, slot.kind, slot.x, slot.z, "male", "battle"));
    }
    state.players[owner].food = 0;
    state.players[owner].wood = 0;
    state.players[owner].stone = 0;
    state.players[owner].popCapacity = capacityOf(state, owner);
  }
  state.obstacleVersion += 1;
  return state;
}

/** Unidades vivas por tipo de un bando. */
export function armyCounts(state: GameState, owner: PlayerId): Record<UnitKind, number> {
  const counts = { villager: 0, soldier: 0, archer: 0, knight: 0, cannon: 0, commander: 0 } satisfies Record<UnitKind, number>;
  for (const u of state.units) if (u.owner === owner && u.hp > 0) counts[u.kind] += 1;
  return counts;
}

/** Ids de las unidades de `viewer` que el rival ve: dentro del radio de visión de alguna unidad viva del rival. */
export function unitsSeenByEnemy(state: GameState, viewer: PlayerId): Set<EntityId> {
  return visibleSet(state, viewer === 0 ? 1 : 0, viewer);
}

/** Unidades del rival que `viewer` ve: dentro del radio de visión de alguna unidad propia viva. */
export function visibleEnemies(state: GameState, viewer: PlayerId): Unit[] {
  const seen = visibleSet(state, viewer, viewer === 0 ? 1 : 0);
  return state.units.filter((u) => seen.has(u.id));
}

export interface VisionSource {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

/** Radio de visión de una unidad: el comandante ve mucho más lejos que el resto. */
export function visionRadiusOf(kind: UnitKind): number {
  return kind === "commander" ? BALANCE.battle.commanderVisionRadius : BALANCE.battle.visionRadius;
}

/** Fuentes de visión (posición y radio) de las unidades vivas de `owner`. */
export function visionSources(state: GameState, owner: PlayerId): VisionSource[] {
  const out: VisionSource[] = [];
  for (const u of state.units) if (u.owner === owner && u.hp > 0) out.push({ x: u.pos.x, z: u.pos.z, r: visionRadiusOf(u.kind) });
  return out;
}

/** Ids de las unidades de `target` visibles para `observer`. */
function visibleSet(state: GameState, observer: PlayerId, target: PlayerId): Set<EntityId> {
  const own = visionSources(state, observer);
  const seen = new Set<EntityId>();
  for (const e of state.units) {
    if (e.owner !== target || e.hp <= 0) continue;
    for (const o of own) {
      const dx = e.pos.x - o.x;
      const dz = e.pos.z - o.z;
      if (dx * dx + dz * dz <= o.r * o.r) {
        seen.add(e.id);
        break;
      }
    }
  }
  return seen;
}
