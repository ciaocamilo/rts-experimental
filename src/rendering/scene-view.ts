import * as THREE from "three";
import { BALANCE, type BuildingKind } from "../content/balance";
import type { GameState } from "../core/types";
import type { CameraRig } from "../input/camera-rig";

const OWNER_COLORS = [0x3b82f6, 0xef4444] as const;
const CAMERA_OFFSET = new THREE.Vector3(60, 70, 60);
const MARKER_MS = 600;

/** Refleja el GameState en una escena Three.js; no decide reglas ni conserva estado de negocio. */
export class SceneView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly meshes = new Map<number, THREE.Mesh>();
  private readonly rings = new Map<number, THREE.Mesh>();
  private readonly bars = new Map<number, { group: THREE.Group; fill: THREE.Mesh }>();
  private readonly barGeometry = new THREE.PlaneGeometry(1, 0.14);
  private readonly barBackMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.75, depthTest: false });
  private readonly barFillMaterial = new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, depthTest: false });
  private readonly disposables: { dispose(): void }[] = [];
  private readonly mapSize: number;
  private readonly viewHeight = 68;
  private readonly canvas: HTMLCanvasElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ringGeometry: THREE.RingGeometry;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly inspectMaterial: THREE.MeshBasicMaterial;
  private readonly marker: THREE.Mesh;
  private readonly ghost: THREE.Mesh;
  private readonly ghostMaterial: THREE.MeshBasicMaterial;
  private readonly teamMarks: { geometry: THREE.BufferGeometry; material: THREE.Material }[];
  private markerStart = -Infinity;
  private terrainGroup = new THREE.Group();
  private terrainVersion = -1;
  private selected: ReadonlySet<number> = new Set();
  private inspected: number | null = null;

  constructor(canvas: HTMLCanvasElement, mapSize: number, private readonly rig: CameraRig) {
    this.canvas = canvas;
    this.mapSize = mapSize;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(1);
    this.scene.background = new THREE.Color(0x1b2430);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(40, 80, 20);
    this.scene.add(sun);

    this.ringGeometry = this.track(new THREE.RingGeometry(0.42, 0.52, 20).rotateX(-Math.PI / 2));
    this.ringMaterial = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.inspectMaterial = this.track(new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    const markerMaterial = this.track(new THREE.MeshBasicMaterial({ color: 0x7CFC00, transparent: true }));
    this.marker = new THREE.Mesh(this.track(new THREE.RingGeometry(0.5, 0.65, 24).rotateX(-Math.PI / 2)), markerMaterial);
    this.marker.visible = false;
    this.ghostMaterial = this.track(new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.5, depthWrite: false }));
    this.ghost = new THREE.Mesh(this.track(new THREE.BoxGeometry(1, 1, 1)), this.ghostMaterial);
    this.ghost.visible = false;
    this.scene.add(this.marker, this.ghost, this.terrainGroup);
    // Marca de bando independiente del color: disco blanco para el jugador, rombo oscuro para el rival (RF-10).
    this.teamMarks = [
      { geometry: this.track(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 14)), material: this.track(new THREE.MeshBasicMaterial({ color: 0xffffff })) },
      { geometry: this.track(new THREE.BoxGeometry(0.34, 0.1, 0.34).rotateY(Math.PI / 4)), material: this.track(new THREE.MeshBasicMaterial({ color: 0x111111 })) },
    ];

    this.buildGround();
    this.resize();
    this.applyRig();
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.disposables.push(resource);
    return resource;
  }

  private buildGround(): void {
    const size = this.mapSize;
    const geometry = this.track(new THREE.PlaneGeometry(size, size));
    const material = this.track(new THREE.MeshLambertMaterial({ color: 0x3f6b3a }));
    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(size / 2, 0, size / 2);
    this.scene.add(ground);

    const grid = new THREE.GridHelper(size, size, 0x2f522b, 0x2f522b);
    grid.position.set(size / 2, 0.01, size / 2);
    this.track(grid.geometry);
    this.track(grid.material as THREE.Material);
    this.scene.add(grid);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const half = this.viewHeight / 2;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
  }

  /** Crea, actualiza y elimina mallas para coincidir con el estado lógico. */
  sync(state: GameState): void {
    const live = new Set<number>();

    for (const n of state.resourceNodes) {
      live.add(n.id);
      const mesh = this.meshes.get(n.id) ?? this.addMesh(n.id, this.nodeMesh(n.kind));
      mesh.position.set(n.cell.x + 0.5, mesh.userData["h"] / 2, n.cell.z + 0.5);
      mesh.visible = n.remaining > 0;
    }
    for (const b of state.buildings) {
      live.add(b.id);
      const mesh = this.meshes.get(b.id) ?? this.addMesh(b.id, this.buildingMesh(b.kind, b.owner));
      const w = BALANCE.buildings[b.kind].footprint;
      const progress = b.complete ? 1 : b.buildDone / BALANCE.buildings[b.kind].buildTicks;
      const material = mesh.material as THREE.MeshLambertMaterial;
      // Una obra se dibuja translúcida y crece con el trabajo acumulado.
      material.transparent = !b.complete;
      material.opacity = b.complete ? 1 : 0.45;
      const scaleY = b.complete ? 1 : 0.25 + 0.75 * progress;
      mesh.scale.y = scaleY;
      const mark = mesh.userData["mark"] as THREE.Mesh;
      mark.scale.y = 1 / scaleY;
      mark.position.y = mesh.userData["h"] / 2 + 0.12 / scaleY;
      mesh.position.set(b.cell.x + w / 2, (mesh.userData["h"] * scaleY) / 2, b.cell.z + w / 2);
      this.syncBar(b.id, mesh.position.x, mesh.userData["h"] * scaleY + 0.35, mesh.position.z, w * 0.9, b.complete ? b.hp : BALANCE.buildings[b.kind].hp, BALANCE.buildings[b.kind].hp);
    }
    for (const u of state.units) {
      live.add(u.id);
      const mesh = this.meshes.get(u.id) ?? this.addMesh(u.id, this.unitMesh(u.kind, u.owner));
      mesh.position.set(u.pos.x, mesh.userData["h"] / 2, u.pos.z);
      this.syncBar(u.id, u.pos.x, mesh.userData["h"] + 0.35, u.pos.z, 0.9, u.hp, BALANCE.units[u.kind].hp);
    }

    for (const [id, mesh] of this.meshes) {
      if (!live.has(id)) {
        this.scene.remove(mesh);
        this.disposeMesh(mesh);
        this.meshes.delete(id);
      }
    }
    for (const [id, bar] of this.bars) {
      if (!live.has(id)) {
        this.scene.remove(bar.group);
        this.bars.delete(id);
      }
    }

    this.syncTerrain(state);
    this.syncRings();
  }

  /** Barra de vida orientada a la cámara; solo se muestra en entidades dañadas. */
  private syncBar(id: number, x: number, y: number, z: number, width: number, hp: number, max: number): void {
    let bar = this.bars.get(id);
    if (hp >= max) {
      if (bar) bar.group.visible = false;
      return;
    }
    if (!bar) {
      const group = new THREE.Group();
      const back = new THREE.Mesh(this.barGeometry, this.barBackMaterial);
      const fill = new THREE.Mesh(this.barGeometry, this.barFillMaterial);
      back.renderOrder = 10;
      fill.renderOrder = 11;
      fill.position.z = 0.001;
      group.add(back, fill);
      this.scene.add(group);
      bar = { group, fill };
      this.bars.set(id, bar);
    }
    const ratio = Math.max(0, Math.min(1, hp / max));
    bar.group.visible = true;
    bar.group.position.set(x, y, z);
    bar.group.quaternion.copy(this.camera.quaternion);
    bar.group.scale.set(width, 1, 1);
    bar.fill.scale.set(ratio, 0.8, 1);
    bar.fill.position.x = -(1 - ratio) / 2;
  }

  private syncTerrain(state: GameState): void {
    if (state.obstacleVersion === this.terrainVersion) return;
    this.terrainVersion = state.obstacleVersion;
    for (const child of this.terrainGroup.children as THREE.Mesh[]) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
    this.terrainGroup.clear();
    for (const t of state.terrain) {
      const mesh = this.make(new THREE.BoxGeometry(t.w, 1.5, t.h), 0x6b6f76, 1.5);
      mesh.position.set(t.x + t.w / 2, 0.75, t.z + t.h / 2);
      this.terrainGroup.add(mesh);
    }
  }

  /** Marca la selección actual; los anillos siguen a sus mallas en cada sincronización. */
  setSelection(selected: ReadonlySet<number>, inspected: number | null): void {
    this.selected = selected;
    this.inspected = inspected;
  }

  private syncRings(): void {
    const wanted = new Set<number>(this.selected);
    if (this.inspected !== null) wanted.add(this.inspected);
    for (const [id, ring] of this.rings) {
      if (!wanted.has(id) || !this.meshes.has(id)) {
        this.scene.remove(ring);
        this.rings.delete(id);
      }
    }
    for (const id of wanted) {
      const mesh = this.meshes.get(id);
      if (!mesh) continue;
      let ring = this.rings.get(id);
      if (!ring) {
        ring = new THREE.Mesh(this.ringGeometry, id === this.inspected ? this.inspectMaterial : this.ringMaterial);
        this.rings.set(id, ring);
        this.scene.add(ring);
      }
      ring.material = id === this.inspected ? this.inspectMaterial : this.ringMaterial;
      const scale = Math.max(1, (mesh.userData["footprint"] ?? 1) * 1.1);
      ring.scale.set(scale, 1, scale);
      ring.position.set(mesh.position.x, 0.05, mesh.position.z);
    }
  }

  /** Marcador breve en el punto ordenado: feedback visual inmediato (RNF-03). */
  showMarker(x: number, z: number): void {
    this.marker.position.set(x, 0.06, z);
    this.markerStart = performance.now();
    this.marker.visible = true;
  }

  /** Fantasma de colocación; la validez la decide el núcleo, aquí solo se colorea. */
  showGhost(kind: BuildingKind, cellX: number, cellZ: number, valid: boolean): void {
    const w = BALANCE.buildings[kind].footprint;
    const h = kind === "barracks" ? 1.6 : 1.2;
    this.ghost.scale.set(w, h, w);
    this.ghost.position.set(cellX + w / 2, h / 2, cellZ + w / 2);
    this.ghostMaterial.color.setHex(valid ? 0x4ade80 : 0xf87171);
    this.ghost.visible = true;
  }

  hideGhost(): void {
    this.ghost.visible = false;
  }

  private applyRig(): void {
    this.camera.position.set(this.rig.x + CAMERA_OFFSET.x, CAMERA_OFFSET.y, this.rig.z + CAMERA_OFFSET.z);
    this.camera.lookAt(this.rig.x, 0, this.rig.z);
    this.camera.zoom = this.rig.zoom;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  private ndc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  /** ID de la entidad bajo el cursor, o null. */
  pickEntity(clientX: number, clientY: number): number | null {
    return this.pickEntities(clientX, clientY)[0] ?? null;
  }

  /** IDs de todas las entidades bajo el cursor, de la más cercana a la más lejana. */
  pickEntities(clientX: number, clientY: number): number[] {
    this.applyRig();
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const candidates = [...this.meshes.values()].filter((m) => m.visible);
    return this.raycaster.intersectObjects(candidates, false).map((h) => h.object.userData["id"] as number);
  }

  /** Punto del suelo (plano XZ) bajo el cursor, o null si queda fuera del mapa. */
  groundPoint(clientX: number, clientY: number): { x: number; z: number } | null {
    this.applyRig();
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const point = this.raycaster.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
    if (!point || point.x < 0 || point.z < 0 || point.x > this.mapSize || point.z > this.mapSize) return null;
    return { x: point.x, z: point.z };
  }

  /** Posición en píxeles de cliente de un punto del mundo. */
  screenPosition(x: number, y: number, z: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  private addMesh(id: number, mesh: THREE.Mesh): THREE.Mesh {
    mesh.userData["id"] = id;
    this.meshes.set(id, mesh);
    this.scene.add(mesh);
    return mesh;
  }

  private make(geometry: THREE.BufferGeometry, color: number, height: number): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color }));
    mesh.userData["h"] = height;
    return mesh;
  }

  private disposeMesh(mesh: THREE.Mesh): void {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }

  private nodeMesh(kind: "food" | "wood"): THREE.Mesh {
    return kind === "wood"
      ? this.make(new THREE.ConeGeometry(0.4, 1.4, 6), 0x1f5a2a, 1.4)
      : this.make(new THREE.SphereGeometry(0.4, 8, 6), 0xd9a441, 0.8);
  }

  private buildingMesh(kind: "townCenter" | "house" | "barracks", owner: 0 | 1): THREE.Mesh {
    const w = BALANCE.buildings[kind].footprint * 0.9;
    const h = kind === "townCenter" ? 2.4 : kind === "barracks" ? 1.6 : 1.2;
    const mesh = this.make(new THREE.BoxGeometry(w, h, w), OWNER_COLORS[owner], h);
    mesh.userData["footprint"] = BALANCE.buildings[kind].footprint;
    this.attachMark(mesh, owner, BALANCE.buildings[kind].footprint * 0.5);
    return mesh;
  }

  private unitMesh(kind: "villager" | "soldier" | "archer", owner: 0 | 1): THREE.Mesh {
    const r = BALANCE.units[kind].radius;
    // La forma distingue el tipo y la marca superior distingue el bando.
    const geometry =
      kind === "villager" ? new THREE.CylinderGeometry(r, r, 0.8, 10) : kind === "soldier" ? new THREE.BoxGeometry(r * 2, 0.9, r * 2) : new THREE.ConeGeometry(r, 0.9, 8);
    const mesh = this.make(geometry, OWNER_COLORS[owner], 0.9);
    this.attachMark(mesh, owner, 1);
    return mesh;
  }

  private attachMark(mesh: THREE.Mesh, owner: 0 | 1, size: number): void {
    const { geometry, material } = this.teamMarks[owner]!;
    const mark = new THREE.Mesh(geometry, material);
    mark.scale.set(size, 1, size);
    mark.position.y = mesh.userData["h"] / 2 + 0.12;
    mesh.add(mark);
    mesh.userData["mark"] = mark;
  }

  render(): void {
    this.applyRig();
    if (this.marker.visible) {
      const t = (performance.now() - this.markerStart) / MARKER_MS;
      if (t >= 1) this.marker.visible = false;
      else {
        this.marker.scale.setScalar(1.4 - 0.4 * t);
        (this.marker.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Nombre de la GPU activa si el navegador lo expone (RNF-05). */
  gpuInfo(): string {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const mesh of this.meshes.values()) this.disposeMesh(mesh);
    for (const child of this.terrainGroup.children as THREE.Mesh[]) this.disposeMesh(child);
    this.meshes.clear();
    this.rings.clear();
    this.bars.clear();
    this.barGeometry.dispose();
    this.barBackMaterial.dispose();
    this.barFillMaterial.dispose();
    this.renderer.dispose();
  }
}
