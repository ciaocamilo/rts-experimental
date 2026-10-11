import * as THREE from "three";
import type { BuildingKind } from "../content/balance";
import type { AssetLibrary } from "./assets";
import { FLAME_THRESHOLDS } from "./health";
import { mergeParts } from "./merge";

type Slot = readonly [x: number, y: number, z: number];

/**
 * Posiciones de las llamas sobre el tejado (coordenadas locales del edificio), en orden de aparición.
 * Cada punto queda sobre la superficie de la cubierta, lejos de chimeneas y banderas.
 */
export const FLAME_SLOTS: Record<BuildingKind, readonly Slot[]> = {
  townCenter: [[-0.6, 2.7, 0], [0.7, 2.25, 0.8], [0.3, 2.35, -0.7], [1.3, 2.15, 1.0], [-1.1, 2.1, 1.1]],
  house: [[0, 1.7, 0], [-0.5, 1.5, 0.3], [0.5, 1.5, 0.35], [-0.2, 1.4, -0.45], [0.2, 1.3, 0.55]],
  barracks: [[0.3, 2.1, 0], [-0.8, 1.88, 0.5], [0.9, 1.85, -0.5], [-0.2, 1.72, -0.8], [0.5, 1.6, 0.95]],
};

const SIZE: Record<BuildingKind, number> = { townCenter: 1.5, house: 0.95, barracks: 1.2 };

export interface FlameRig {
  group: THREE.Group;
  flames: THREE.Mesh[];
  phases: number[];
  base: number;
}

/** Llamas procedurales: un solo mesh fundido y un material compartido por todos los edificios. */
export class FlameFactory {
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;

  constructor(assets: AssetLibrary) {
    const tongue = (r: number, h: number, x: number, z: number, color: number, tilt: number): { geometry: THREE.BufferGeometry; position: Slot; rotation: Slot; color: number } => ({
      geometry: new THREE.ConeGeometry(r, h, 7).translate(0, h / 2, 0),
      position: [x, 0, z],
      rotation: [0, 0, tilt],
      color,
    });
    this.geometry = assets.track(
      mergeParts([
        tongue(0.2, 0.62, 0, 0, 0xe8430c, 0),
        tongue(0.12, 0.5, 0.1, 0.04, 0xff7a14, -0.18),
        tongue(0.1, 0.42, -0.1, -0.03, 0xff8a1a, 0.2),
        tongue(0.1, 0.4, 0, 0, 0xffd84a, 0),
      ]),
    );
    this.material = assets.basic({ vertexColors: true });
  }

  create(kind: BuildingKind, phaseSeed: number): FlameRig {
    const group = new THREE.Group();
    group.visible = false;
    const flames: THREE.Mesh[] = [];
    const phases: number[] = [];
    FLAME_SLOTS[kind].forEach((slot, i) => {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.position.set(slot[0], slot[1], slot[2]);
      mesh.visible = false;
      mesh.frustumCulled = true;
      group.add(mesh);
      flames.push(mesh);
      phases.push(((phaseSeed * 7 + i * 13) % 31) * 0.37);
    });
    return { group, flames, phases, base: SIZE[kind] };
  }
}

/** Muestra las primeras `count` llamas y las anima con parpadeo; `t` es tiempo de juego (se congela en pausa). */
export function updateFlames(rig: FlameRig, count: number, t: number): void {
  const n = Math.min(count, FLAME_THRESHOLDS.length);
  rig.group.visible = n > 0;
  for (let i = 0; i < rig.flames.length; i++) {
    const flame = rig.flames[i]!;
    const on = i < n;
    flame.visible = on;
    if (!on) continue;
    const p = rig.phases[i]! + t;
    const grow = 0.9 + 0.1 * i * 0.5;
    flame.scale.set(rig.base * grow * (1 + 0.1 * Math.sin(p * 9)), rig.base * grow * (1 + 0.22 * Math.sin(p * 13 + 1) + 0.08 * Math.sin(p * 5)), rig.base * grow * (1 + 0.1 * Math.cos(p * 8)));
    flame.rotation.y = p * 2;
    flame.rotation.z = 0.08 * Math.sin(p * 6);
  }
}
