// Parámetros iniciales; los valores definitivos salen de los experimentos de P0-B (§6).
export const PATH_BUDGET_PER_TICK = 25;
export const STUCK_TICKS = 20;
export const MAX_REPATHS = 3;
/** Radio de holgura usado para suavizar rutas; ligeramente superior al radio lógico (0,3). */
export const PATH_CLEARANCE = 0.35;
/** Ventana de búsqueda de línea de visión al suavizar. */
export const SMOOTH_LOOKAHEAD = 16;
