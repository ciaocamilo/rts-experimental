import * as THREE from "three";
import { mulberry32 } from "./scenery";

/** Punto del contorno en coordenadas locales (centro del rectángulo lógico) con su normal hacia el interior. */
export interface RimPoint {
  x: number;
  z: number;
  nx: number;
  nz: number;
}

/** Anillo de vértices desplazado hacia dentro respecto del contorno, con su color RGBA de vértice. */
export interface WaterLayer {
  /** Distancia hacia el interior desde el contorno irregular. */
  offset: number;
  alpha: number;
  shade: readonly [number, number, number];
}

const STEP = 0.5;
const ARC_SEGMENTS = 7;

/** Radio de esquina visual: siempre menor que media anchura para que el contorno no se invierta. */
export function cornerRadius(w: number, h: number): number {
  return Math.max(0.5, Math.min(2.6, Math.min(w, h) * 0.4));
}

/** Rectángulo redondeado muestreado en sentido creciente de ángulo; los puntos rectos llevan la normal de su esquina. */
export function rimPoints(w: number, h: number): RimPoint[] {
  const r = cornerRadius(w, h);
  const hw = w / 2;
  const hh = h / 2;
  const corners: readonly [number, number, number][] = [
    [hw - r, hh - r, 0],
    [-(hw - r), hh - r, Math.PI / 2],
    [-(hw - r), -(hh - r), Math.PI],
    [hw - r, -(hh - r), Math.PI * 1.5],
  ];
  const points: RimPoint[] = [];
  const arc = (cx: number, cz: number, a: number): RimPoint => ({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, nx: -Math.cos(a), nz: -Math.sin(a) });
  for (let c = 0; c < 4; c++) {
    const [cx, cz, a0] = corners[c]!;
    for (let s = 0; s < ARC_SEGMENTS; s++) points.push(arc(cx, cz, a0 + ((Math.PI / 2) * s) / ARC_SEGMENTS));
    const end = arc(cx, cz, a0 + Math.PI / 2);
    const [nx2, nz2, a1] = corners[(c + 1) % 4]!;
    const next = arc(nx2, nz2, a1);
    const len = Math.hypot(next.x - end.x, next.z - end.z);
    const pieces = Math.max(1, Math.round(len / STEP));
    // El último punto del arco es el primero del tramo recto; sus vecinos conservan esa normal.
    for (let k = 0; k < pieces; k++) {
      const t = k / pieces;
      points.push({ x: end.x + (next.x - end.x) * t, z: end.z + (next.z - end.z) * t, nx: end.nx, nz: end.nz });
    }
  }
  return points;
}

/** Hundimiento del contorno (0..max) a lo largo del perímetro; frecuencias enteras, así que el anillo cierra sin salto. */
export function rimInset(count: number, seed: number, max: number): number[] {
  const rng = mulberry32(seed);
  const phase = [rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const s = (i / count) * Math.PI * 2;
    const n = 0.5 * Math.sin(3 * s + phase[0]!) + 0.3 * Math.sin(7 * s + phase[1]!) + 0.2 * Math.sin(13 * s + phase[2]!);
    out.push(max * (0.5 + 0.5 * n));
  }
  return out;
}

/**
 * Superficie con contorno orgánico: anillos concéntricos con color y opacidad de vértice que difuminan el
 * borde. Todos los vértices quedan dentro del rectángulo lógico, que sigue siendo el obstáculo real.
 */
export function buildWaterGeometry(w: number, h: number, seed: number, layers: readonly WaterLayer[], uvOrigin: { x: number; z: number }, uvScale: number): THREE.BufferGeometry {
  const rim = rimPoints(w, h);
  const n = rim.length;
  const inset = rimInset(n, seed, Math.min(0.4, Math.min(w, h) * 0.08));
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const push = (x: number, z: number, layer: WaterLayer): void => {
    positions.push(x, 0, z);
    colors.push(layer.shade[0], layer.shade[1], layer.shade[2], layer.alpha);
    uvs.push((uvOrigin.x + x) * uvScale, (uvOrigin.z + z) * uvScale);
  };
  for (const layer of layers) {
    for (let i = 0; i < n; i++) {
      const p = rim[i]!;
      const d = inset[i]! + layer.offset;
      push(p.x + p.nx * d, p.z + p.nz * d, layer);
    }
  }
  const last = layers[layers.length - 1]!;
  push(0, 0, last);
  const center = layers.length * n;

  const indices: number[] = [];
  const tri = (a: number, b: number, c: number): void => {
    const cross = (positions[b * 3 + 2]! - positions[a * 3 + 2]!) * (positions[c * 3]! - positions[a * 3]!) - (positions[b * 3]! - positions[a * 3]!) * (positions[c * 3 + 2]! - positions[a * 3 + 2]!);
    if (cross >= 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  };
  for (let k = 0; k < layers.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = k * n + i;
      const b = k * n + j;
      const c = (k + 1) * n + j;
      const d = (k + 1) * n + i;
      tri(a, b, c);
      tri(a, c, d);
    }
  }
  for (let i = 0; i < n; i++) tri((layers.length - 1) * n + i, (layers.length - 1) * n + ((i + 1) % n), center);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Semilla estable por rectángulo para que el contorno no cambie entre reconstrucciones. */
export function waterSeed(x: number, z: number): number {
  return ((Math.imul(x | 0, 73856093) ^ Math.imul(z | 0, 19349663)) >>> 0) + 17;
}
