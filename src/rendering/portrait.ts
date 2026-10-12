import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { BALANCE, type BuildingKind, type ResourceKind, type UnitKind } from "../content/balance";
import type { SelectionInfo } from "../input/selection";
import type { AssetLibrary, Quality } from "./assets";
import { applyConstruction, type BuildingRig, buildBuilding, type GeometryCache } from "./buildings";
import type { Materials } from "./models";
import { type NodeFactory, type NodeRig, setNodeSpent } from "./nodes";
import { computePose } from "./pose";
import { applyPose, type UnitFactory, type UnitRig } from "./units";

/** Piezas del visor principal que el retrato reutiliza: geometrías y materiales compartidos, nada nuevo por entidad. */
export interface PortraitKit {
  assets: AssetLibrary;
  mat: Materials;
  units: UnitFactory;
  buildingGeometry: GeometryCache;
  buildingProxyMaterial: THREE.Material;
  nodes: NodeFactory;
  quality: Quality;
}

export const PORTRAIT_FOV = 28;
export const PORTRAIT_MARGIN = 0.12;
/** Redibujado máximo del mismo retrato cuando solo cambia su aspecto (obra que avanza, recurso que se agota). */
export const PORTRAIT_MIN_INTERVAL_MS = 250;

/** Distancia a la que una esfera de radio `radius` ocupa el campo de visión con un margen relativo. */
export function framingDistance(radius: number, fovDeg = PORTRAIT_FOV, margin = PORTRAIT_MARGIN): number {
  return (radius * (1 + margin)) / Math.sin((fovDeg * Math.PI) / 360);
}

/** Clave del modelo cacheado: la vida o el avance no la cambian, el tipo, el bando y la variante sí. */
export function portraitModelKey(info: SelectionInfo): string {
  const variant = info.type === "node" && info.kind === "wood" ? info.id % 3 : 0;
  return `${info.type}:${info.kind}:${info.owner ?? "n"}:${variant}:${info.gender ?? ""}`;
}

const SIDE_COLOR = { player: "#3b82f6", enemy: "#ef4444", nature: "#4a8f3a" } as const;

interface Model {
  root: THREE.Object3D;
  /** Aplica el aspecto variable (obra, recurso agotado) antes de dibujar. */
  apply(info: SelectionInfo): void;
}

/**
 * Retrato de la entidad seleccionada: un segundo visor WebGL pequeño con su propia escena, que reutiliza los
 * modelos del juego. Sin WebGL dibuja una ficha 2D con el color del bando; nunca interrumpe la partida.
 */
export class PortraitView {
  /** Avisos de diagnóstico (WebGL no disponible, contexto perdido). */
  readonly warnings: string[] = [];
  private readonly renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(PORTRAIT_FOV, 1, 0.05, 200);
  private readonly models = new Map<string, Model>();
  private current: Model | null = null;
  private lastKey = "";
  private lastId = -1;
  private lastDraw = -Infinity;
  private lastInfo: SelectionInfo | null = null;
  private readonly box = new THREE.Box3();
  private readonly tmpBox = new THREE.Box3();
  private readonly sphere = new THREE.Sphere();

  constructor(private readonly canvas: HTMLCanvasElement, private readonly kit: PortraitKit) {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: kit.quality === "high", alpha: true, stencil: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.setSize(canvas.clientWidth || 112, canvas.clientHeight || 112, false);
      this.renderer.setClearColor(0x000000, 0);
    } catch {
      this.renderer = null;
      this.warnings.push("Retrato: WebGL no disponible; se muestra una ficha plana.");
      return;
    }
    if (kit.quality === "high") {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.55;
      pmrem.dispose();
    }
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35), new THREE.HemisphereLight(0xdfeaff, 0x4a6a34, 0.7));
    const key = new THREE.DirectionalLight(0xfff0d8, 2.2);
    key.position.set(4, 6, 5);
    this.scene.add(key);
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.warnings.push("Retrato: contexto WebGL perdido.");
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.lastKey = "";
      this.show(this.lastInfo);
    });
  }

  get available(): boolean {
    return this.renderer !== null;
  }

  /** Muestra la entidad indicada; `null` oculta el modelo. Solo redibuja cuando cambia algo visible. */
  show(info: SelectionInfo | null, now: number = performance.now()): void {
    this.lastInfo = info;
    if (!info) {
      this.lastKey = "";
      this.lastId = -1;
      return;
    }
    const key = `${info.id}:${info.aspectKey}`;
    if (key === this.lastKey) return;
    const sameEntity = info.id === this.lastId;
    if (sameEntity && now - this.lastDraw < PORTRAIT_MIN_INTERVAL_MS) return;
    this.lastKey = key;
    this.lastId = info.id;
    this.lastDraw = now;
    if (!this.renderer) {
      this.paintFallback(info);
      return;
    }
    this.draw(info);
  }

  private draw(info: SelectionInfo): void {
    const renderer = this.renderer!;
    if (this.current) this.current.root.visible = false;
    const modelKey = portraitModelKey(info);
    let model = this.models.get(modelKey);
    if (!model) {
      model = this.create(info);
      this.models.set(modelKey, model);
      this.scene.add(model.root);
    }
    model.apply(info);
    model.root.visible = true;
    this.current = model;
    this.frame(model.root, info);
    renderer.render(this.scene, this.camera);
  }

  /** Encuadra la esfera envolvente de las piezas visibles (sin marcas de bando ni cajas de selección). */
  private frame(root: THREE.Object3D, info: SelectionInfo): void {
    root.updateWorldMatrix(true, true);
    this.box.makeEmpty();
    root.traverseVisible((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      this.tmpBox.copy(geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
      this.box.union(this.tmpBox);
    });
    if (this.box.isEmpty()) return;
    this.box.getBoundingSphere(this.sphere);
    const distance = framingDistance(this.sphere.radius);
    const direction = info.type === "unit" ? new THREE.Vector3(0.5, 0.22, 1) : new THREE.Vector3(0.7, 0.5, 1);
    direction.normalize();
    this.camera.position.copy(this.sphere.center).addScaledVector(direction, distance);
    this.camera.near = Math.max(0.05, distance - this.sphere.radius * 2);
    this.camera.far = distance + this.sphere.radius * 3;
    this.camera.lookAt(this.sphere.center);
    this.camera.updateProjectionMatrix();
  }

  private create(info: SelectionInfo): Model {
    const { mat, units, nodes, buildingGeometry, buildingProxyMaterial } = this.kit;
    if (info.type === "unit") {
      const rig: UnitRig = units.create(info.kind as UnitKind, (info.owner ?? 0) as 0 | 1, false, info.gender === "female");
      rig.mark.visible = false;
      if (rig.shadow) rig.shadow.visible = false;
      rig.proxy.visible = false;
      rig.facing.rotation.y = 0;
      applyPose(rig, computePose({ role: rig.role, t: 0, walking: false, work: null, carrying: false, combatPhase: null }));
      return { root: rig.root, apply: () => undefined };
    }
    if (info.type === "building") {
      const kind = info.kind as BuildingKind;
      const rig: BuildingRig = buildBuilding(kind, (info.owner ?? 0) as 0 | 1, mat, buildingGeometry, buildingProxyMaterial, BALANCE.buildings[kind].footprint);
      rig.proxy.visible = false;
      rig.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && (mat.mark as readonly THREE.Material[]).includes(mesh.material as THREE.Material)) mesh.visible = false;
      });
      return { root: rig.root, apply: (i) => applyConstruction(rig, i.progress === null, i.progress ?? 1) };
    }
    const rig: NodeRig = nodes.create(info.kind as ResourceKind, info.kind === "wood" ? info.id % 3 : 1);
    rig.proxy.visible = false;
    rig.root.rotation.y = 0.6;
    return { root: rig.root, apply: (i) => setNodeSpent(rig, i.value <= 0) };
  }

  /** Ficha plana sin WebGL: degradado con el color del bando y la inicial del nombre. */
  private paintFallback(info: SelectionInfo): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, SIDE_COLOR[info.side]);
    g.addColorStop(1, "#14171a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.font = `bold ${Math.round(h * 0.5)}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(info.name.charAt(0), w / 2, h / 2);
  }

  dispose(): void {
    this.renderer?.dispose();
  }
}
