export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 3;
const PAN_SPEED = 30; // celdas/s con zoom 1

export interface PanKeys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/** Estado de cámara sobre el plano XZ; la cámara no abandona el mapa (RF-02). */
export class CameraRig {
  x: number;
  z: number;
  zoom = 1;

  constructor(readonly mapWidth: number, readonly mapDepth: number = mapWidth, start?: { x: number; z: number }) {
    this.x = start?.x ?? mapWidth / 2;
    this.z = start?.z ?? mapDepth / 2;
  }

  /** La vista mira hacia -x,-z: «arriba» en pantalla es (-1,-1) y «derecha» es (1,-1). */
  pan(dtSec: number, keys: PanKeys): void {
    const forward = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    const right = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (forward === 0 && right === 0) return;
    const k = (PAN_SPEED / this.zoom) * dtSec * Math.SQRT1_2;
    const len = Math.hypot(forward, right);
    this.x += ((-forward + right) * k) / len;
    this.z += ((-forward - right) * k) / len;
    this.clamp();
  }

  zoomBy(wheelDeltaY: number): void {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoom * Math.exp(-wheelDeltaY * 0.001)));
  }

  clamp(): void {
    this.x = Math.min(this.mapWidth, Math.max(0, this.x));
    this.z = Math.min(this.mapDepth, Math.max(0, this.z));
  }
}
