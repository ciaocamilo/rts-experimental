import { BALANCE } from "../content/balance";
import { DIRS } from "../navigation/grid";
import { getGrid } from "./obstacles";
import type { GameState } from "./types";

/** §4.1: ambas bases y todos los recursos iniciales deben ser alcanzables entre sí. */
export function validateInitialReachability(state: GameState): void {
  const { grid } = getGrid(state);
  const componentsAround = (x: number, z: number, w: number): Set<number> => {
    const found = new Set<number>();
    for (let i = -1; i <= w; i++) {
      for (let j = -1; j <= w; j++) {
        const inside = i >= 0 && j >= 0 && i < w && j < w;
        if (!inside && grid.componentAt(x + i, z + j) >= 0) found.add(grid.componentAt(x + i, z + j));
      }
    }
    return found;
  };

  const centers = state.buildings.filter((b) => b.kind === "townCenter");
  const baseComps = centers.map((b) => componentsAround(b.cell.x, b.cell.z, BALANCE.buildings.townCenter.footprint));
  const shared = [...(baseComps[0] ?? [])].filter((c) => baseComps.every((s) => s.has(c)));
  if (shared.length === 0) throw new Error("Mapa inválido: las bases no están conectadas");

  for (const node of state.resourceNodes) {
    const reachable = DIRS.some(([dx, dz]) => shared.includes(grid.componentAt(node.cell.x + dx, node.cell.z + dz)));
    if (!reachable) throw new Error(`Mapa inválido: nodo ${node.id} inalcanzable`);
  }
}
