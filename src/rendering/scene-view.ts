import * as THREE from "three";
import { BALANCE, type BuildingKind, type ResourceKind, TICKS_PER_SECOND, type UnitKind } from "../content/balance";
import type { Building, BuildingDestroyedEvent, GameState, ResourceNode, StrikeEvent, Unit } from "../core/types";
import type { CameraRig } from "../input/camera-rig";
import { AssetLibrary, type Quality } from "./assets";
import { applyConstruction, type BuildingRig, buildBuilding, GeometryCache } from "./buildings";
import { ArrowPool } from "./effects";
import { type FlameRig, FlameFactory, updateFlames } from "./fire";
import { barState, flameCount } from "./health";
import { buildBushGeometries, buildTreeGeometries, Materials, VISUAL } from "./models";
import { NodeFactory, type NodeRig, setNodeSpent } from "./nodes";
import { computePose, deathPose, deathState, type WorkKind } from "./pose";
import { TerrainView } from "./terrain-view";
import { applyDeath, applyPose, UnitFactory, type UnitRig } from "./units";

const CAMERA_OFFSET = new THREE.Vector3(60, 70, 60);
const MARKER_MS = 600;
const SMOOTH_RATE = 16;
const YAW_RATE = 12;
const MOVE_HOLD = 0.14;
const SNAP_DISTANCE = 3;
const FADE_BEHIND = 2.8;
const FADE_SIDE = 0.65;
const SQRT1_2 = Math.SQRT1_2;
/** Máximo de cuerpos retenidos a la vez (P2-H09 CA04). */
const MAX_BODIES = 64;

export type StrikeLike = StrikeEvent & { id: number };
export type DestroyedLike = BuildingDestroyedEvent & { seq: number };

/** Altura del punto de disparo de la torre sobre el suelo (la plataforma bajo el tejado). */
const TOWER_MUZZLE_Y = 2.9;
/** Duración del colapso de un edificio: entre 0,8 s (obra sin terminar) y 1,5 s (centro urbano). */
const COLLAPSE_MIN_S = 0.8;
const COLLAPSE_PER_CELL_S = 0.15;
const DUST_PUFFS = 7;

export interface SyncContext {
  /** Pausa o fin de partida: detiene el tiempo de animación (RF-08). */
  frozen: boolean;
  /** Solo pausa; el colapso del último edificio debe poder completarse tras el fin de la partida. */
  paused?: boolean;
  /** Golpes recientes del núcleo; solo se procesan los nuevos. */
  strikes: readonly StrikeLike[];
  /** Edificios retirados recientemente; cada uno inicia su colapso una sola vez. */
  destroyed?: readonly DestroyedLike[];
}

/** Edificio ya retirado del estado que aún se está derrumbando; es solo visual. */
interface Collapse {
  rig: BuildingRig;
  baseX: number;
  elapsed: number;
  duration: number;
  tilt: number;
  footprint: number;
  puffs: THREE.Mesh[];
  dust: THREE.MeshBasicMaterial;
}

interface Base {
  root: THREE.Object3D;
  proxy: THREE.Mesh;
  hp: number;
  max: number;
  barWidth: number;
  barY: number;
  ringScale: number;
  pickable: boolean;
}
interface UnitEntry extends Base {
  type: "unit";
  rig: UnitRig;
  kind: UnitKind;
  sim: { x: number; z: number };
  pos: { x: number; z: number };
  yaw: number;
  heading: number;
  moveUntil: number;
  strikeAt: number;
  work: WorkKind | null;
  carry: ResourceKind | null;
  phase: number;
}
interface BuildingEntry extends Base {
  type: "building";
  rig: BuildingRig;
  key: string;
  complete: boolean;
  flames: FlameRig | null;
  kind: BuildingKind;
  phase: number;
}
/** Figura de una unidad caída: solo visual, ya no forma parte de las entidades del estado. */
interface Body {
  rig: UnitRig;
  diedAt: number;
}
interface NodeEntry extends Base {
  type: "node";
  rig: NodeRig;
  spent: boolean;
  faded: boolean;
  x: number;
  z: number;
}
type Entry = UnitEntry | BuildingEntry | NodeEntry;

interface Bar {
  group: THREE.Group;
  fill: THREE.Mesh;
}

/** Refleja el GameState en una escena Three.js; no decide reglas ni conserva estado de negocio. */
export class SceneView {
  readonly quality: Quality;
  /** Avisos de diagnóstico del renderizador (por ejemplo, vida máxima inválida). */
  readonly warnings: string[] = [];
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly assets: AssetLibrary;
  private readonly mat: Materials;
  private readonly units: UnitFactory;
  private readonly buildingGeometry: GeometryCache;
  private readonly buildingProxyMaterial: THREE.MeshBasicMaterial;
  private readonly nodes: NodeFactory;
  private readonly terrain: TerrainView;
  private readonly arrows: ArrowPool;
  private readonly entityRoot = new THREE.Group();
  private readonly entries = new Map<number, Entry>();
  private bodies: Body[] = [];
  private collapses: Collapse[] = [];
  private readonly dustGeometry: THREE.SphereGeometry;
  private lastDestroyedSeq = 0;
  private fxPaused = false;
  private readonly flameFactory: FlameFactory;
  private readonly bars = new Map<number, Bar>();
  private readonly rings = new Map<number, THREE.Mesh>();
  private readonly barGeometry: THREE.PlaneGeometry;
  private readonly barBack: THREE.MeshBasicMaterial;
  private readonly barFills: readonly [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial, THREE.MeshBasicMaterial];
  private readonly disposables: { dispose(): void }[] = [];
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
  private readonly nodeById = new Map<number, ResourceNode>();
  private readonly buildingById = new Map<number, Building>();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private mapWidth: number;
  private mapDepth: number;
  private markerStart = -Infinity;
  private terrainKey = "";
  private selected: ReadonlySet<number> = new Set();
  private inspected: number | null = null;
  private animTime = 0;
  private lastRender: number | null = null;
  private frozen = false;
  private lastStrikeId = 0;
  private readonly invalidBars = new Set<number>();

  constructor(canvas: HTMLCanvasElement, mapWidth: number, mapDepth: number, private readonly rig: CameraRig, quality: Quality = "high") {
    this.canvas = canvas;
    this.mapWidth = mapWidth;
    this.mapDepth = mapDepth;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === "high", stencil: true });
    this.renderer.setPixelRatio(1);
    this.scene.background = new THREE.Color(0x203420);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 700);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x3a5a2a, 0.45));
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.15);
    sun.position.set(-25, 80, 60);
    this.scene.add(sun);

    this.assets = new AssetLibrary(quality);
    this.mat = new Materials(this.assets);
    const trees = buildTreeGeometries(this.assets);
    const bushes = buildBushGeometries(this.assets);
    this.units = new UnitFactory(this.assets, this.mat);
    this.buildingGeometry = new GeometryCache(this.assets);
    this.buildingProxyMaterial = this.assets.basic({ visible: false });
    this.nodes = new NodeFactory(this.assets, this.mat, trees);
    this.terrain = new TerrainView(this.assets, this.mat, trees, bushes);
    this.arrows = new ArrowPool(this.assets, this.mat);
    this.flameFactory = new FlameFactory(this.assets);
    this.dustGeometry = this.track(new THREE.SphereGeometry(0.5, 6, 5));

    this.barGeometry = this.track(new THREE.PlaneGeometry(1, 0.14));
    this.barBack = this.track(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.75, depthTest: false }));
    const fill = (color: number): THREE.MeshBasicMaterial => this.track(new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false }));
    this.barFills = [fill(0x4ade80), fill(0xfacc15), fill(0xef4444)];

    this.ringGeometry = this.track(new THREE.RingGeometry(0.42, 0.52, 20).rotateX(-Math.PI / 2));
    this.ringMaterial = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.inspectMaterial = this.track(new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    const markerMaterial = this.track(new THREE.MeshBasicMaterial({ color: 0x7cfc00, transparent: true }));
    this.marker = new THREE.Mesh(this.track(new THREE.RingGeometry(0.5, 0.65, 24).rotateX(-Math.PI / 2)), markerMaterial);
    this.marker.visible = false;
    this.ghostMaterial = this.track(new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.5, depthWrite: false }));
    this.ghost = new THREE.Mesh(this.track(new THREE.BoxGeometry(1, 1, 1)), this.ghostMaterial);
    this.ghost.visible = false;
    this.scene.add(this.terrain.group, this.entityRoot, this.arrows.group, this.marker, this.ghost);

    this.resize();
    this.applyRig();
  }

  private track<T extends { dispose(): void }>(resource: T): T {
    this.disposables.push(resource);
    return resource;
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

  /** Descarta las entidades dibujadas, por ejemplo al reiniciar la partida. */
  reset(): void {
    for (const [id, entry] of [...this.entries]) this.removeEntry(id, entry);
    for (const body of this.bodies) this.entityRoot.remove(body.rig.root);
    this.bodies = [];
    for (const c of this.collapses) this.finishCollapse(c);
    this.collapses = [];
    this.lastDestroyedSeq = 0;
    for (const bar of this.bars.values()) this.entityRoot.remove(bar.group);
    this.bars.clear();
    for (const ring of this.rings.values()) this.scene.remove(ring);
    this.rings.clear();
    this.arrows.clear();
    this.lastStrikeId = 0;
    this.invalidBars.clear();
  }

  private removeEntry(id: number, entry: Entry): void {
    this.entityRoot.remove(entry.root);
    this.entries.delete(id);
  }

  /** La unidad dejó de existir en el estado: su figura queda como cuerpo cosmético (P2-H09). */
  private layDown(entry: UnitEntry): void {
    entry.proxy.visible = false;
    this.bodies.push({ rig: entry.rig, diedAt: this.animTime });
    while (this.bodies.length > MAX_BODIES) this.entityRoot.remove(this.bodies.shift()!.rig.root);
  }

  /** Crea, actualiza y elimina modelos para coincidir con el estado lógico. */
  sync(state: GameState, ctx: SyncContext = { frozen: false, strikes: [] }): void {
    this.frozen = ctx.frozen;
    this.fxPaused = ctx.paused ?? ctx.frozen;
    this.mapWidth = state.mapWidth;
    this.mapDepth = state.mapDepth;
    this.syncTerrain(state);

    this.nodeById.clear();
    this.buildingById.clear();
    for (const n of state.resourceNodes) this.nodeById.set(n.id, n);
    for (const b of state.buildings) this.buildingById.set(b.id, b);

    const live = new Set<number>();
    for (const n of state.resourceNodes) {
      live.add(n.id);
      this.syncNode(n);
    }
    for (const b of state.buildings) {
      live.add(b.id);
      this.syncBuilding(b);
    }
    for (const u of state.units) {
      live.add(u.id);
      this.syncUnit(u);
    }
    const collapsing = new Set<number>();
    for (const event of ctx.destroyed ?? []) {
      if (event.seq <= this.lastDestroyedSeq) continue;
      this.lastDestroyedSeq = event.seq;
      collapsing.add(event.id);
    }
    for (const [id, entry] of [...this.entries]) {
      if (live.has(id)) continue;
      if (entry.type === "unit") {
        this.layDown(entry);
        this.entries.delete(id);
      } else if (entry.type === "building" && collapsing.has(id)) {
        this.beginCollapse(entry);
        this.entries.delete(id);
      } else this.removeEntry(id, entry);
    }
    for (const [id, bar] of this.bars) {
      if (!live.has(id)) {
        this.entityRoot.remove(bar.group);
        this.bars.delete(id);
      }
    }

    this.consumeStrikes(ctx.strikes);
  }

  private syncTerrain(state: GameState): void {
    const key = `${state.mapWidth}x${state.mapDepth}:${state.terrain.length}`;
    if (key === this.terrainKey) return;
    this.terrainKey = key;
    this.terrain.build(state.mapWidth, state.mapDepth, state.terrain);
  }

  private syncNode(n: ResourceNode): void {
    let entry = this.entries.get(n.id) as NodeEntry | undefined;
    if (!entry) {
      const rig = this.nodes.create(n.kind, n.id);
      rig.root.position.set(n.cell.x + 0.5, 0, n.cell.z + 0.5);
      rig.proxy.userData["id"] = n.id;
      this.entityRoot.add(rig.root);
      entry = { type: "node", rig, root: rig.root, proxy: rig.proxy, hp: 0, max: 0, barWidth: 0, barY: 0, ringScale: 1, pickable: true, spent: false, faded: false, x: n.cell.x + 0.5, z: n.cell.z + 0.5 };
      this.entries.set(n.id, entry);
    }
    const spent = n.remaining <= 0;
    if (spent !== entry.spent) {
      entry.spent = spent;
      setNodeSpent(entry.rig, spent);
    }
    entry.pickable = !spent;
  }

  private syncBuilding(b: Building): void {
    const def = BALANCE.buildings[b.kind];
    let entry = this.entries.get(b.id) as BuildingEntry | undefined;
    if (!entry) {
      const rig = buildBuilding(b.kind, b.owner, this.mat, this.buildingGeometry, this.buildingProxyMaterial, def.footprint);
      rig.root.position.set(b.cell.x + def.footprint / 2, 0, b.cell.z + def.footprint / 2);
      rig.proxy.userData["id"] = b.id;
      this.entityRoot.add(rig.root);
      entry = {
        type: "building",
        rig,
        key: "",
        root: rig.root,
        proxy: rig.proxy,
        hp: b.hp,
        max: def.hp,
        barWidth: def.footprint * 0.9,
        barY: VISUAL.buildingHeight[b.kind] + 0.25,
        ringScale: Math.max(1, def.footprint * 1.1),
        pickable: true,
        complete: b.complete,
        flames: null,
        kind: b.kind,
        phase: b.id,
      };
      this.entries.set(b.id, entry);
    }
    const progress = b.complete || def.buildTicks <= 0 ? 1 : b.buildDone / def.buildTicks;
    const key = `${b.complete}:${Math.round(progress * 100)}`;
    if (key !== entry.key) {
      entry.key = key;
      applyConstruction(entry.rig, b.complete, progress);
    }
    entry.hp = b.hp;
    entry.complete = b.complete;
  }

  private syncUnit(u: Unit): void {
    const def = BALANCE.units[u.kind];
    let entry = this.entries.get(u.id) as UnitEntry | undefined;
    if (!entry) {
      const rig = this.units.create(u.kind, u.owner, this.quality === "high");
      rig.proxy.userData["id"] = u.id;
      rig.root.position.set(u.pos.x, 0, u.pos.z);
      this.entityRoot.add(rig.root);
      const yaw = u.owner === 0 ? Math.PI * 0.75 : -Math.PI * 0.25;
      entry = {
        type: "unit",
        rig,
        kind: u.kind,
        root: rig.root,
        proxy: rig.proxy,
        hp: u.hp,
        max: def.hp,
        barWidth: 0.9,
        barY: VISUAL.unitHeight + VISUAL.barOffset,
        ringScale: 1,
        pickable: true,
        sim: { x: u.pos.x, z: u.pos.z },
        pos: { x: u.pos.x, z: u.pos.z },
        yaw,
        heading: yaw,
        moveUntil: -Infinity,
        strikeAt: -Infinity,
        work: null,
        carry: null,
        phase: (u.id % 17) * 0.37,
      };
      this.entries.set(u.id, entry);
    }
    entry.hp = u.hp;

    const dx = u.pos.x - entry.sim.x;
    const dz = u.pos.z - entry.sim.z;
    if (dx * dx + dz * dz > 1e-8) {
      entry.heading = Math.atan2(dx, dz);
      entry.moveUntil = this.animTime + MOVE_HOLD;
    }
    entry.sim.x = u.pos.x;
    entry.sim.z = u.pos.z;

    let work: WorkKind | null = null;
    let tool: "axe" | "hammer" | null = null;
    const job = u.job;
    if (job?.type === "gather") {
      const node = this.nodeById.get(job.nodeId);
      if (node) {
        if (node.kind === "wood" || node.kind === "stone") tool = "axe";
        if (job.stage === "harvest") {
          work = node.kind;
          entry.heading = Math.atan2(node.cell.x + 0.5 - u.pos.x, node.cell.z + 0.5 - u.pos.z);
        }
      }
    } else if (job?.type === "build") {
      tool = "hammer";
      const site = this.buildingById.get(job.siteId);
      if (site && job.stage === "work") {
        work = "build";
        const half = BALANCE.buildings[site.kind].footprint / 2;
        entry.heading = Math.atan2(site.cell.x + half - u.pos.x, site.cell.z + half - u.pos.z);
      }
    }
    entry.work = work;
    entry.carry = u.carry && u.carry.amount > 0 ? u.carry.kind : null;
    const { axe, hammer } = entry.rig.tools;
    if (axe) axe.visible = tool === "axe";
    if (hammer) hammer.visible = tool === "hammer";
    entry.rig.bundleWood.visible = entry.carry === "wood";
    entry.rig.bundleFood.visible = entry.carry === "food";
    entry.rig.bundleStone.visible = entry.carry === "stone";
  }

  private consumeStrikes(strikes: readonly StrikeLike[]): void {
    for (const strike of strikes) {
      if (strike.id <= this.lastStrikeId) continue;
      this.lastStrikeId = strike.id;
      const attacker = this.entries.get(strike.attackerId);
      if (attacker?.type === "unit") {
        attacker.strikeAt = this.animTime;
        attacker.heading = Math.atan2(strike.to.x - strike.from.x, strike.to.z - strike.from.z);
      }
      if (strike.attackerKind === "archer" || strike.attackerKind === "tower") {
        const target = this.entries.get(strike.targetId);
        const targetHeight = target?.type === "building" ? 0.9 : 0.6;
        this.tmpA.set(strike.from.x, strike.attackerKind === "tower" ? TOWER_MUZZLE_Y : 0.75, strike.from.z);
        this.tmpB.set(strike.to.x, targetHeight, strike.to.z);
        this.arrows.spawn(this.tmpA, this.tmpB, this.animTime);
      }
    }
  }

  /** Marca la selección actual; los anillos siguen a sus modelos en cada fotograma. */
  setSelection(selected: ReadonlySet<number>, inspected: number | null): void {
    this.selected = selected;
    this.inspected = inspected;
  }

  private syncRings(): void {
    const wanted = new Set<number>(this.selected);
    if (this.inspected !== null) wanted.add(this.inspected);
    for (const [id, ring] of this.rings) {
      if (!wanted.has(id) || !this.entries.has(id)) {
        this.scene.remove(ring);
        this.rings.delete(id);
      }
    }
    for (const id of wanted) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      let ring = this.rings.get(id);
      if (!ring) {
        ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
        this.rings.set(id, ring);
        this.scene.add(ring);
      }
      ring.material = id === this.inspected ? this.inspectMaterial : this.ringMaterial;
      ring.scale.set(entry.ringScale, 1, entry.ringScale);
      ring.position.set(entry.root.position.x, 0.06, entry.root.position.z);
    }
  }

  /** Barra de vida orientada a la cámara: existe solo si 0 < vida < máximo (P2-H07). */
  private syncBars(): void {
    for (const [id, entry] of this.entries) {
      if (entry.type === "node") continue;
      const state = barState(entry.hp, entry.max);
      if (state.invalid && !this.invalidBars.has(id)) {
        this.invalidBars.add(id);
        if (this.warnings.length < 20) this.warnings.push(`Barra de vida omitida: máximo inválido para la entidad ${id}`);
      }
      let bar = this.bars.get(id);
      if (!state.visible) {
        if (bar) bar.group.visible = false;
        continue;
      }
      if (!bar) {
        const group = new THREE.Group();
        const back = new THREE.Mesh(this.barGeometry, this.barBack);
        const fill = new THREE.Mesh(this.barGeometry, this.barFills[0]);
        back.renderOrder = 10;
        fill.renderOrder = 11;
        fill.position.z = 0.001;
        group.add(back, fill);
        this.entityRoot.add(group);
        bar = { group, fill };
        this.bars.set(id, bar);
      }
      bar.group.visible = true;
      bar.group.position.set(entry.root.position.x, entry.barY, entry.root.position.z);
      bar.group.quaternion.copy(this.camera.quaternion);
      bar.group.scale.set(entry.barWidth, 1, 1);
      bar.fill.material = state.ratio > 0.5 ? this.barFills[0] : state.ratio > 0.25 ? this.barFills[1] : this.barFills[2];
      bar.fill.scale.set(state.ratio, 0.8, 1);
      bar.fill.position.x = -(1 - state.ratio) / 2;
    }
  }

  /** Suaviza el movimiento entre ticks y aplica la pose de cada personaje. */
  private animateUnits(dt: number): void {
    const follow = 1 - Math.exp(-dt * SMOOTH_RATE);
    const turn = 1 - Math.exp(-dt * YAW_RATE);
    for (const entry of this.entries.values()) {
      if (entry.type !== "unit") continue;
      const dx = entry.sim.x - entry.pos.x;
      const dz = entry.sim.z - entry.pos.z;
      if (dx * dx + dz * dz > SNAP_DISTANCE * SNAP_DISTANCE) {
        entry.pos.x = entry.sim.x;
        entry.pos.z = entry.sim.z;
      } else {
        entry.pos.x += dx * follow;
        entry.pos.z += dz * follow;
      }
      entry.root.position.set(entry.pos.x, 0, entry.pos.z);
      let delta = entry.heading - entry.yaw;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      entry.yaw += delta * turn;
      entry.rig.facing.rotation.y = entry.yaw;

      const walking = this.animTime < entry.moveUntil;
      let combatPhase: number | null = null;
      if (!walking && entry.strikeAt > -Infinity) {
        const interval = Math.max(0.2, BALANCE.units[entry.kind].attackIntervalTicks / TICKS_PER_SECOND);
        const elapsed = (this.animTime - entry.strikeAt) / interval;
        if (elapsed < 1.2) combatPhase = Math.min(1, elapsed + (entry.kind === "soldier" ? 0.15 : 0));
      }
      applyPose(
        entry.rig,
        computePose({ role: entry.kind, t: this.animTime + entry.phase, walking, work: entry.work, carrying: entry.carry !== null, combatPhase }),
      );
    }
  }

  /** Cuerpos caídos: caen, yacen y se retiran a los 5 s de tiempo de juego (P2-H09). */
  private animateBodies(): void {
    const keep: Body[] = [];
    for (const body of this.bodies) {
      const state = deathState(this.animTime - body.diedAt);
      if (state.done) {
        this.entityRoot.remove(body.rig.root);
        continue;
      }
      applyDeath(body.rig, deathPose(state.fall), state.fall);
      body.rig.root.scale.setScalar(Math.max(0.001, state.scale));
      keep.push(body);
    }
    this.bodies = keep;
  }

  /** El edificio dejó de existir en el estado: su modelo se derrumba en lugar de desaparecer (P3-R04). */
  private beginCollapse(entry: BuildingEntry): void {
    const footprint = BALANCE.buildings[entry.kind].footprint;
    const duration = entry.complete ? COLLAPSE_MIN_S + COLLAPSE_PER_CELL_S * footprint : COLLAPSE_MIN_S;
    const dust = new THREE.MeshBasicMaterial({ color: 0xb9ad98, transparent: true, opacity: 0.6, depthWrite: false });
    const puffs: THREE.Mesh[] = [];
    for (let i = 0; i < DUST_PUFFS; i++) {
      const puff = new THREE.Mesh(this.dustGeometry, dust);
      puff.visible = false;
      this.entityRoot.add(puff);
      puffs.push(puff);
    }
    if (entry.flames) entry.flames.group.visible = false;
    entry.proxy.visible = false;
    this.collapses.push({ rig: entry.rig, baseX: entry.root.position.x, elapsed: 0, duration, tilt: (entry.phase % 2 === 0 ? 1 : -1) * 0.12, footprint, puffs, dust });
  }

  private finishCollapse(c: Collapse): void {
    this.entityRoot.remove(c.rig.root);
    for (const puff of c.puffs) this.entityRoot.remove(puff);
    c.dust.dispose();
  }

  /** Sacudida, muros que se hunden, tejado que cae ladeado y polvo; termina con el modelo bajo el suelo. */
  private animateCollapses(dt: number): void {
    if (this.collapses.length === 0) return;
    const keep: Collapse[] = [];
    for (const c of this.collapses) {
      c.elapsed += dt;
      const k = Math.min(1, c.elapsed / c.duration);
      if (k >= 1) {
        this.finishCollapse(c);
        continue;
      }
      const fall = 1 - (1 - k) * (1 - k);
      const { rig } = c;
      rig.walls.scale.y = Math.max(0.04, 1 - 0.96 * fall);
      rig.roof.position.y = rig.foundationTop + rig.wallsHeight * rig.walls.scale.y;
      rig.roof.rotation.z = c.tilt * fall;
      const sink = Math.max(0, (k - 0.55) / 0.45);
      rig.root.position.y = -(rig.foundationTop + rig.wallsHeight * 0.5 + 0.6) * sink * sink;
      rig.root.position.x = c.baseX + Math.sin(c.elapsed * 55) * 0.05 * (1 - k);
      c.dust.opacity = 0.6 * (1 - k);
      const r = c.footprint * 0.45;
      c.puffs.forEach((puff, i) => {
        const a = (i / c.puffs.length) * Math.PI * 2;
        puff.visible = true;
        puff.position.set(rig.root.position.x + Math.cos(a) * r * (0.5 + k), 0.3 + k * 1.2 + (i % 3) * 0.15, rig.root.position.z + Math.sin(a) * r * (0.5 + k));
        puff.scale.setScalar(0.5 + k * 1.1 + (i % 2) * 0.2);
      });
      keep.push(c);
    }
    this.collapses = keep;
  }

  /** Llamas por umbral de vida; solo existen en edificios completos (P2-H08). */
  private animateFlames(): void {
    for (const entry of this.entries.values()) {
      if (entry.type !== "building") continue;
      const count = flameCount(entry.hp, entry.max, entry.complete);
      if (count === 0 && !entry.flames) continue;
      if (!entry.flames) {
        entry.flames = this.flameFactory.create(entry.kind, entry.phase);
        entry.root.add(entry.flames.group);
      }
      updateFlames(entry.flames, count, this.animTime);
    }
  }

  /** Las copas de los árboles se vuelven translúcidas cuando una unidad queda tras ellas (CA04). */
  private fadeCrowns(): void {
    for (const node of this.entries.values()) {
      if (node.type !== "node" || !node.rig.crown) continue;
      let hidden = false;
      if (!node.spent) {
        for (const unit of this.entries.values()) {
          if (unit.type !== "unit") continue;
          const dx = unit.pos.x - node.x;
          const dz = unit.pos.z - node.z;
          const along = (dx + dz) * SQRT1_2;
          if (along > 0.2 || along < -FADE_BEHIND) continue;
          if (Math.abs((dx - dz) * SQRT1_2) < FADE_SIDE) {
            hidden = true;
            break;
          }
        }
      }
      if (hidden !== node.faded) {
        node.faded = hidden;
        node.rig.crown.material = hidden ? node.rig.fadedMaterial! : node.rig.crownMaterial!;
      }
    }
  }

  /** Marcador breve en el punto ordenado: feedback visual inmediato (RNF-03). */
  showMarker(x: number, z: number): void {
    this.marker.position.set(x, 0.07, z);
    this.markerStart = performance.now();
    this.marker.visible = true;
  }

  /** Fantasma de colocación; la validez la decide el núcleo, aquí solo se colorea. */
  showGhost(kind: BuildingKind, cellX: number, cellZ: number, valid: boolean): void {
    const w = BALANCE.buildings[kind].footprint;
    const h = kind === "barracks" ? 1.6 : kind === "tower" ? 2.4 : 1.2;
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
    this.entityRoot.updateMatrixWorld(true);
    const proxies: THREE.Object3D[] = [];
    for (const entry of this.entries.values()) if (entry.pickable) proxies.push(entry.proxy);
    return this.raycaster.intersectObjects(proxies, false).map((h) => h.object.userData["id"] as number);
  }

  /** Punto del suelo (plano XZ) bajo el cursor, o null si queda fuera del mapa. */
  groundPoint(clientX: number, clientY: number): { x: number; z: number } | null {
    this.applyRig();
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const point = this.raycaster.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
    if (!point || point.x < 0 || point.z < 0 || point.x > this.mapWidth || point.z > this.mapDepth) return null;
    return { x: point.x, z: point.z };
  }

  /** Posición en píxeles de cliente de un punto del mundo. */
  screenPosition(x: number, y: number, z: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  render(): void {
    const now = performance.now();
    const dt = this.lastRender === null ? 0 : Math.min(0.1, (now - this.lastRender) / 1000);
    this.lastRender = now;
    if (!this.frozen) this.animTime += dt;

    this.applyRig();
    this.animateUnits(dt);
    this.animateBodies();
    this.animateCollapses(this.fxPaused ? 0 : dt);
    this.animateFlames();
    this.arrows.update(this.animTime);
    this.terrain.update(this.animTime);
    this.fadeCrowns();
    this.syncRings();
    this.syncBars();
    if (this.marker.visible) {
      const t = (now - this.markerStart) / MARKER_MS;
      if (t >= 1) this.marker.visible = false;
      else {
        this.marker.scale.setScalar(1.4 - 0.4 * t);
        (this.marker.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Contadores del último fotograma, para la muestra de rendimiento. */
  renderStats(): { calls: number; triangles: number; geometries: number; textures: number; arrows: number; trees: number } {
    const { render, memory } = this.renderer.info;
    let nodeTrees = 0;
    for (const e of this.entries.values()) if (e.type === "node" && e.rig.kind === "wood") nodeTrees++;
    return { calls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures, arrows: this.arrows.active, trees: this.terrain.scenery.trees.length + nodeTrees };
  }

  /** Nombre de la GPU activa si el navegador lo expone (RNF-05). */
  gpuInfo(): string {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  }

  dispose(): void {
    this.reset();
    this.terrain.dispose();
    this.assets.dispose();
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
  }
}
