import { BALANCE, type UnitKind } from "../content/balance";
import { activityOf, type Activity } from "../core/economy";
import type { EntityId, Gender, GameState, PlayerId } from "../core/types";

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

const RESOURCE_NAME = { food: "comida", wood: "madera", stone: "piedra" } as const;

export type Side = "player" | "enemy" | "nature";

export const SIDE_LABEL: Record<Side, string> = { player: "JUGADOR", enemy: "ENEMIGO", nature: "NATURALEZA" };

const UNIT_LABEL = { villager: "Aldeano", soldier: "Soldado", archer: "Arquero" } as const;
const BUILDING_LABEL = { townCenter: "Centro urbano", house: "Casa", barracks: "Cuartel", tower: "Torre" } as const;
const NODE_LABEL = { food: "Arbusto", wood: "Árbol", stone: "Roca" } as const;

/** Ficha de una entidad para el retrato: texto en español y valores de las barras, sin tocar el estado. */
export interface SelectionInfo {
  id: EntityId;
  /** Tipo de entidad: "unit", "building" o "node". */
  type: "unit" | "building" | "node";
  /** Variante del modelo: rol, tipo de edificio o recurso. */
  kind: string;
  /** Aldeana o aldeano (solo unidades); cambia el retrato y el nombre. */
  gender: Gender | null;
  name: string;
  side: Side;
  sideLabel: string;
  /** Vida o cantidad restante, y su máximo. */
  value: number;
  max: number;
  ratio: number;
  barLabel: string;
  /** "life" colorea por umbral de vida; "resource" usa un único tono. */
  barKind: "life" | "resource";
  /** Avance de una obra en [0, 1], o null si no es una obra. */
  progress: number | null;
  /** Líneas de detalle sin repetir el nombre. */
  lines: string[];
  /** Ataque y alcance (este solo si no es cuerpo a cuerpo), o null si la entidad no ataca. */
  combat: CombatStats | null;
  /** Clave del aspecto del modelo; cambia solo cuando el retrato debe redibujarse. */
  aspectKey: string;
  owner: PlayerId | null;
}

function sideOf(owner: PlayerId, player: PlayerId): Side {
  return owner === player ? "player" : "enemy";
}

export function describeSelection(state: GameState, id: EntityId, player: PlayerId = 0): SelectionInfo | null {
  const u = state.units.find((x) => x.id === id);
  if (u) {
    const max = BALANCE.units[u.kind].hp;
    const side = sideOf(u.owner, player);
    const activity = ACTIVITY_TEXT[activityOf(u)];
    const carry = u.carry ? ` · carga ${u.carry.amount} de ${RESOURCE_NAME[u.carry.kind]}` : "";
    const lines = [activity.charAt(0).toUpperCase() + activity.slice(1) + carry];
    return {
      id, type: "unit", kind: u.kind, gender: u.gender, name: u.kind === "villager" && u.gender === "female" ? "Aldeana" : UNIT_LABEL[u.kind], side, sideLabel: SIDE_LABEL[side],
      value: u.hp, max, ratio: ratioOf(u.hp, max), barLabel: `Vida ${u.hp} / ${max}`, barKind: "life", progress: null,
      lines, combat: combatStats(u.kind), aspectKey: `unit:${u.kind}:${u.owner}:${u.gender}`, owner: u.owner,
    };
  }
  const b = state.buildings.find((x) => x.id === id);
  if (b) {
    const def = BALANCE.buildings[b.kind];
    const side = sideOf(b.owner, player);
    const progress = b.complete || def.buildTicks <= 0 ? null : Math.min(1, Math.max(0, b.buildDone / def.buildTicks));
    const lines: string[] = [];
    if (progress !== null) lines.push(`En obra ${Math.floor(progress * 100)} %`);
    else if (def.housing > 0) lines.push(`Aloja ${def.housing} unidades`);
    if (b.queue.length > 0) lines.push(`Cola ${b.queue.length}/${BALANCE.economy.queueLimit}`);
    return {
      id, type: "building", kind: b.kind, gender: null, name: BUILDING_LABEL[b.kind], side, sideLabel: SIDE_LABEL[side],
      value: b.hp, max: def.hp, ratio: ratioOf(b.hp, def.hp), barLabel: `Vida ${b.hp} / ${def.hp}`, barKind: "life", progress,
      lines, combat: def.weapon !== null && progress === null ? combatStats(def.weapon, def.arrows ?? 1) : null,
      aspectKey: `building:${b.kind}:${b.owner}:${progress === null ? "done" : Math.floor(progress * 20)}`, owner: b.owner,
    };
  }
  const n = state.resourceNodes.find((x) => x.id === id);
  if (n) {
    const max = BALANCE.nodeAmount;
    const spent = n.remaining <= 0;
    return {
      id, type: "node", kind: n.kind, gender: null, name: NODE_LABEL[n.kind], side: "nature", sideLabel: SIDE_LABEL.nature,
      value: n.remaining, max, ratio: ratioOf(n.remaining, max), barLabel: spent ? "Agotado" : `Restante ${n.remaining} / ${max}`, barKind: "resource", progress: null,
      lines: [`Da ${RESOURCE_NAME[n.kind]}`], combat: null, aspectKey: `node:${n.kind}:${n.kind === "wood" ? n.id % 3 : 0}:${spent ? "spent" : "full"}`, owner: null,
    };
  }
  return null;
}

/** Ataque total por disparo y alcance en celdas; `range` es null en el cuerpo a cuerpo. */
export interface CombatStats {
  attack: number;
  range: number | null;
}

/** Ataque (daño × `arrows` flechas) y alcance del arma de una unidad; null si no hace daño. */
export function combatStats(kind: UnitKind, arrows = 1): CombatStats | null {
  const def = BALANCE.units[kind];
  if (def.damage <= 0) return null;
  return { attack: def.damage * arrows, range: def.range > 1 ? def.range : null };
}

/** Texto para lectores de pantalla y descripciones: "Ataque 8, alcance 5". */
export function combatLabel(c: CombatStats): string {
  return c.range === null ? `Ataque ${c.attack}` : `Ataque ${c.attack}, alcance ${num(c.range)}`;
}

const num = (n: number): string => String(n).replace(".", ",");

function ratioOf(value: number, max: number): number {
  return Number.isFinite(max) && max > 0 && Number.isFinite(value) ? Math.min(1, Math.max(0, value / max)) : 0;
}

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
