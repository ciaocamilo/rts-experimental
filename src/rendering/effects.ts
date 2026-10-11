import * as THREE from "three";
import type { AssetLibrary } from "./assets";
import { mergeParts } from "./merge";
import type { Materials } from "./models";

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
