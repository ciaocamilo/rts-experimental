export interface BarState {
  visible: boolean;
  /** Proporción de relleno, `clamp(hp / max, 0, 1)`. */
  ratio: number;
  /** `max` no es válido: se oculta la barra y quien llama debe registrar el diagnóstico. */
  invalid: boolean;
}

/** Regla P2-H07: la barra existe si y solo si `0 < hp < max`. */
export function barState(hp: number, max: number): BarState {
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(hp)) return { visible: false, ratio: 0, invalid: true };
  return { visible: hp > 0 && hp < max, ratio: Math.min(1, Math.max(0, hp / max)), invalid: false };
}

/** Umbrales de vida (proporción) en los que aparece una llama más en un edificio (P2-H08). */
export const FLAME_THRESHOLDS = [0.9, 0.75, 0.5, 0.25, 0.05] as const;

/** Llamas visibles: una por cada umbral alcanzado (inclusivo). Las obras y los máximos inválidos no arden. */
export function flameCount(hp: number, max: number, complete: boolean): number {
  if (!complete || !Number.isFinite(max) || max <= 0 || !Number.isFinite(hp)) return 0;
  const ratio = hp / max;
  let count = 0;
  for (const threshold of FLAME_THRESHOLDS) if (ratio <= threshold + 1e-9) count++;
  return count;
}
