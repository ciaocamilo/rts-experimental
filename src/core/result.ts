import { MAX_ACTIVE_TICKS, TICKS_PER_SECOND } from "../content/balance";
import type { GameState, PlayerId } from "./types";

export type MatchResultLabel = "victoria" | "derrota" | "empate" | "en curso";

/**
 * Resultado desde la perspectiva de `perspective`, derivado de `state.outcome`, que se fija en el mismo tick y con la misma
 * vida que retira el centro principal. La pantalla de fin y la evidencia exportada usan esta única función (P3-H08).
 */
export function matchResult(state: GameState, perspective: PlayerId = 0): MatchResultLabel {
  const outcome = state.outcome;
  if (state.matchStatus !== "ended" || !outcome) return "en curso";
  if (outcome.winner === null) return "empate";
  return outcome.winner === perspective ? "victoria" : "derrota";
}

/** Texto del motivo del fin de partida, compartido por la pantalla y la evidencia. */
export function describeEnd(state: GameState, perspective: PlayerId = 0): { title: string; reason: string } | null {
  const outcome = state.outcome;
  if (!outcome) return null;
  const label = matchResult(state, perspective);
  const title = label === "empate" ? "Empate" : label === "victoria" ? "Victoria" : "Derrota";
  const reason =
    outcome.reason === "TIME_LIMIT"
      ? `tras ${Math.round(MAX_ACTIVE_TICKS / TICKS_PER_SECOND / 60)} minutos ningún centro urbano cayó`
      : outcome.winner === null
        ? "ambos centros urbanos cayeron a la vez"
        : outcome.winner === perspective
          ? "el centro urbano rival fue destruido"
          : "su centro urbano fue destruido";
  return { title, reason };
}

/** Duración activa de la partida como `mm:ss`. */
export function formatDuration(ticks: number): string {
  const total = Math.max(0, Math.floor(ticks / TICKS_PER_SECOND));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export interface EndSummary {
  label: MatchResultLabel;
  title: string;
  reason: string;
  duration: string;
  ownLosses: { units: number; buildings: number };
  rivalLosses: { units: number; buildings: number };
  /** Estado final de cada centro urbano, desde la perspectiva indicada. */
  centers: { own: string; rival: string };
}

/** Datos de la ventana de fin de partida; todo sale del estado, nada se recalcula aparte. */
export function endSummary(state: GameState, perspective: PlayerId = 0): EndSummary | null {
  const outcome = state.outcome;
  const end = describeEnd(state, perspective);
  if (!outcome || !end) return null;
  const rival = perspective === 0 ? 1 : 0;
  const center = (owner: PlayerId): string => {
    const b = outcome.mainBuildings.find((x) => x.owner === owner);
    return !b ? "sin datos" : b.destroyed ? "destruido" : `en pie (vida ${b.hp}/${b.maxHp})`;
  };
  return {
    label: matchResult(state, perspective),
    ...end,
    duration: formatDuration(outcome.endTick),
    ownLosses: { units: outcome.casualties.units[perspective], buildings: outcome.casualties.buildings[perspective] },
    rivalLosses: { units: outcome.casualties.units[rival], buildings: outcome.casualties.buildings[rival] },
    centers: { own: center(perspective), rival: center(rival) },
  };
}
