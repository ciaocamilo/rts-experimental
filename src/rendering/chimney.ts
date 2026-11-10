import * as THREE from "three";
import type { AssetLibrary } from "./assets";
import { CHIMNEY_TOP } from "./buildings";
import { frac, ParticleCloud, particleMaterial } from "./particles";

/** Partículas de humo por chimenea; tiene su propio presupuesto, aparte del de las llamas. */
export const CHIMNEY_PARTICLES = 9;
const RISE = 2.6;
const DRIFT = 0.9;
const CYCLE_S = 6.2;

export interface ChimneyRig {
  group: THREE.Group;
  smoke: ParticleCloud;
  phase: number;
}

/** Humo constante de la fragua: una columna de partículas que sube, se ensancha y se disipa, sin generar objetos nuevos. */
export class ChimneyFactory {
  private readonly material: THREE.ShaderMaterial;

  /** En calidad baja no hay partículas, así que `create` devuelve null. */
  constructor(assets: AssetLibrary, private readonly enabled = true) {
    this.material = particleMaterial(assets, "smoke");
  }

  create(phaseSeed: number): ChimneyRig | null {
    if (!this.enabled) return null;
    const group = new THREE.Group();
    group.visible = false;
    const smoke = new ParticleCloud(CHIMNEY_PARTICLES, this.material);
    for (let i = 0; i < smoke.count; i++) smoke.hide(i);
    group.add(smoke.points);
    return { group, smoke, phase: (phaseSeed % 17) * 0.37 };
  }

  release(rig: ChimneyRig): void {
    rig.group.visible = false;
    rig.smoke.dispose();
  }
}

/** Coloca cada partícula en su punto del ciclo; `t` es tiempo de juego (se congela en pausa). */
export function updateChimney(rig: ChimneyRig, active: boolean, t: number): void {
  rig.group.visible = active;
  if (!active) return;
  const n = rig.smoke.count;
  for (let i = 0; i < n; i++) {
    const u = frac(t / CYCLE_S + i / n + rig.phase * 0.13);
    const fade = Math.min(1, u * 5) * (1 - u);
    const sway = Math.sin(u * 6 + rig.phase + i) * 0.1;
    rig.smoke.set(i, CHIMNEY_TOP[0] + u * DRIFT + sway, CHIMNEY_TOP[1] + u * RISE, CHIMNEY_TOP[2] + u * 0.3 + Math.cos(u * 5 + i) * 0.06, 0.4 + 1.5 * u, 0.85 * fade);
  }
  rig.smoke.commit();
}
