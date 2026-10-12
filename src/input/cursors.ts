import type { Building, EntityId, GameState, PlayerId, ResourceNode, Unit } from "../core/types";
import type { Selection } from "./selection";

export type RightClickAction =
  | { kind: "gather"; node: ResourceNode }
  | { kind: "resume"; site: Building }
  | { kind: "attack"; target: Unit | Building };

export type CursorKind = "chop" | "forage" | "mine" | "attack";

export interface SelectionCaps {
  villagers: boolean;
  military: boolean;
}

/**
 * Qué hace el clic derecho sobre lo que hay bajo el puntero (`hits`, de la más cercana a la más lejana).
 * Lo comparten la orden real y el cursor, para que no puedan discrepar; las unidades propias que tapan se ignoran.
 */
export function resolveRightClick(state: GameState, hits: readonly EntityId[], player: PlayerId): RightClickAction | null {
  for (const hit of hits) {
    const node = state.resourceNodes.find((n) => n.id === hit);
    if (node) return { kind: "gather", node };
    const site = state.buildings.find((b) => b.id === hit && b.owner === player && !b.complete);
    if (site) return { kind: "resume", site };
    const foe = [...state.units, ...state.buildings].find((x) => x.id === hit && x.owner !== player);
    if (foe) return { kind: "attack", target: foe };
  }
  return null;
}

export function selectionCaps(state: GameState, selection: Selection, player: PlayerId): SelectionCaps {
  const caps = { villagers: false, military: false };
  if (selection.units.size === 0) return caps;
  for (const u of state.units) {
    if (u.owner !== player || !selection.units.has(u.id)) continue;
    if (u.kind === "villager") caps.villagers = true;
    else caps.military = true;
    if (caps.villagers && caps.military) break;
  }
  return caps;
}

const GATHER_CURSOR = { wood: "chop", food: "forage", stone: "mine" } as const;

/** Cursor de acción solo si la orden serviría a la selección actual; null deja el cursor normal. */
export function cursorFor(action: RightClickAction | null, caps: SelectionCaps): CursorKind | null {
  if (!action) return null;
  if (action.kind === "gather") return caps.villagers && action.node.remaining > 0 ? GATHER_CURSOR[action.node.kind] : null;
  if (action.kind === "attack") return caps.military && action.target.hp > 0 ? "attack" : null;
  return null;
}

interface Shape {
  /** Trazado SVG (`path`). */
  d: string;
  fill: string;
  stroke?: string;
  width?: number;
}

export const CURSOR_SIZE = 32;

/** Punto activo de cada cursor (el que elige el objetivo), dentro de la imagen de 32 × 32. */
export const CURSOR_HOTSPOT: Readonly<Record<CursorKind, { x: number; y: number }>> = {
  chop: { x: 6, y: 6 },
  forage: { x: 16, y: 16 },
  mine: { x: 6, y: 6 },
  attack: { x: 4, y: 4 },
};

const CURSOR_FALLBACK: Readonly<Record<CursorKind, string>> = { chop: "pointer", forage: "pointer", mine: "pointer", attack: "crosshair" };

const SHAPES: Readonly<Record<CursorKind, readonly Shape[]>> = {
  chop: [
    { d: "M12 12L27 27", fill: "none", stroke: "#8a5a2b", width: 4 },
    { d: "M4 4H14L20 9V16L14 12L9 15Z", fill: "#c9d1d8", stroke: "#3a4047", width: 1.5 },
  ],
  forage: [
    { d: "M9 13Q15 2 23 13", fill: "none", stroke: "#5a3a16", width: 2 },
    { d: "M6 13H26L23 27H9Z", fill: "#c98f4a", stroke: "#5a3a16", width: 1.5 },
    { d: "M10 13a2.6 2.6 0 1 0 .1 0M16 11a2.6 2.6 0 1 0 .1 0M21 13a2.6 2.6 0 1 0 .1 0", fill: "#d23a3a", stroke: "#6e1414", width: 1 },
  ],
  mine: [
    { d: "M9 9L27 27", fill: "none", stroke: "#8a5a2b", width: 4 },
    { d: "M3 17Q5 5 17 3", fill: "none", stroke: "#aeb7bf", width: 4 },
  ],
  attack: [
    { d: "M23 23L28 28", fill: "none", stroke: "#8a5a2b", width: 3.5 },
    { d: "M15 25L25 15", fill: "none", stroke: "#d9b45a", width: 3 },
    { d: "M4 4L8 5L22 19L19 22L5 8Z", fill: "#e3e8ec", stroke: "#3a4047", width: 1.5 },
  ],
};

function pathOf(shape: Shape, halo: boolean): string {
  const width = shape.width ?? 0;
  if (halo) return `<path d='${shape.d}' fill='${shape.fill === "none" ? "none" : "#fff"}' stroke='#fff' stroke-width='${width + 3}'/>`;
  const stroke = shape.stroke ? ` stroke='${shape.stroke}' stroke-width='${width}'` : "";
  return `<path d='${shape.d}' fill='${shape.fill}'${stroke}/>`;
}

/** SVG del cursor: contorno claro y relleno propio para verse sobre hierba, agua y roca. Con `width` y `height` explícitos (Chromium). */
export function cursorSvg(kind: CursorKind): string {
  const shapes = SHAPES[kind];
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${CURSOR_SIZE}' height='${CURSOR_SIZE}' viewBox='0 0 ${CURSOR_SIZE} ${CURSOR_SIZE}' stroke-linecap='round' stroke-linejoin='round'>` +
    `${shapes.map((s) => pathOf(s, true)).join("")}${shapes.map((s) => pathOf(s, false)).join("")}</svg>`
  );
}

/** Valor de la propiedad CSS `cursor`; la reserva se usa si el navegador no acepta la imagen. */
export function cursorCss(kind: CursorKind): string {
  const { x, y } = CURSOR_HOTSPOT[kind];
  return `url("data:image/svg+xml,${encodeURIComponent(cursorSvg(kind))}") ${x} ${y}, ${CURSOR_FALLBACK[kind]}`;
}
