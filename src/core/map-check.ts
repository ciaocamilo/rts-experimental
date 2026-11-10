import { BALANCE } from "../content/balance";
import { DIRS, NavGrid } from "../navigation/grid";
import { getGrid } from "./obstacles";
import type { GameState } from "./types";

/** Batalla: ninguna unidad nace encerrada, los ejércitos se alcanzan y siguen alcanzándose aunque cierre cualquier cruce. */
export function validateBattleReachability(state: GameState): void {
  const { grid } = getGrid(state);
  const cellOf = (u: { pos: { x: number; z: number } }): number => grid.componentAt(Math.floor(u.pos.x), Math.floor(u.pos.z));
  const reference = state.units[0] ? cellOf(state.units[0]) : -1;
  for (const u of state.units) {
    if (cellOf(u) < 0 || cellOf(u) !== reference) throw new Error(`Mapa inválido: la unidad ${u.id} no alcanza al rival`);
  }
  const crossings = state.terrain.filter((t) => t.kind === "bridge");
  const a = state.units.find((u) => u.owner === 0);
  const b = state.units.find((u) => u.owner === 1);
  if (!a || !b) return;
  for (const closed of crossings) {
    const probe = new NavGrid(state.mapWidth, state.mapDepth);
    for (const t of state.terrain) if (t.kind !== "bridge" && t.kind !== "valley") probe.blockRect(t.x, t.z, t.w, t.h);
    probe.blockRect(closed.x, closed.z, closed.w, closed.h);
    probe.label();
    const ca = probe.componentAt(Math.floor(a.pos.x), Math.floor(a.pos.z));
    if (ca < 0 || ca !== probe.componentAt(Math.floor(b.pos.x), Math.floor(b.pos.z))) {
      throw new Error("Mapa inválido: un único cruce comunica a los ejércitos");
    }
  }
}

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
