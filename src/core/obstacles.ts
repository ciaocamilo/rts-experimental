import { BALANCE } from "../content/balance";
import { NavGrid } from "../navigation/grid";
import type { GameState } from "./types";

interface CacheEntry {
  version: number;
  grid: NavGrid;
  /** Última versión comunicada a la simulación mediante `getGrid`. */
  announced: number | null;
}

const cache = new WeakMap<GameState, CacheEntry>();

function build(state: GameState): NavGrid {
  const grid = new NavGrid(state.mapWidth, state.mapDepth);
  for (const t of state.terrain) grid.blockRect(t.x, t.z, t.w, t.h);
  for (const b of state.buildings) {
    const w = BALANCE.buildings[b.kind].footprint;
    grid.blockRect(b.cell.x, b.cell.z, w);
  }
  for (const n of state.resourceNodes) {
    if (n.remaining > 0) grid.blockRect(n.cell.x, n.cell.z, 1);
  }
  grid.label();
  return grid;
}

function ensure(state: GameState): CacheEntry {
  const entry = cache.get(state);
  if (entry && entry.version === state.obstacleVersion) return entry;
  const fresh: CacheEntry = { version: state.obstacleVersion, grid: build(state), announced: entry?.announced ?? null };
  cache.set(state, fresh);
  return fresh;
}

/** Cuadrícula actual para consultas de solo lectura (UI, validación); no altera `changed`. */
export function currentGrid(state: GameState): NavGrid {
  return ensure(state).grid;
}

/** Cuadrícula para la simulación; `changed` indica que cambió desde la última llamada. */
export function getGrid(state: GameState): { grid: NavGrid; changed: boolean } {
  const entry = ensure(state);
  const changed = entry.announced !== null && entry.announced !== entry.version;
  entry.announced = entry.version;
  return { grid: entry.grid, changed };
}
