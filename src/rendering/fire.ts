import * as THREE from "three";
import type { BuildingKind } from "../content/balance";
import type { AssetLibrary } from "./assets";
import { FLAME_THRESHOLDS } from "./health";
import { mergeParts } from "./merge";
import { frac, ParticleCloud, particleMaterial } from "./particles";

type Slot = readonly [x: number, y: number, z: number];

/**
 * Posiciones de las llamas sobre el tejado (coordenadas locales del edificio), en orden de aparición.
 * Cada punto queda sobre la superficie de la cubierta, lejos de chimeneas y banderas.
 */
export const FLAME_SLOTS: Record<BuildingKind, readonly Slot[]> = {
  townCenter: [[-0.6, 2.7, 0], [0.7, 2.25, 0.8], [0.3, 2.35, -0.7], [1.3, 2.15, 1.0], [-1.1, 2.1, 1.1]],
  house: [[0, 1.7, 0], [-0.5, 1.5, 0.3], [0.5, 1.5, 0.35], [-0.2, 1.4, -0.45], [0.2, 1.3, 0.55]],
  barracks: [[0.3, 2.1, 0], [-0.8, 1.88, 0.5], [0.9, 1.85, -0.5], [-0.2, 1.72, -0.8], [0.5, 1.6, 0.95]],
  tower: [[0.5, 3.4, 0], [-0.4, 3.45, 0.3], [0, 3.4, -0.5], [0.3, 3.3, 0.6], [-0.65, 3.25, -0.2]],
};

const SIZE: Record<BuildingKind, number> = { townCenter: 1.5, house: 0.95, barracks: 1.2, tower: 1.0 };

/** Tope global de partículas de fuego (P5-H09); al agotarse, los edificios nuevos reciben una versión reducida. */
export const MAX_FIRE_PARTICLES = 400;
const SMOKE_PER_FLAME = 3;
const SPARKS_PER_FLAME = 2;

export interface FlameRig {
  group: THREE.Group;
  flames: THREE.Mesh[];
  phases: number[];
  base: number;
  smoke: ParticleCloud;
  glow: ParticleCloud;
  spark: ParticleCloud;
  smokePerFlame: number;
  sparksPerFlame: number;
  particles: number;
}

/** Llamas procedurales: un solo mesh fundido y materiales compartidos por todos los edificios. */
export class FlameFactory {
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly smokeMaterial: THREE.ShaderMaterial;
  private readonly glowMaterial: THREE.ShaderMaterial;
  private readonly sparkMaterial: THREE.ShaderMaterial;
  private used = 0;

  /** Partículas de fuego reservadas ahora mismo. */
  get particles(): number {
    return this.used;
  }

  constructor(assets: AssetLibrary, private readonly fancy = true) {
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
    this.smokeMaterial = particleMaterial(assets, "smoke");
    this.glowMaterial = particleMaterial(assets, "glow");
    this.sparkMaterial = particleMaterial(assets, "spark");
  }

  create(kind: BuildingKind, phaseSeed: number): FlameRig {
    const group = new THREE.Group();
    group.visible = false;
    const flames: THREE.Mesh[] = [];
    const phases: number[] = [];
    const slots = FLAME_SLOTS[kind];
    const cost = (smoke: number, sparks: number): number => slots.length * (smoke + sparks + 1) + 1;
    const room = MAX_FIRE_PARTICLES - this.used;
    // Tres niveles según lo que quede de presupuesto: completo, reducido (solo humo y brillo) o sin partículas.
    const tier = !this.fancy ? 0 : room >= cost(SMOKE_PER_FLAME, SPARKS_PER_FLAME) ? 2 : room >= cost(1, 0) ? 1 : 0;
    const smokePerFlame = tier === 2 ? SMOKE_PER_FLAME : tier === 1 ? 1 : 0;
    const sparksPerFlame = tier === 2 ? SPARKS_PER_FLAME : 0;
    const smoke = new ParticleCloud(Math.max(1, slots.length * smokePerFlame), this.smokeMaterial);
    const glow = new ParticleCloud(slots.length + 1, this.glowMaterial);
    const spark = new ParticleCloud(Math.max(1, slots.length * sparksPerFlame), this.sparkMaterial);
    for (let i = 0; i < smoke.count; i++) smoke.hide(i);
    for (let i = 0; i < glow.count; i++) glow.hide(i);
    for (let i = 0; i < spark.count; i++) spark.hide(i);
    const particles = tier === 0 ? 0 : smokePerFlame * slots.length + slots.length + 1 + sparksPerFlame * slots.length;
    this.used += particles;
    if (tier > 0) group.add(smoke.points, glow.points, spark.points);
    slots.forEach((slot, i) => {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.position.set(slot[0], slot[1], slot[2]);
      mesh.visible = false;
      mesh.frustumCulled = true;
      group.add(mesh);
      flames.push(mesh);
      phases.push(((phaseSeed * 7 + i * 13) % 31) * 0.37);
    });
    return { group, flames, phases, base: SIZE[kind], smoke, glow, spark, smokePerFlame, sparksPerFlame, particles };
  }

  /** Libera las partículas de un edificio que ya no arde ni existe. */
  release(rig: FlameRig): void {
    this.used = Math.max(0, this.used - rig.particles);
    rig.particles = 0;
    rig.smoke.dispose();
    rig.glow.dispose();
    rig.spark.dispose();
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
  if (n > 0 && rig.particles > 0) updateParticles(rig, n, t);
}

/** Humo que sube y se ensancha, halos de brillo, chispas y resplandor en el suelo; la intensidad sigue a `n`. */
function updateParticles(rig: FlameRig, n: number, t: number): void {
  const slots = rig.flames.length;
  const intensity = n / slots;
  for (let i = 0; i < slots; i++) {
    const flame = rig.flames[i]!;
    const on = i < n;
    const p = rig.phases[i]!;
    const { x, y, z } = flame.position;
    for (let k = 0; k < rig.smokePerFlame; k++) {
      const slot = i * rig.smokePerFlame + k;
      if (!on) {
        rig.smoke.hide(slot);
        continue;
      }
      const u = frac(t * 0.27 + k / rig.smokePerFlame + p * 0.13);
      const fade = Math.min(1, u * 6) * (1 - u);
      rig.smoke.set(slot, x + u * 1.1 + Math.sin(u * 5 + p) * 0.12, y + 0.35 + u * 2.6, z + u * 0.45 + Math.cos(u * 4 + p) * 0.1, rig.base * (0.7 + 2.0 * u), 0.85 * fade * (0.6 + 0.4 * intensity));
    }
    if (on) {
      const flicker = 0.75 + 0.25 * Math.sin((t + p) * 11) * Math.sin((t + p) * 7.3);
      rig.glow.set(i, x, y + 0.25 * rig.base, z, rig.base * 2.2, 0.55 * flicker);
    } else rig.glow.hide(i);
    for (let k = 0; k < rig.sparksPerFlame; k++) {
      const slot = i * rig.sparksPerFlame + k;
      if (!on) {
        rig.spark.hide(slot);
        continue;
      }
      const u = frac(t * 0.9 + k * 0.5 + p * 0.31);
      const a = p * 3 + k * 2.4;
      rig.spark.set(slot, x + Math.cos(a) * u * 0.7, y + 0.3 + u * 1.9 - u * u * 0.8, z + Math.sin(a) * u * 0.7, 0.07, 0.9 * (1 - u));
    }
  }
  rig.glow.set(slots, 0, 0.05, 0, 2.6 + 1.6 * intensity, 0.2 + 0.25 * intensity);
  rig.smoke.commit();
  rig.glow.commit();
  rig.spark.commit();
}

