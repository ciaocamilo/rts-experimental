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
      ? "se agotó el tiempo de la partida"
      : outcome.winner === null
        ? "ambos centros urbanos cayeron a la vez"
        : outcome.winner === perspective
          ? "el centro urbano rival fue destruido"
          : "su centro urbano fue destruido";
  return { title, reason };
}
