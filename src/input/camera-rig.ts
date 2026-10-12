export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 7;
/** Zoom con que arranca la partida normal: encuadra la ciudad del jugador. */
export const INITIAL_ZOOM = 3;
const PAN_SPEED = 30; // celdas/s con zoom 1

export interface PanKeys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/** Distancia al borde de la vista (px) a partir de la cual el cursor desplaza la cámara. */
export const EDGE_MARGIN_PX = 24;

/** Multiplicador de velocidad del desplazamiento por borde respecto al teclado. */
export const EDGE_SPEED_FACTOR = 1.5;

/**
 * Direcciones de desplazamiento para un cursor en (x, y) dentro de una vista de width por height.
 * `screenHeight` es el alto hasta el borde inferior de la pantalla (mayor que `height` si hay una barra debajo): el desplazamiento hacia abajo se mide contra él.
 */
export function edgePan(x: number, y: number, width: number, height: number, margin: number = EDGE_MARGIN_PX, screenHeight: number = height): PanKeys {
  if (x < 0 || y < 0 || x > width || y > screenHeight) return { up: false, down: false, left: false, right: false };
  return { up: y <= margin, down: y >= screenHeight - margin, left: x <= margin, right: x >= width - margin };
}

/** Estado de cámara sobre el plano XZ; la cámara no abandona el mapa (RF-02). */
export class CameraRig {
  x: number;
  z: number;
  zoom = 1;

  constructor(readonly mapWidth: number, readonly mapDepth: number = mapWidth, start?: { x: number; z: number; zoom?: number }) {
    this.x = start?.x ?? mapWidth / 2;
    this.z = start?.z ?? mapDepth / 2;
    if (start?.zoom !== undefined) this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, start.zoom));
  }

  /** Vuelve a una vista concreta (posición y zoom), limitada al mapa. */
  reset(view: { x: number; z: number; zoom?: number }): void {
    this.x = view.x;
    this.z = view.z;
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom ?? 1));
    this.clamp();
  }

  /** La vista mira hacia -x,-z: «arriba» en pantalla es (-1,-1) y «derecha» es (1,-1). */
  pan(dtSec: number, keys: PanKeys, speedFactor = 1): void {
    const forward = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    const right = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (forward === 0 && right === 0) return;
    const k = ((PAN_SPEED * speedFactor) / this.zoom) * dtSec * Math.SQRT1_2;
    const len = Math.hypot(forward, right);
    this.x += ((-forward + right) * k) / len;
    this.z += ((-forward - right) * k) / len;
    this.clamp();
  }

  zoomBy(wheelDeltaY: number): void {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoom * Math.exp(-wheelDeltaY * 0.001)));
  }

  /** Centra la cámara en un punto del mapa (limitado al mapa). */
  centerOn(x: number, z: number): void {
    this.x = x;
    this.z = z;
    this.clamp();
  }

  clamp(): void {
    this.x = Math.min(this.mapWidth, Math.max(0, this.x));
    this.z = Math.min(this.mapDepth, Math.max(0, this.z));
  }
}
