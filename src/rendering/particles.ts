import * as THREE from "three";
import type { AssetLibrary } from "./assets";

/** Píxeles por unidad de mundo de la cámara ortográfica; lo actualiza la escena en cada cuadro. */
export const PARTICLE_SCALE = { value: 40 };
const MAX_POINT_PX = 220;

const vertexShader = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(${MAX_POINT_PX.toFixed(1)}, aSize * uScale);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uSoft;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(1.0 - clamp(d, 0.0, 1.0), uSoft) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export type ParticleKind = "smoke" | "dust" | "glow" | "spark";

const KINDS: Record<ParticleKind, { color: number; soft: number; additive: boolean }> = {
  smoke: { color: 0x504d4a, soft: 0.8, additive: false },
  dust: { color: 0xa89c86, soft: 1.3, additive: false },
  glow: { color: 0xff7a1c, soft: 2.0, additive: true },
  spark: { color: 0xffc860, soft: 0.8, additive: true },
};

/** Material de partículas compartido por tipo: puntos suaves con tamaño y opacidad por partícula. */
export function particleMaterial(assets: AssetLibrary, kind: ParticleKind): THREE.ShaderMaterial {
  const spec = KINDS[kind];
  return assets.track(
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: spec.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: PARTICLE_SCALE, uColor: { value: new THREE.Color(spec.color) }, uSoft: { value: spec.soft } },
    }),
  );
}

/** Nube de partículas: un solo `Points` con posición, tamaño y opacidad por partícula. */
export class ParticleCloud {
  readonly points: THREE.Points;
  private readonly position: THREE.BufferAttribute;
  private readonly size: THREE.BufferAttribute;
  private readonly alpha: THREE.BufferAttribute;

  constructor(readonly count: number, material: THREE.ShaderMaterial) {
    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.size = new THREE.BufferAttribute(new Float32Array(count), 1);
    this.alpha = new THREE.BufferAttribute(new Float32Array(count), 1);
    for (const a of [this.position, this.size, this.alpha]) a.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", this.position);
    geometry.setAttribute("aSize", this.size);
    geometry.setAttribute("aAlpha", this.alpha);
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  set(i: number, x: number, y: number, z: number, size: number, alpha: number): void {
    this.position.setXYZ(i, x, y, z);
    this.size.setX(i, size);
    this.alpha.setX(i, alpha);
  }

  hide(i: number): void {
    this.alpha.setX(i, 0);
  }

  commit(): void {
    this.position.needsUpdate = true;
    this.size.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
  }
}

/** Fracción 0..1 periódica. */
export function frac(x: number): number {
  return x - Math.floor(x);
}

/** Generador determinista barato para efectos cosméticos (no toca la aleatoriedad de la simulación). */
function hash(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_BURSTS = 8;
const DEBRIS_PER_BURST = 30;
const DUST_PER_BURST = 26;
export const DUST_LIFE_S = 2.5;
const DEBRIS_LIFE_S = 2.4;
const GRAVITY = 15;

interface Debris {
  slot: number;
  delay: number;
  p: THREE.Vector3;
  v: THREE.Vector3;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  scale: THREE.Vector3;
  bounces: number;
  resting: boolean;
}

interface Burst {
  cloud: ParticleCloud;
  age: number;
  x: number;
  z: number;
  footprint: number;
  dust: { a: number; r: number; speed: number; rise: number; delay: number; size: number }[];
  debris: Debris[];
}

/** Polvo duradero y escombros balísticos tras un derrumbe; es solo visual y se desvanece solo (P5-H09). */
export class CollapseFx {
  readonly group = new THREE.Group();
  private readonly bursts: Burst[] = [];
  private readonly debris: THREE.InstancedMesh;
  private readonly free: number[] = [];
  private readonly material: THREE.ShaderMaterial;
  private readonly dummy = new THREE.Object3D();
  private readonly geometry: THREE.BoxGeometry;

  constructor(assets: AssetLibrary) {
    this.material = particleMaterial(assets, "dust");
    this.geometry = assets.track(new THREE.BoxGeometry(1, 1, 1));
    const total = MAX_BURSTS * DEBRIS_PER_BURST;
    this.debris = new THREE.InstancedMesh(this.geometry, assets.lambert({}), total);
    this.debris.frustumCulled = false;
    this.debris.castShadow = false;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const color = new THREE.Color();
    for (let i = 0; i < total; i++) {
      this.debris.setMatrixAt(i, hidden);
      this.debris.setColorAt(i, color.set(i % 3 === 0 ? 0x6b4a2b : i % 3 === 1 ? 0x8a8a84 : 0x9a8f7c));
      this.free.push(i);
    }
    this.group.add(this.debris);
  }

  get active(): number {
    return this.bursts.length;
  }

  /** Número de piezas de escombro en vuelo o en reposo (para pruebas y diagnóstico). */
  get debrisCount(): number {
    return this.bursts.reduce((n, b) => n + b.debris.length, 0);
  }

  spawn(x: number, z: number, footprint: number, seed: number, duration: number): void {
    if (this.bursts.length >= MAX_BURSTS) this.retire(this.bursts.shift()!);
    const rnd = hash(seed * 2654435761 + 17);
    const cloud = new ParticleCloud(DUST_PER_BURST, this.material);
    this.group.add(cloud.points);
    const dust = Array.from({ length: DUST_PER_BURST }, () => ({
      a: rnd() * Math.PI * 2,
      r: footprint * (0.15 + rnd() * 0.45),
      speed: 0.5 + rnd() * 1.5,
      rise: 0.5 + rnd() * 0.9,
      delay: rnd() * duration * 0.7,
      size: footprint * (0.55 + rnd() * 0.55),
    }));
    const wanted = Math.min(DEBRIS_PER_BURST, 12 + Math.round(footprint * 5));
    const debris: Debris[] = [];
    for (let i = 0; i < wanted && this.free.length > 0; i++) {
      const a = rnd() * Math.PI * 2;
      const r = footprint * 0.35 * rnd();
      const out = 1.5 + rnd() * 3 * (0.7 + footprint * 0.15);
      debris.push({
        slot: this.free.pop()!,
        delay: rnd() * duration * 0.8,
        p: new THREE.Vector3(x + Math.cos(a) * r, 0.6 + rnd() * 1.4, z + Math.sin(a) * r),
        v: new THREE.Vector3(Math.cos(a) * out, 2.5 + rnd() * 3.5, Math.sin(a) * out),
        spin: new THREE.Vector3((rnd() - 0.5) * 12, (rnd() - 0.5) * 12, (rnd() - 0.5) * 12),
        rot: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6),
        scale: new THREE.Vector3(0.1 + rnd() * 0.2, 0.07 + rnd() * 0.14, 0.1 + rnd() * 0.18),
        bounces: 0,
        resting: false,
      });
    }
    this.bursts.push({ cloud, age: 0, x, z, footprint, dust, debris });
  }

  private retire(b: Burst): void {
    this.group.remove(b.cloud.points);
    b.cloud.dispose();
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const d of b.debris) {
      this.debris.setMatrixAt(d.slot, hidden);
      this.free.push(d.slot);
    }
    this.debris.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    if (this.bursts.length === 0 || dt <= 0) return;
    for (let bi = this.bursts.length - 1; bi >= 0; bi--) {
      const b = this.bursts[bi]!;
      b.age += dt;
      if (b.age > DUST_LIFE_S + 0.9 && b.age > DEBRIS_LIFE_S + 1.4) {
        this.retire(b);
        this.bursts.splice(bi, 1);
        continue;
      }
      this.stepDust(b);
      this.stepDebris(b, dt);
    }
    this.debris.instanceMatrix.needsUpdate = true;
  }

  private stepDust(b: Burst): void {
    b.dust.forEach((p, i) => {
      const t = b.age - p.delay;
      if (t < 0) return b.cloud.hide(i);
      const life = DUST_LIFE_S;
      const u = Math.min(1, t / life);
      if (u >= 1) return b.cloud.hide(i);
      const drift = 1 - Math.exp(-1.6 * t);
      const r = p.r + p.speed * drift;
      const fade = Math.min(1, t * 6) * Math.pow(1 - u, 1.2);
      b.cloud.set(i, b.x + Math.cos(p.a) * r + t * 0.25, 0.25 + p.rise * (1 - Math.exp(-1.2 * t)) + u * 0.5, b.z + Math.sin(p.a) * r, p.size * (0.7 + 1.4 * Math.sqrt(u)), 0.5 * fade);
    });
    b.cloud.commit();
  }

  private stepDebris(b: Burst, dt: number): void {
    for (const d of b.debris) {
      const t = b.age - d.delay;
      if (t < 0) {
        this.dummy.scale.setScalar(0);
      } else {
        if (!d.resting) {
          d.v.y -= GRAVITY * dt;
          d.p.addScaledVector(d.v, dt);
          d.rot.x += d.spin.x * dt;
          d.rot.y += d.spin.y * dt;
          d.rot.z += d.spin.z * dt;
          if (d.p.y < 0.06) {
            d.p.y = 0.06;
            if (d.bounces < 2 && Math.abs(d.v.y) > 1.2) {
              d.v.y = -d.v.y * 0.35;
              d.v.x *= 0.6;
              d.v.z *= 0.6;
              d.spin.multiplyScalar(0.5);
              d.bounces++;
            } else {
              d.resting = true;
            }
          }
        }
        const fade = Math.min(1, Math.max(0, (DEBRIS_LIFE_S - t) / 0.7));
        this.dummy.position.copy(d.p);
        this.dummy.rotation.copy(d.rot);
        this.dummy.scale.copy(d.scale).multiplyScalar(fade);
      }
      this.dummy.updateMatrix();
      this.debris.setMatrixAt(d.slot, this.dummy.matrix);
    }
  }

  clear(): void {
    for (const b of this.bursts) this.retire(b);
    this.bursts.length = 0;
  }

  dispose(): void {
    this.clear();
    this.debris.dispose();
  }
}
