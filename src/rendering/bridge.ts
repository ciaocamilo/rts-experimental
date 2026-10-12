import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Materials } from "./models";
import { texBox } from "./models";

/** Altura de la cubierta sobre el suelo y longitud de la rampa en cada extremo (en celdas). */
export const DECK_HEIGHT = 0.16;
export const RAMP_LENGTH = 0.6;

export interface BridgeRect {
  x: number;
  z: number;
  w: number;
  h: number;
}

/** Altura a la que caminan las unidades en (x, z): 0 en tierra, `DECK_HEIGHT` sobre el tablero y una rampa en los extremos. */
export function walkHeight(x: number, z: number, bridges: readonly BridgeRect[]): number {
  for (const b of bridges) {
    if (z < b.z || z > b.z + b.h || x < b.x || x > b.x + b.w) continue;
    const edge = Math.min(x - b.x, b.x + b.w - x);
    return DECK_HEIGHT * Math.min(1, Math.max(0, edge / RAMP_LENGTH));
  }
  return 0;
}

export interface BridgeMesh {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

type Part = { geometry: THREE.BufferGeometry; material: THREE.Material };

/** Puente de madera que cruza el agua en x: tablero con rampas, barandillas a ambos lados, pilotes y estribos de piedra. */
export function buildBridge(b: BridgeRect, mat: Materials): BridgeMesh[] {
  const parts: Part[] = [];
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rotZ = 0): void => {
    geometry.rotateZ(rotZ);
    geometry.translate(x, y, z);
    parts.push({ geometry, material });
  };
  const cx = b.x + b.w / 2;
  const cz = b.z + b.h / 2;
  const mid = b.w - RAMP_LENGTH * 2;

  add(texBox(mid, 0.14, b.h, 0.8), mat.planks, cx, DECK_HEIGHT - 0.07, cz);
  const slope = Math.atan2(DECK_HEIGHT, RAMP_LENGTH);
  const rampLength = Math.hypot(RAMP_LENGTH, DECK_HEIGHT);
  add(texBox(rampLength, 0.1, b.h, 0.8), mat.planks, b.x + RAMP_LENGTH / 2, DECK_HEIGHT / 2 - 0.05, cz, slope);
  add(texBox(rampLength, 0.1, b.h, 0.8), mat.planks, b.x + b.w - RAMP_LENGTH / 2, DECK_HEIGHT / 2 - 0.05, cz, -slope);

  for (const z of [b.z + 0.12, b.z + b.h - 0.12]) {
    const posts = 5;
    for (let i = 0; i < posts; i++) {
      add(texBox(0.12, 0.72, 0.12), mat.log, b.x + RAMP_LENGTH + (mid * i) / (posts - 1), DECK_HEIGHT + 0.36, z);
    }
    add(texBox(mid, 0.1, 0.1), mat.planks, cx, DECK_HEIGHT + 0.72, z);
    add(texBox(mid, 0.06, 0.08), mat.planks, cx, DECK_HEIGHT + 0.4, z);
    for (const x of [b.x + b.w * 0.3, b.x + b.w * 0.7]) {
      add(new THREE.CylinderGeometry(0.16, 0.2, 1, 8), mat.log, x, DECK_HEIGHT - 0.14 - 0.5, z + (z < cz ? 0.28 : -0.28));
    }
  }
  for (const x of [b.x, b.x + b.w]) add(texBox(0.7, 0.12, b.h, 0.6), mat.stone, x, 0.06, cz);

  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const p of parts) byMaterial.set(p.material, [...(byMaterial.get(p.material) ?? []), p.geometry]);
  return [...byMaterial].map(([material, list]) => {
    const geometry = mergeGeometries(list)!;
    for (const g of list) g.dispose();
    return { geometry, material };
  });
}
