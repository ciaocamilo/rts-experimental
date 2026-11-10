import * as THREE from "three";
import { mulberry32 } from "./scenery";

/** Ruido de valor determinista en [0, 1): mismas entradas, mismo resultado (sin Math.random). */
function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

export function fbm(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * f, z * f, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Altura del macizo en (u, v) ∈ [-1, 1]²: varias cumbres, crestas y siempre 0 en el borde del rectángulo. */
export function mountainHeight(u: number, v: number, seed: number, peak: number): number {
  const edge = Math.max(0, 1 - Math.pow(Math.pow(Math.abs(u), 4) + Math.pow(Math.abs(v), 4), 1 / 4));
  const wobble = (fbm(u * 2.2, v * 2.2, seed) - 0.5) * 0.3 * smooth(0, 0.2, edge);
  const e = Math.max(0, edge + wobble);
  const env = smooth(0, 0.22, e);
  if (env <= 0) return 0;
  const rng = mulberry32(seed * 31 + 7);
  let bump = 0;
  const count = 4;
  for (let i = 0; i < count; i++) {
    const cx = i === 0 ? (rng() - 0.5) * 0.3 : (rng() - 0.5) * 0.95;
    const cz = i === 0 ? (rng() - 0.5) * 0.3 : (rng() - 0.5) * 0.8;
    const h = i === 0 ? 1 : 0.6 + 0.3 * rng();
    const r = 0.85 + 0.35 * rng();
    const d = Math.hypot(u - cx, v - cz);
    bump = Math.max(bump, h * Math.pow(Math.max(0, 1 - d / r), 1.3));
  }
  const ridged = 1 - Math.abs(2 * fbm(u * 3.1 + 5, v * 3.1 - 3, seed + 17) - 1);
  const detail = (ridged - 0.5) * 0.9 * (0.25 + 0.75 * bump);
  return Math.max(0, env * (0.3 * peak * smooth(0, 0.5, e) + 0.75 * peak * bump) + env * detail);
}

type Rgb = readonly [number, number, number];
const GRASS: Rgb = [0.27, 0.38, 0.2];
const EARTH: Rgb = [0.44, 0.37, 0.28];
const ROCK: Rgb = [0.55, 0.53, 0.52];
const SNOW: Rgb = [0.94, 0.96, 0.99];
const mix = (a: Rgb, b: Rgb, t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * Macizo montañoso de `w × h` celdas: malla fina con cumbres múltiples, color por altitud y pendiente
 * (ladera verde, tierra, roca con estratos, nieve en lo alto) y normales suaves. Solo aspecto.
 */
export function buildMountainGeometry(w: number, h: number, seed: number, peak: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(w, h, Math.max(2, w * 3), Math.max(2, h * 3)).rotateX(-Math.PI / 2);
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, mountainHeight(pos.getX(i) / (w / 2), pos.getZ(i) / (h / 2), seed, peak));
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = y / peak;
    const slope = 1 - Math.min(1, Math.max(0, normal.getY(i)));
    const n = fbm(pos.getX(i) * 1.3 + seed, pos.getZ(i) * 1.3, seed + 3);
    let c = mix(GRASS, EARTH, smooth(0.02, 0.14, k + (n - 0.5) * 0.08));
    c = mix(c, ROCK, smooth(0.16, 0.4, k + (slope - 0.15) * 0.6));
    const strata = 0.06 * Math.sin(y * 11 + n * 6) * smooth(0.15, 0.4, k);
    const steep = 1 - 0.38 * smooth(0.3, 0.65, slope);
    const light = (0.86 + 0.28 * n + strata) * steep;
    const snow = smooth(0.68, 0.84, k + (n - 0.5) * 0.14 - slope * 0.35);
    c = mix(c, SNOW, snow);
    const shade = 1 + (light - 1) * (1 - snow * 0.7);
    // La paleta está pensada en sRGB; los colores de vértice se interpretan como lineales.
    colors[i * 3] = Math.pow(Math.min(1, c[0] * shade), 2.2);
    colors[i * 3 + 1] = Math.pow(Math.min(1, c[1] * shade), 2.2);
    colors[i * 3 + 2] = Math.pow(Math.min(1, c[2] * shade), 2.2);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Texels por celda de la textura del valle. */
export const VALLEY_RES = 8;

/** Ordenada lateral (celdas, local al rectángulo) de la senda del valle en la posición `a` a lo largo del eje largo. */
export function valleyPath(a: number, across: number, seed: number): number {
  const amp = Math.min(across * 0.2, 1.6);
  const phase1 = (seed % 7) * 0.9;
  const phase2 = (seed % 5) * 1.3;
  const z = across / 2 + amp * Math.sin(a * 0.33 + phase1) + 0.4 * amp * Math.sin(a * 0.87 + phase2);
  return Math.min(across - 1.2, Math.max(1.2, z));
}

/**
 * Alfombra de hierba del valle: bordes difuminados y ondulados (nunca tocan el borde del rectángulo), tonos de
 * pradera, un reborde oscuro que lo hace parecer hundido y flores. Filas de la imagen de arriba (z máx.) a abajo.
 */
export function buildValleyPixels(w: number, h: number, seed: number): Uint8Array {
  const cols = w * VALLEY_RES;
  const rows = h * VALLEY_RES;
  const data = new Uint8Array(cols * rows * 4);
  const rim: [number, number, number] = [20, 54, 25];
  const low: [number, number, number] = [62, 124, 48];
  const high: [number, number, number] = [118, 166, 72];
  const flowers: [number, number, number][] = [[250, 226, 90], [250, 250, 242], [190, 132, 226], [246, 150, 84]];
  for (let j = 0; j < rows; j++) {
    const z = (j + 0.5) / VALLEY_RES;
    const row = rows - 1 - j;
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) / VALLEY_RES;
      const edge = Math.min(x, w - x, z, h - z);
      const dn = Math.max(0, edge + (fbm(x * 0.9, z * 0.9, seed) - 0.5) * 1.8 * Math.min(1, edge));
      let alpha = smooth(0, 2.5, dn) * 0.88;
      const tone = fbm(x * 0.55 + 9, z * 0.55, seed + 5);
      let rgb = mix([low[0] / 255, low[1] / 255, low[2] / 255], [high[0] / 255, high[1] / 255, high[2] / 255], tone);
      rgb = mix(rgb, [rim[0] / 255, rim[1] / 255, rim[2] / 255], 1 - smooth(0.3, 2.2, dn));
      const patch = fbm(x * 2.4, z * 2.4, seed + 11);
      const shade = 0.9 + 0.2 * patch;
      let r = rgb[0] * 255 * shade;
      let g = rgb[1] * 255 * shade;
      let b = rgb[2] * 255 * shade;
      const cx = Math.floor(x * 3);
      const cz = Math.floor(z * 3);
      if (hash(cx, cz, seed + 23) > 0.82 && dn > 1) {
        const fx = (cx + 0.2 + 0.6 * hash(cx, cz, seed + 29)) / 3;
        const fz = (cz + 0.2 + 0.6 * hash(cx, cz, seed + 31)) / 3;
        const d = Math.hypot(x - fx, z - fz);
        if (d < 0.11) {
          const f = flowers[Math.floor(hash(cx, cz, seed + 37) * flowers.length)]!;
          const k = 1 - smooth(0.05, 0.11, d);
          r += (f[0] - r) * k;
          g += (f[1] - g) * k;
          b += (f[2] - b) * k;
          alpha = Math.max(alpha, k * 0.95);
        }
      }
      const o = (row * cols + i) * 4;
      data[o] = Math.min(255, r);
      data[o + 1] = Math.min(255, g);
      data[o + 2] = Math.min(255, b);
      data[o + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  }
  return data;
}
