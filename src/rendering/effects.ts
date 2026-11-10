import * as THREE from "three";
import type { Projectile } from "../core/types";
import type { AssetLibrary } from "./assets";
import { arcHeight, ballisticPoint } from "./blast";
import { mergeParts } from "./merge";
import type { Materials } from "./models";
import { ParticleCloud, particleMaterial } from "./particles";

interface Flight {
  mesh: THREE.Mesh;
  active: boolean;
  start: number;
  duration: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  arc: number;
}

/** Flechas cosméticas: nacen de un evento de golpe ya resuelto por el núcleo y no afectan al estado. */
export class ArrowPool {
  readonly group = new THREE.Group();
  private readonly flights: Flight[] = [];
  private readonly look = new THREE.Vector3();
  private readonly next = new THREE.Vector3();

  constructor(assets: AssetLibrary, mat: Materials, size = 24) {
    const color = (m: THREE.Material & { color: THREE.Color }): number => m.color.getHex();
    const parts =
      assets.quality === "high"
        ? [
            { geometry: new THREE.CylinderGeometry(0.012, 0.012, 0.5, 4).rotateX(Math.PI / 2), color: color(mat.shaft) },
            { geometry: new THREE.ConeGeometry(0.035, 0.1, 4).rotateX(Math.PI / 2), position: [0, 0, 0.3] as const, color: color(mat.steel) },
            { geometry: new THREE.BoxGeometry(0.1, 0.005, 0.1), position: [0, 0, -0.22] as const, color: color(mat.feather) },
            { geometry: new THREE.BoxGeometry(0.005, 0.1, 0.1), position: [0, 0, -0.22] as const, color: color(mat.feather) },
          ]
        : [{ geometry: new THREE.BoxGeometry(0.03, 0.03, 0.6), color: color(mat.shaft) }];
    const geometry = assets.track(mergeParts(parts));
    parts.forEach((p) => p.geometry.dispose());
    const material = assets.lambert({ vertexColors: true });
    for (let i = 0; i < size; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.flights.push({ mesh, active: false, start: 0, duration: 1, from: new THREE.Vector3(), to: new THREE.Vector3(), arc: 0 });
    }
  }

  get active(): number {
    return this.flights.filter((f) => f.active).length;
  }

  spawn(from: THREE.Vector3, to: THREE.Vector3, now: number): void {
    const flight = this.flights.find((f) => !f.active);
    if (!flight) return;
    const distance = from.distanceTo(to);
    flight.active = true;
    flight.start = now;
    flight.duration = Math.min(0.6, Math.max(0.15, distance / 18));
    flight.from.copy(from);
    flight.to.copy(to);
    flight.arc = Math.min(1.3, 0.2 + distance * 0.07);
    flight.mesh.visible = true;
    this.place(flight, 0);
  }

  private point(flight: Flight, k: number, out: THREE.Vector3): THREE.Vector3 {
    out.lerpVectors(flight.from, flight.to, k);
    out.y += 4 * flight.arc * k * (1 - k);
    return out;
  }

  private place(flight: Flight, k: number): void {
    this.point(flight, k, flight.mesh.position);
    this.point(flight, Math.min(1, k + 0.04), this.next);
    this.look.copy(this.next);
    if (this.look.distanceToSquared(flight.mesh.position) > 1e-8) flight.mesh.lookAt(this.look);
  }

  update(now: number): void {
    for (const flight of this.flights) {
      if (!flight.active) continue;
      const k = (now - flight.start) / flight.duration;
      if (k >= 1) {
        flight.active = false;
        flight.mesh.visible = false;
        continue;
      }
      this.place(flight, Math.max(0, k));
    }
  }

  clear(): void {
    for (const flight of this.flights) {
      flight.active = false;
      flight.mesh.visible = false;
    }
  }
}

const BALL_SLOTS = 8;
const TRAIL_PER_BALL = 12;
const TRAIL_LIFE_S = 0.7;
const MUZZLE_HEIGHT = 0.7;
const BALL_RADIUS = 0.12;

interface Ball {
  id: number;
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  trailPos: Float32Array;
  trailAge: Float32Array;
  head: number;
  last: THREE.Vector3;
  hasLast: boolean;
}

/**
 * Balas de cañón. Su posición se deriva del estado (`state.projectiles`) con `k = (tick − launchTick + alpha) / vuelo`,
 * de modo que el dibujo coincide con el impacto lógico incluso con pausa o simulación acelerada; no altera el estado.
 */
export class CannonballPool {
  readonly group = new THREE.Group();
  private readonly balls: Ball[] = [];
  private readonly trail: ParticleCloud | null;
  private readonly point = { x: 0, y: 0, z: 0 };
  private readonly next = { x: 0, y: 0, z: 0 };
  private readonly look = new THREE.Vector3();

  constructor(assets: AssetLibrary) {
    const geometry = assets.track(new THREE.SphereGeometry(BALL_RADIUS, 12, 9));
    const material = assets.surface({ color: 0x23262b, metalness: 0.75, roughness: 0.38 });
    const shadowGeometry = assets.track(new THREE.CircleGeometry(0.2, 12).rotateX(-Math.PI / 2));
    const shadowMaterial = assets.basic({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false });
    this.trail = assets.quality === "high" ? new ParticleCloud(BALL_SLOTS * TRAIL_PER_BALL, particleMaterial(assets, "smoke")) : null;
    if (this.trail) this.group.add(this.trail.points);
    for (let i = 0; i < BALL_SLOTS; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
      mesh.visible = false;
      shadow.visible = false;
      shadow.position.y = 0.04;
      this.group.add(mesh, shadow);
      this.balls.push({ id: -1, mesh, shadow, trailPos: new Float32Array(TRAIL_PER_BALL * 3), trailAge: new Float32Array(TRAIL_PER_BALL).fill(Infinity), head: 0, last: new THREE.Vector3(), hasLast: false });
    }
  }

  /** Balas visibles en este momento. */
  get active(): number {
    return this.balls.filter((b) => b.mesh.visible).length;
  }

  /** Coloca las balas según los proyectiles del estado y el instante dentro del tick actual. */
  sync(projectiles: readonly Projectile[], tick: number, alpha: number): void {
    const wanted = new Set(projectiles.map((p) => p.id));
    for (const ball of this.balls) {
      if (ball.id !== -1 && !wanted.has(ball.id)) {
        ball.id = -1;
        ball.mesh.visible = false;
        ball.shadow.visible = false;
        ball.hasLast = false;
      }
    }
    for (const p of projectiles) {
      let ball = this.balls.find((b) => b.id === p.id);
      if (!ball) {
        ball = this.balls.find((b) => b.id === -1);
        if (!ball) continue;
        ball.id = p.id;
      }
      const flight = Math.max(1, p.impactTick - p.launchTick);
      const k = Math.min(1, Math.max(0, (tick - p.launchTick + alpha) / flight));
      const distance = Math.hypot(p.to.x - p.from.x, p.to.z - p.from.z);
      const peak = arcHeight(distance);
      ballisticPoint(p.from, p.to, MUZZLE_HEIGHT, peak, k, this.point);
      ballisticPoint(p.from, p.to, MUZZLE_HEIGHT, peak, Math.min(1, k + 0.03), this.next);
      ball.mesh.visible = true;
      ball.mesh.position.set(this.point.x, this.point.y, this.point.z);
      this.look.set(this.next.x, this.next.y, this.next.z);
      if (this.look.distanceToSquared(ball.mesh.position) > 1e-9) ball.mesh.lookAt(this.look);
      ball.mesh.scale.set(1, 1, 1.5);
      ball.shadow.visible = true;
      ball.shadow.position.set(this.point.x, 0.04, this.point.z);
      ball.shadow.scale.setScalar(Math.max(0.35, 1.2 - this.point.y * 0.35));
      this.emit(ball);
    }
  }

  private emit(ball: Ball): void {
    if (!this.trail) return;
    if (ball.hasLast && ball.mesh.position.distanceToSquared(ball.last) < 0.18 * 0.18) return;
    ball.last.copy(ball.mesh.position);
    ball.hasLast = true;
    ball.trailPos[ball.head * 3] = ball.last.x;
    ball.trailPos[ball.head * 3 + 1] = ball.last.y;
    ball.trailPos[ball.head * 3 + 2] = ball.last.z;
    ball.trailAge[ball.head] = 0;
    ball.head = (ball.head + 1) % TRAIL_PER_BALL;
  }

  /** Envejece la estela de humo; con dt = 0 (pausa) no avanza. */
  update(dt: number): void {
    const trail = this.trail;
    if (!trail) return;
    this.balls.forEach((ball, slot) => {
      for (let i = 0; i < TRAIL_PER_BALL; i++) {
        const index = slot * TRAIL_PER_BALL + i;
        ball.trailAge[i]! += dt;
        const age = ball.trailAge[i]!;
        if (age >= TRAIL_LIFE_S) trail.hide(index);
        else trail.set(index, ball.trailPos[i * 3]!, ball.trailPos[i * 3 + 1]!, ball.trailPos[i * 3 + 2]!, 0.16 + 0.5 * age, 0.4 * (1 - age / TRAIL_LIFE_S));
      }
    });
    trail.commit();
  }

  clear(): void {
    for (const ball of this.balls) {
      ball.id = -1;
      ball.mesh.visible = false;
      ball.shadow.visible = false;
      ball.hasLast = false;
      ball.trailAge.fill(Infinity);
    }
    this.update(0);
  }
}
