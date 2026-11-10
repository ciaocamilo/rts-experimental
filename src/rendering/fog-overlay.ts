import * as THREE from "three";
import type { VisionMap } from "../core/vision";

/** Altura del velo sobre el suelo: por encima de montañas y copas; con cámara ortográfica se compensa el desplazamiento. */
const VEIL_HEIGHT = 14;
const CAMERA_SLOPE = 60 / 70;
const TINT = [6, 9, 18] as const;

/**
 * Velo de niebla: un plano con la oscuridad de `VisionMap` como alfa, dibujado sobre toda la escena. Como la cámara es
 * ortográfica y fija, desplazar el plano a lo largo del rayo de visión hace que cada texel caiga sobre su punto del suelo.
 */
export class FogOverlay {
  readonly mesh: THREE.Mesh;
  private readonly texture: THREE.DataTexture;
  private readonly data: Uint8Array;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly geometry: THREE.PlaneGeometry;
  private shownVersion = -1;

  constructor(private readonly vision: VisionMap) {
    const { cols, rows } = vision;
    this.data = new Uint8Array(cols * rows * 4);
    for (let n = 0; n < cols * rows; n++) this.data.set([TINT[0], TINT[1], TINT[2], 255], n * 4);
    this.texture = new THREE.DataTexture(this.data, cols, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    this.geometry = new THREE.PlaneGeometry(vision.width, vision.depth).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.set(vision.width / 2 + VEIL_HEIGHT * CAMERA_SLOPE, VEIL_HEIGHT, vision.depth / 2 + VEIL_HEIGHT * CAMERA_SLOPE);
    this.mesh.renderOrder = 1000;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = (): void => undefined;
    this.mesh.visible = false;
  }

  /** Refresca la textura si la visión cambió y muestra u oculta el velo. */
  sync(active: boolean): void {
    this.mesh.visible = active;
    if (!active || this.shownVersion === this.vision.version) return;
    this.shownVersion = this.vision.version;
    const { cols, rows } = this.vision;
    // La fila 0 de la textura queda en el borde de mayor z del plano rotado.
    for (let j = 0; j < rows; j++) {
      const row = rows - 1 - j;
      for (let i = 0; i < cols; i++) this.data[(row * cols + i) * 4 + 3] = Math.round(this.vision.shade(i, j) * 255);
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }
}
