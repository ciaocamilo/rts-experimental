import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Medidas de una tienda de campaña, en celdas (cabe en el rectángulo lógico de 4 × 4). */
export const TENT_LENGTH = 3.2;
export const TENT_WIDTH = 3.1;
export const TENT_HEIGHT = 2.1;

const CANVAS = [0.86, 0.79, 0.62] as const;
const CANVAS_SHADE = [0.7, 0.63, 0.47] as const;
const DARK = [0.2, 0.14, 0.09] as const;
const POLE = [0.36, 0.25, 0.14] as const;
const TRIM = [0.55, 0.14, 0.1] as const;

type Rgb = readonly [number, number, number];

/** Lado de cada ejército: banderín azul en la mitad del jugador 0 y rojo en la del 1. */
export function pennantColor(centreX: number, mapWidth: number): Rgb {
  return centreX < mapWidth / 2 ? [0.2, 0.42, 0.9] : [0.85, 0.2, 0.17];
}

function paint(positions: number[], color: Rgb): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const colors: number[] = [];
  for (let i = 0; i < positions.length / 3; i++) colors.push(color[0], color[1], color[2]);
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: Rgb): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed().translate(x, y, z);
  g.deleteAttribute("uv");
  const colors: number[] = [];
  for (let i = 0; i < g.getAttribute("position").count; i++) colors.push(color[0], color[1], color[2]);
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

/**
 * Tienda de cumbrera (prisma triangular con puerta, faldón, mástil y banderín) centrada en el origen, con la puerta hacia +x.
 * Todas las caras salen con la normal hacia fuera, de modo que no hace falta material de doble cara.
 */
export function buildTentGeometry(pennant: Rgb): THREE.BufferGeometry {
  const L = TENT_LENGTH / 2;
  const W = TENT_WIDTH / 2;
  const H = TENT_HEIGHT;
  const parts: THREE.BufferGeometry[] = [
    // Vertientes: la del lado -z queda algo más oscura que la del +z.
    paint([-L, 0, W, L, 0, W, L, H, 0, -L, 0, W, L, H, 0, -L, H, 0], CANVAS),
    paint([-L, 0, -W, -L, H, 0, L, H, 0, -L, 0, -W, L, H, 0, L, 0, -W], CANVAS_SHADE),
    // Frontones: delantero (con puerta) y trasero.
    paint([L, 0, -W, L, H, 0, L, 0, W], CANVAS),
    paint([-L, 0, W, -L, H, 0, -L, 0, -W], CANVAS_SHADE),
    // Puerta entreabierta y remate del dintel.
    paint([L + 0.02, 0, -0.6, L + 0.02, 1.25, 0, L + 0.02, 0, 0.6], DARK),
    paint([L + 0.03, 1.3, -0.12, L + 0.03, 1.38, 0.12, L + 0.03, 1.3, 0.12], TRIM),
    // Faldón rojo oscuro a lo largo de las dos vertientes y mástil con banderín sobre la cumbrera.
    box(TENT_LENGTH + 0.04, 0.16, 0.06, 0, 0.08, W + 0.005, TRIM),
    box(TENT_LENGTH + 0.04, 0.16, 0.06, 0, 0.08, -W - 0.005, TRIM),
    box(0.07, 0.9, 0.07, 0, H + 0.4, 0, POLE),
    paint([0.035, H + 0.82, 0, 0.035, H + 0.55, 0, 0.62, H + 0.68, 0], pennant),
    paint([-0.035, H + 0.82, 0, 0.62 - 0.07, H + 0.68, 0, -0.035, H + 0.55, 0], pennant),
  ];
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}
