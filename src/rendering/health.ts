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
