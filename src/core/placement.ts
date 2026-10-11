import { BALANCE, type BuildingKind } from "../content/balance";
import { NavGrid } from "../navigation/grid";
import { buildingRect, circleOverlapsRect, nodeRect, rectsOverlap, type CellRect } from "./spatial";
import type { GameState, PlayerId, RejectCode } from "./types";

function footprintOf(kind: BuildingKind, x: number, z: number): CellRect {
  const w = BALANCE.buildings[kind].footprint;
  return { x, z, w, h: w };
}

/** La huella cabe en el mapa y no solapa terreno, edificios u obras, nodos vivos ni unidades. */
export function footprintFree(state: GameState, kind: BuildingKind, x: number, z: number): boolean {
  const rect = footprintOf(kind, x, z);
  if (rect.x < 0 || rect.z < 0 || rect.x + rect.w > state.mapWidth || rect.z + rect.h > state.mapDepth) return false;
  if (state.terrain.some((t) => rectsOverlap(rect, t))) return false;
  if (state.buildings.some((b) => rectsOverlap(rect, buildingRect(b)))) return false;
  if (state.resourceNodes.some((n) => n.remaining > 0 && rectsOverlap(rect, nodeRect(n)))) return false;
  return !state.units.some((u) => circleOverlapsRect(u.pos.x, u.pos.z, BALANCE.units[u.kind].radius, rect));
}

function anchorCell(grid: NavGrid, state: GameState, owner: PlayerId): { x: number; z: number } | null {
  const tc = state.buildings.find((b) => b.owner === owner && b.kind === "townCenter");
  if (!tc) return null;
  const rect = buildingRect(tc);
  return grid.nearestFree(Math.floor(rect.x + rect.w / 2), Math.floor(rect.z + rect.h / 2));
}

/**
 * Una obra no puede cortar el camino entre las bases ni dejar encerrada una unidad que
 * antes estaba en la región principal (§4.3).
 */
export function wouldBlockPath(state: GameState, grid: NavGrid, kind: BuildingKind, x: number, z: number): boolean {
  const test = new NavGrid(grid.width, grid.depth);
  test.blocked.set(grid.blocked);
  const rect = footprintOf(kind, x, z);
  test.blockRect(rect.x, rect.z, rect.w, rect.h);
  test.label();

  const a0 = anchorCell(grid, state, 0);
  const a1 = anchorCell(grid, state, 1);
  const t0 = anchorCell(test, state, 0);
  const t1 = anchorCell(test, state, 1);
  if (!a0 || !a1) return false;
  if (!t0 || !t1) return true;

  const main = grid.componentAt(a0.x, a0.z);
  const wasConnected = main === grid.componentAt(a1.x, a1.z);
  const mainAfter = test.componentAt(t0.x, t0.z);
  if (wasConnected && mainAfter !== test.componentAt(t1.x, t1.z)) return true;

  for (const u of state.units) {
    const cx = Math.floor(u.pos.x);
    const cz = Math.floor(u.pos.z);
    const before = grid.nearestFree(cx, cz);
    if (!before || grid.componentAt(before.x, before.z) !== main) continue;
    const after = test.nearestFree(cx, cz);
    if (!after || test.componentAt(after.x, after.z) !== mainAfter) return true;
  }
  return false;
}

/**
 * Validación de colocación sin efectos secundarios, compartida por la admisión de órdenes
 * y la previsualización de la UI. Devuelve `null` si la colocación es válida.
 */
export function previewPlacement(state: GameState, grid: NavGrid, player: PlayerId, kind: BuildingKind, x: number, z: number): RejectCode | null {
  const def = BALANCE.buildings[kind] as (typeof BALANCE.buildings)[BuildingKind] | undefined;
  if (!def || !def.constructible || !Number.isInteger(x) || !Number.isInteger(z)) return "INVALID_TARGET";
  if (!footprintFree(state, kind, x, z)) return "INVALID_PLACEMENT";
  const p = state.players[player];
  if (p.food < def.cost.food || p.wood < def.cost.wood) return "INSUFFICIENT_RESOURCES";
  if (wouldBlockPath(state, grid, kind, x, z)) return "BLOCKS_PATH";
  return null;
}
