import { visionSources } from "./battle";
import type { GameState, PlayerId } from "./types";

/** Texels por celda del campo de niebla. */
export const FOG_RES = 2;
/** Anchura (celdas) del borde suave de cada círculo de visión. */
const SOFT_EDGE = 2.5;
/** Oscuridad de lo nunca visto y de lo ya explorado pero fuera de la vista actual (0 = claro, 1 = negro). */
export const FOG_UNSEEN = 0.92;
export const FOG_EXPLORED = 0.5;

/**
 * Niebla de guerra del jugador (P10-R16): lo visto ahora se muestra claro, lo explorado se recuerda atenuado y
 * lo demás queda oscuro. Es solo presentación: la lógica de visibilidad vive en `battle.ts` (mismos radios).
 */
export class VisionMap {
  readonly cols: number;
  readonly rows: number;
  /** Visión actual por texel, en [0, 1]. */
  private readonly seen: Float32Array;
  private readonly explored: Float32Array;
  /** Aumenta con cada recálculo; permite a los consumidores saber si deben refrescar su textura. */
  version = 0;

  constructor(readonly width: number, readonly depth: number, readonly player: PlayerId = 0) {
    this.cols = width * FOG_RES;
    this.rows = depth * FOG_RES;
    this.seen = new Float32Array(this.cols * this.rows);
    this.explored = new Float32Array(this.cols * this.rows);
  }

  /** Vuelve a la oscuridad total (partida nueva). */
  reset(): void {
    this.seen.fill(0);
    this.explored.fill(0);
    this.version += 1;
  }

  /** Recalcula la visión actual a partir de las unidades vivas del jugador y acumula lo explorado. */
  update(state: GameState): void {
    this.seen.fill(0);
    for (const s of visionSources(state, this.player)) {
      const x0 = Math.max(0, Math.floor((s.x - s.r) * FOG_RES));
      const x1 = Math.min(this.cols - 1, Math.ceil((s.x + s.r) * FOG_RES));
      const z0 = Math.max(0, Math.floor((s.z - s.r) * FOG_RES));
      const z1 = Math.min(this.rows - 1, Math.ceil((s.z + s.r) * FOG_RES));
      for (let j = z0; j <= z1; j++) {
        const dz = (j + 0.5) / FOG_RES - s.z;
        for (let i = x0; i <= x1; i++) {
          const dx = (i + 0.5) / FOG_RES - s.x;
          const k = Math.min(1, Math.max(0, (s.r - Math.hypot(dx, dz)) / SOFT_EDGE));
          const idx = j * this.cols + i;
          if (k > this.seen[idx]!) this.seen[idx] = k;
        }
      }
    }
    for (let n = 0; n < this.seen.length; n++) if (this.seen[n]! > this.explored[n]!) this.explored[n] = this.seen[n]!;
    this.version += 1;
  }

  /** Oscuridad (0 claro, 1 negro) del texel (i, j), con i hacia +x y j hacia +z. */
  shade(i: number, j: number): number {
    const idx = j * this.cols + i;
    const e = this.explored[idx]!;
    const base = FOG_UNSEEN + (FOG_EXPLORED - FOG_UNSEEN) * e;
    return base * (1 - this.seen[idx]!);
  }

  /** Oscuridad en un punto del mapa (celdas). */
  shadeAt(x: number, z: number): number {
    const i = Math.min(this.cols - 1, Math.max(0, Math.floor(x * FOG_RES)));
    const j = Math.min(this.rows - 1, Math.max(0, Math.floor(z * FOG_RES)));
    return this.shade(i, j);
  }
}
