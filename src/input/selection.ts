import { BALANCE } from "../content/balance";
import { activityOf, type Activity } from "../core/economy";
import type { EntityId, GameState, PlayerId } from "../core/types";

export interface Selection {
  /** Unidades propias seleccionadas; reciben órdenes. */
  units: Set<EntityId>;
  /** Entidad inspeccionada (enemiga, edificio o recurso); no recibe órdenes. */
  inspected: EntityId | null;
}

export function emptySelection(): Selection {
  return { units: new Set(), inspected: null };
}

function ownUnit(state: GameState, id: EntityId, player: PlayerId): boolean {
  return state.units.some((u) => u.id === id && u.owner === player);
}

export function clickSelect(sel: Selection, state: GameState, hit: EntityId | null, shift: boolean, player: PlayerId): void {
  if (hit === null) {
    if (!shift) {
      sel.units.clear();
      sel.inspected = null;
    }
    return;
  }
  if (ownUnit(state, hit, player)) {
    sel.inspected = null;
    if (!shift) sel.units = new Set([hit]);
    else if (sel.units.has(hit)) sel.units.delete(hit);
    else sel.units.add(hit);
    return;
  }
  if (shift) return;
  sel.units.clear();
  sel.inspected = hit;
}

export function boxSelect(sel: Selection, state: GameState, inside: readonly EntityId[], shift: boolean, player: PlayerId): void {
  const own = inside.filter((id) => ownUnit(state, id, player));
  sel.inspected = null;
  if (!shift) {
    sel.units = new Set(own);
    return;
  }
  for (const id of own) {
    if (sel.units.has(id)) sel.units.delete(id);
    else sel.units.add(id);
  }
}

export function clearSelection(sel: Selection): void {
  sel.units.clear();
  sel.inspected = null;
}

/** Retira de la selección entidades que ya no existen. */
export function pruneSelection(sel: Selection, state: GameState): void {
  const alive = new Set<EntityId>([...state.units, ...state.buildings, ...state.resourceNodes].map((e) => e.id));
  for (const id of sel.units) if (!alive.has(id)) sel.units.delete(id);
  if (sel.inspected !== null && !alive.has(sel.inspected)) sel.inspected = null;
}

const ACTIVITY_TEXT: Record<Activity, string> = {
  idle: "inactiva",
  moving: "moviéndose",
  blocked: "bloqueada",
  gathering: "recolectando",
  delivering: "entregando",
  building: "construyendo",
  attacking: "atacando",
};

const IDLE_REASON_TEXT = { TARGET_DEAD: "objetivo destruido", UNREACHABLE: "objetivo inalcanzable" } as const;

const RESOURCE_NAME = { food: "alimento", wood: "madera", stone: "piedra" } as const;

export function describeEntity(state: GameState, id: EntityId): string {
  const u = state.units.find((x) => x.id === id);
  if (u) {
    const carry = u.carry ? ` carga ${u.carry.amount} ${RESOURCE_NAME[u.carry.kind]}` : "";
    const defending = u.job?.type === "attack" && u.job.defense ? " (defendiéndose)" : "";
    const idle = u.idleReason && activityOf(u) === "idle" ? ` (${IDLE_REASON_TEXT[u.idleReason]})` : "";
    return `${u.kind} #${u.id} (jugador ${u.owner}) vida ${u.hp}/${BALANCE.units[u.kind].hp} ${ACTIVITY_TEXT[activityOf(u)]}${defending}${idle}${u.blockedReason ? ` [${u.blockedReason}]` : ""}${carry}`;
  }
  const b = state.buildings.find((x) => x.id === id);
  if (b) {
    const def = BALANCE.buildings[b.kind];
    const progress = b.complete ? "" : ` obra ${Math.floor((100 * b.buildDone) / def.buildTicks)} %`;
    const queue = b.queue.length > 0 ? ` cola ${b.queue.length}/${BALANCE.economy.queueLimit}` : "";
    return `${b.kind} #${b.id} (jugador ${b.owner}) vida ${b.hp}/${def.hp}${progress}${queue}`;
  }
  const n = state.resourceNodes.find((x) => x.id === id);
  if (n) return `nodo ${n.kind} #${n.id} restante ${n.remaining}`;
  return `#${id}`;
}
