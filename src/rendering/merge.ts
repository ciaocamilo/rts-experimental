import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type Triple = readonly [number, number, number];

export interface Part {
  geometry: THREE.BufferGeometry;
  position?: Triple;
  rotation?: Triple;
  /** Color sRGB que se hornea como color de vértice; omitido cuando se agrupa por material. */
  color?: number;
}

const matrix = new THREE.Matrix4();
const euler = new THREE.Euler();
const quat = new THREE.Quaternion();
const pos = new THREE.Vector3();
const unit = new THREE.Vector3(1, 1, 1);

/**
 * Funde varias piezas en una sola geometría. Reduce las llamadas de dibujo: un personaje o un
 * edificio pasan de decenas de mallas a unas pocas sin cambiar su aspecto.
 */
export function mergeParts(parts: readonly Part[]): THREE.BufferGeometry {
  const list = parts.map((part) => {
    const source = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    const [px, py, pz] = part.position ?? [0, 0, 0];
    const [rx, ry, rz] = part.rotation ?? [0, 0, 0];
    matrix.compose(pos.set(px, py, pz), quat.setFromEuler(euler.set(rx, ry, rz)), unit);
    source.applyMatrix4(matrix);
    if (part.color !== undefined) {
      const c = new THREE.Color(part.color);
      const count = source.getAttribute("position").count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      source.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }
    return source;
  });
  const merged = mergeGeometries(list);
  list.forEach((g) => g.dispose());
  if (!merged) throw new Error("No se pudieron fundir las piezas");
  return merged;
}
