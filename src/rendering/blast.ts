import * as THREE from "three";
import type { AssetLibrary, Quality } from "./assets";
import { GRAVITY, hash, ParticleCloud, particleMaterial } from "./particles";

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Altura de la parábola de la bala: crece con la distancia, entre 0,6 y 2,4 unidades. */
export function arcHeight(distance: number): number {
  return Math.min(2.4, Math.max(0.6, 0.6 + 0.12 * distance));
}

/**
 * Punto de la trayectoria a la fracción `k` del vuelo: lineal en horizontal y parabólica en vertical, con la
 * altura de la boca `y0`, el suelo como destino y `H` como altura extra del vértice (en k = 0,5).
 */
export function ballisticPoint(from: { x: number; z: number }, to: { x: number; z: number }, y0: number, H: number, k: number, out: Vec3Like = { x: 0, y: 0, z: 0 }): Vec3Like {
  out.x = from.x + (to.x - from.x) * k;
  out.z = from.z + (to.z - from.z) * k;
  out.y = y0 + (0 - y0) * k + 4 * H * k * (1 - k);
  return out;
}

const rise = (t: number, rate: number): number => 1 - Math.exp(-rate * t);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

interface MuzzleShot {
  active: boolean;
  age: number;
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  spark: Float32Array;
  smoke: Float32Array;
}

const MUZZLE_SLOTS = 6;
const MUZZLE_LIFE_S = 1.6;

/** Fogonazo: destello, chispas, bocanada de humo y empuje de polvo en la boca; pool fijo de 6 disparos. */
export class MuzzleFx {
  readonly group = new THREE.Group();
  private readonly shots: MuzzleShot[] = [];
  private readonly glow: ParticleCloud;
  private readonly spark: ParticleCloud;
  private readonly smoke: ParticleCloud;
  private readonly dust: ParticleCloud;
  private readonly light: THREE.PointLight | null;
  private lightAge = Infinity;
  private next = 0;
  /** Partículas por disparo: ≤ 40 en calidad alta y ≤ 16 en baja. */
  readonly perShot: { glow: number; spark: number; smoke: number; dust: number };

  constructor(assets: AssetLibrary, quality: Quality) {
    const high = quality === "high";
    this.perShot = { glow: high ? 2 : 1, spark: high ? 8 : 4, smoke: high ? 16 : 8, dust: high ? 6 : 0 };
    const p = this.perShot;
    this.glow = new ParticleCloud(MUZZLE_SLOTS * p.glow, particleMaterial(assets, "glow"));
    this.spark = new ParticleCloud(MUZZLE_SLOTS * p.spark, particleMaterial(assets, "spark"));
    this.smoke = new ParticleCloud(MUZZLE_SLOTS * p.smoke, particleMaterial(assets, "smoke"));
    this.dust = new ParticleCloud(Math.max(1, MUZZLE_SLOTS * p.dust), particleMaterial(assets, "dust"));
    this.group.add(this.glow.points, this.spark.points, this.smoke.points, this.dust.points);
    for (let i = 0; i < MUZZLE_SLOTS; i++) {
      this.shots.push({ active: false, age: 0, x: 0, y: 0, z: 0, dx: 0, dz: 1, spark: new Float32Array(p.spark * 3), smoke: new Float32Array(p.smoke * 3) });
    }
    // La luz existe siempre (intensidad 0 en reposo) para que añadirla no recompile los materiales.
    this.light = high ? new THREE.PointLight(0xffa850, 0, 9, 1.6) : null;
    if (this.light) this.group.add(this.light);
    this.clear();
  }

  get active(): number {
    return this.shots.filter((s) => s.active).length;
  }

  get particlesPerShot(): number {
    const p = this.perShot;
    return p.glow + p.spark + p.smoke + p.dust;
  }

  /** Dispara un fogonazo en la boca (x, y, z) hacia la dirección horizontal (dx, dz). Reutiliza el más antiguo si no hay hueco. */
  fire(x: number, y: number, z: number, dx: number, dz: number, seed: number): void {
    let index = this.shots.findIndex((s) => !s.active);
    if (index < 0) {
      index = this.next;
      this.next = (this.next + 1) % MUZZLE_SLOTS;
    }
    const len = Math.hypot(dx, dz) || 1;
    const shot = this.shots[index]!;
    shot.active = true;
    shot.age = 0;
    shot.x = x;
    shot.y = y;
    shot.z = z;
    shot.dx = dx / len;
    shot.dz = dz / len;
    const rnd = hash(seed * 2654435761 + 91);
    for (let i = 0; i < shot.spark.length; i += 3) {
      shot.spark[i] = 4 + rnd() * 5;
      shot.spark[i + 1] = 1 + rnd() * 2.5;
      shot.spark[i + 2] = (rnd() - 0.5) * 3;
    }
    for (let i = 0; i < shot.smoke.length; i += 3) {
      shot.smoke[i] = 0.4 + rnd() * 1.4;
      shot.smoke[i + 1] = (rnd() - 0.5) * 0.9;
      shot.smoke[i + 2] = 0.6 + rnd() * 0.9;
    }
    this.lightAge = 0;
    this.light?.position.set(x + shot.dx * 0.4, y, z + shot.dz * 0.4);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const p = this.perShot;
    this.lightAge += dt;
    if (this.light) this.light.intensity = this.lightAge < 0.1 ? 14 * (1 - this.lightAge / 0.1) : 0;
    this.shots.forEach((shot, slot) => {
      if (!shot.active) return;
      shot.age += dt;
      const t = shot.age;
      const done = t > MUZZLE_LIFE_S;
      const px = -shot.dz;
      const pz = shot.dx;
      for (let i = 0; i < p.glow; i++) {
        const life = i === 0 ? 0.12 : 0.2;
        const k = clamp01(t / life);
        const index = slot * p.glow + i;
        if (done || k >= 1) this.glow.hide(index);
        else this.glow.set(index, shot.x + shot.dx * 0.25, shot.y, shot.z + shot.dz * 0.25, (i === 0 ? 1.5 : 2.4) * (1 - k * 0.6), (i === 0 ? 1 : 0.55) * (1 - k));
      }
      for (let i = 0; i < p.spark; i++) {
        const index = slot * p.spark + i;
        const [vf, vy, vs] = [shot.spark[i * 3]!, shot.spark[i * 3 + 1]!, shot.spark[i * 3 + 2]!];
        const y = shot.y + vy * t - 0.5 * GRAVITY * 0.6 * t * t;
        if (done || t > 0.4 || y < 0) this.spark.hide(index);
        else this.spark.set(index, shot.x + shot.dx * vf * t + px * vs * t, y, shot.z + shot.dz * vf * t + pz * vs * t, 0.1, 1 - t / 0.4);
      }
      for (let i = 0; i < p.smoke; i++) {
        const index = slot * p.smoke + i;
        const delay = i * 0.012;
        const u = (t - delay) / MUZZLE_LIFE_S;
        if (done || u < 0 || u >= 1) {
          this.smoke.hide(index);
          continue;
        }
        const [reach, side, lift] = [shot.smoke[i * 3]!, shot.smoke[i * 3 + 1]!, shot.smoke[i * 3 + 2]!];
        const tt = t - delay;
        const drift = reach * rise(tt, 3.2);
        this.smoke.set(
          index,
          shot.x + shot.dx * drift + px * side * rise(tt, 2),
          shot.y + lift * rise(tt, 1.1) * 0.7,
          shot.z + shot.dz * drift + pz * side * rise(tt, 2),
          0.3 + 1.1 * Math.sqrt(u),
          0.6 * Math.min(1, tt * 12) * (1 - u) ** 1.3,
        );
      }
      for (let i = 0; i < p.dust; i++) {
        const index = slot * p.dust + i;
        const u = t / 0.9;
        if (done || u >= 1) {
          this.dust.hide(index);
          continue;
        }
        const a = ((i / p.dust) - 0.5) * 2.2;
        const r = 0.5 + 1.3 * rise(t, 3);
        this.dust.set(index, shot.x + shot.dx * r * Math.cos(a) + px * r * Math.sin(a), 0.12 + 0.2 * u, shot.z + shot.dz * r * Math.cos(a) + pz * r * Math.sin(a), 0.35 + 0.6 * u, 0.35 * (1 - u));
      }
      if (done) shot.active = false;
    });
    for (const cloud of [this.glow, this.spark, this.smoke, this.dust]) cloud.commit();
  }

  clear(): void {
    for (const shot of this.shots) shot.active = false;
    for (const cloud of [this.glow, this.spark, this.smoke, this.dust]) {
      for (let i = 0; i < cloud.count; i++) cloud.hide(i);
      cloud.commit();
    }
    this.lightAge = Infinity;
    if (this.light) this.light.intensity = 0;
  }
}

const IMPACT_SLOTS = 6;
const IMPACT_LIFE_S = 2.2;
const MAX_SCORCH = 8;
const SCORCH_FADE_S = 8;
const DEBRIS_PER_IMPACT = 10;
const DEBRIS_LIFE_S = 1.8;
const SHOCK_S = 0.3;

interface ImpactBurst {
  active: boolean;
  age: number;
  x: number;
  z: number;
  radius: number;
  smoke: Float32Array;
  dust: Float32Array;
  spark: Float32Array;
  debris: { p: THREE.Vector3; v: THREE.Vector3; spin: THREE.Vector3; rot: THREE.Euler; scale: THREE.Vector3; resting: boolean }[];
}

interface Scorch {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
}

/** Impacto: destello, bola de fuego, onda de choque, humo, escombros balísticos y marca de quemado. Pool de 6 ráfagas. */
export class ImpactFx {
  readonly group = new THREE.Group();
  private readonly bursts: ImpactBurst[] = [];
  private readonly glow: ParticleCloud;
  private readonly flash: ParticleCloud;
  private readonly smoke: ParticleCloud;
  private readonly dust: ParticleCloud;
  private readonly spark: ParticleCloud;
  private readonly rings: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial }[] = [];
  private readonly scorch: Scorch[] = [];
  private readonly debris: THREE.InstancedMesh | null;
  private readonly dummy = new THREE.Object3D();
  private nextScorch = 0;
  private nextSlot = 0;
  readonly perBurst: { glow: number; spark: number; smoke: number; dust: number };

  constructor(assets: AssetLibrary, quality: Quality) {
    const high = quality === "high";
    this.perBurst = { glow: 3, spark: high ? 10 : 0, smoke: high ? 14 : 8, dust: high ? 10 : 0 };
    const p = this.perBurst;
    this.glow = new ParticleCloud(IMPACT_SLOTS * p.glow, particleMaterial(assets, "glow"));
    this.flash = new ParticleCloud(IMPACT_SLOTS, particleMaterial(assets, "spark"));
    this.smoke = new ParticleCloud(IMPACT_SLOTS * p.smoke, particleMaterial(assets, "smoke"));
    this.dust = new ParticleCloud(Math.max(1, IMPACT_SLOTS * p.dust), particleMaterial(assets, "dust"));
    this.spark = new ParticleCloud(Math.max(1, IMPACT_SLOTS * p.spark), particleMaterial(assets, "spark"));
    this.group.add(this.dust.points, this.smoke.points, this.glow.points, this.flash.points, this.spark.points);

    const ringGeometry = assets.track(new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2));
    const discGeometry = assets.track(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2));
    for (let i = 0; i < IMPACT_SLOTS; i++) {
      const material = assets.basic({ color: 0xffe2a8, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(ringGeometry, material);
      mesh.visible = false;
      mesh.position.y = 0.05;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.rings.push({ mesh, material });
      this.bursts.push({ active: false, age: 0, x: 0, z: 0, radius: 2, smoke: new Float32Array(p.smoke * 4), dust: new Float32Array(p.dust * 3), spark: new Float32Array(p.spark * 3), debris: [] });
    }
    for (let i = 0; i < MAX_SCORCH; i++) {
      const material = assets.basic({ color: 0x14100c, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(discGeometry, material);
      mesh.visible = false;
      mesh.position.y = 0.03;
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.scorch.push({ mesh, material, age: Infinity });
    }
    if (high) {
      this.debris = new THREE.InstancedMesh(assets.track(new THREE.BoxGeometry(1, 1, 1)), assets.lambert({}), IMPACT_SLOTS * DEBRIS_PER_IMPACT);
      this.debris.frustumCulled = false;
      const color = new THREE.Color();
      const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < IMPACT_SLOTS * DEBRIS_PER_IMPACT; i++) {
        this.debris.setMatrixAt(i, hidden);
        this.debris.setColorAt(i, color.set(i % 3 === 0 ? 0x4a3a2a : i % 3 === 1 ? 0x6b5b45 : 0x77705f));
      }
      this.group.add(this.debris);
    } else this.debris = null;
    this.clear();
  }

  get active(): number {
    return this.bursts.filter((b) => b.active).length;
  }

  /** Marcas de quemado visibles ahora mismo (≤ 8). */
  get scorchCount(): number {
    return this.scorch.filter((s) => s.mesh.visible).length;
  }

  get particlesPerBurst(): number {
    const p = this.perBurst;
    return p.glow + 1 + p.spark + p.smoke + p.dust;
  }

  spawn(x: number, z: number, seed: number, radius = 2): void {
    let index = this.bursts.findIndex((b) => !b.active);
    if (index < 0) {
      index = this.nextSlot;
      this.nextSlot = (this.nextSlot + 1) % IMPACT_SLOTS;
    }
    const burst = this.bursts[index]!;
    burst.active = true;
    burst.age = 0;
    burst.x = x;
    burst.z = z;
    burst.radius = radius;
    const rnd = hash(seed * 2654435761 + 7);
    for (let i = 0; i < burst.smoke.length; i += 4) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * radius * 0.5;
      burst.smoke[i] = Math.cos(a) * r;
      burst.smoke[i + 1] = Math.sin(a) * r;
      burst.smoke[i + 2] = 1 + rnd() * 1.6;
      burst.smoke[i + 3] = rnd() * 0.25;
    }
    for (let i = 0; i < burst.dust.length; i += 3) {
      burst.dust[i] = rnd() * Math.PI * 2;
      burst.dust[i + 1] = 0.6 + rnd() * 0.5;
      burst.dust[i + 2] = rnd() * 0.15;
    }
    for (let i = 0; i < burst.spark.length; i += 3) {
      const a = rnd() * Math.PI * 2;
      const out = 2 + rnd() * 4;
      burst.spark[i] = Math.cos(a) * out;
      burst.spark[i + 1] = 3 + rnd() * 5;
      burst.spark[i + 2] = Math.sin(a) * out;
    }
    if (this.debris) {
      burst.debris.length = 0;
      for (let i = 0; i < DEBRIS_PER_IMPACT; i++) {
        const a = rnd() * Math.PI * 2;
        const out = 1.2 + rnd() * 3;
        burst.debris.push({
          p: new THREE.Vector3(x + Math.cos(a) * 0.3, 0.2, z + Math.sin(a) * 0.3),
          v: new THREE.Vector3(Math.cos(a) * out, 4 + rnd() * 5, Math.sin(a) * out),
          spin: new THREE.Vector3((rnd() - 0.5) * 14, (rnd() - 0.5) * 14, (rnd() - 0.5) * 14),
          rot: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6),
          scale: new THREE.Vector3(0.07 + rnd() * 0.14, 0.05 + rnd() * 0.1, 0.07 + rnd() * 0.12),
          resting: false,
        });
      }
    }
    const mark = this.scorch[this.nextScorch]!;
    this.nextScorch = (this.nextScorch + 1) % MAX_SCORCH;
    mark.age = 0;
    mark.mesh.visible = true;
    mark.mesh.position.x = x;
    mark.mesh.position.z = z;
    mark.mesh.scale.setScalar(radius * (0.55 + rnd() * 0.2));
    mark.mesh.rotation.y = rnd() * 6;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const p = this.perBurst;
    this.bursts.forEach((b, slot) => {
      if (!b.active) return;
      b.age += dt;
      const t = b.age;
      const done = t > IMPACT_LIFE_S;
      const ring = this.rings[slot]!;
      const shock = clamp01(t / SHOCK_S);
      ring.mesh.visible = !done && shock < 1;
      if (ring.mesh.visible) {
        ring.mesh.position.set(b.x, 0.05, b.z);
        ring.mesh.scale.setScalar(Math.max(0.05, b.radius * (1 - (1 - shock) ** 2)));
        ring.material.opacity = 0.7 * (1 - shock);
      }
      const fk = clamp01(t / 0.12);
      if (done || fk >= 1) this.flash.hide(slot);
      else this.flash.set(slot, b.x, 0.8, b.z, 3.6 * (1 - 0.5 * fk), 1 - fk);
      for (let i = 0; i < p.glow; i++) {
        const index = slot * p.glow + i;
        const k = clamp01(t / (0.3 + 0.05 * i));
        if (done || k >= 1) this.glow.hide(index);
        else {
          const a = i * 2.1;
          this.glow.set(index, b.x + Math.cos(a) * 0.35 * k, 0.45 + 0.5 * i * 0.3 * k, b.z + Math.sin(a) * 0.35 * k, (1.1 + 1.9 * Math.sqrt(k)) * (1 - 0.2 * i), 0.9 * (1 - k) ** 1.4);
        }
      }
      for (let i = 0; i < p.spark; i++) {
        const index = slot * p.spark + i;
        const sx = b.spark[i * 3]!;
        const sy = b.spark[i * 3 + 1]!;
        const sz = b.spark[i * 3 + 2]!;
        const y = 0.3 + sy * t - 0.5 * GRAVITY * t * t;
        if (done || t > 0.6 || y < 0) this.spark.hide(index);
        else this.spark.set(index, b.x + sx * t, y, b.z + sz * t, 0.13, 1 - t / 0.6);
      }
      for (let i = 0; i < p.smoke; i++) {
        const index = slot * p.smoke + i;
        const tt = t - b.smoke[i * 4 + 3]!;
        const u = tt / IMPACT_LIFE_S;
        if (done || u < 0 || u >= 1) this.smoke.hide(index);
        else this.smoke.set(index, b.x + b.smoke[i * 4]! * (1 + 0.5 * u), 0.4 + b.smoke[i * 4 + 2]! * rise(tt, 1.2), b.z + b.smoke[i * 4 + 1]! * (1 + 0.5 * u), 0.7 + 1.5 * Math.sqrt(u), 0.65 * Math.min(1, tt * 6) * (1 - u) ** 1.2);
      }
      for (let i = 0; i < p.dust; i++) {
        const index = slot * p.dust + i;
        const tt = t - b.dust[i * 3 + 2]!;
        const u = tt / 1.5;
        if (done || u < 0 || u >= 1) this.dust.hide(index);
        else {
          const r = b.radius * (0.3 + b.dust[i * 3 + 1]! * rise(tt, 2.4));
          this.dust.set(index, b.x + Math.cos(b.dust[i * 3]!) * r, 0.2 + 0.5 * u, b.z + Math.sin(b.dust[i * 3]!) * r, 0.7 + 0.9 * u, 0.5 * (1 - u));
        }
      }
      if (done) b.active = false;
    });
    for (const cloud of [this.glow, this.flash, this.smoke, this.dust, this.spark]) cloud.commit();
    this.stepDebris(dt);
    for (const s of this.scorch) {
      if (!s.mesh.visible) continue;
      s.age += dt;
      const k = s.age / SCORCH_FADE_S;
      if (k >= 1) s.mesh.visible = false;
      else s.material.opacity = 0.55 * Math.min(1, s.age * 8) * (1 - k);
    }
  }

  private stepDebris(dt: number): void {
    const mesh = this.debris;
    if (!mesh) return;
    this.bursts.forEach((b, slot) => {
      b.debris.forEach((d, i) => {
        const instance = slot * DEBRIS_PER_IMPACT + i;
        if (!b.active || b.age > DEBRIS_LIFE_S) {
          this.dummy.scale.setScalar(0);
        } else {
          if (!d.resting) {
            d.v.y -= GRAVITY * dt;
            d.p.addScaledVector(d.v, dt);
            d.rot.x += d.spin.x * dt;
            d.rot.y += d.spin.y * dt;
            if (d.p.y < 0.06) {
              d.p.y = 0.06;
              d.resting = true;
            }
          }
          this.dummy.position.copy(d.p);
          this.dummy.rotation.copy(d.rot);
          this.dummy.scale.copy(d.scale).multiplyScalar(clamp01((DEBRIS_LIFE_S - b.age) / 0.5));
        }
        this.dummy.updateMatrix();
        mesh.setMatrixAt(instance, this.dummy.matrix);
      });
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (const b of this.bursts) {
      b.active = false;
      b.debris.length = 0;
    }
    for (const r of this.rings) r.mesh.visible = false;
    for (const s of this.scorch) {
      s.mesh.visible = false;
      s.age = Infinity;
    }
    for (const cloud of [this.glow, this.flash, this.smoke, this.dust, this.spark]) {
      for (let i = 0; i < cloud.count; i++) cloud.hide(i);
      cloud.commit();
    }
    if (this.debris) this.stepDebris(0);
  }
}
