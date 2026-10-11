import * as THREE from "three";
import type { ResourceKind } from "../content/balance";
import type { AssetLibrary } from "./assets";
import { mergeParts } from "./merge";
import type { Materials, TreeGeometry, TreeVariant } from "./models";
import { mulberry32 } from "./scenery";

export interface NodeRig {
  root: THREE.Group;
  /** Piezas visibles mientras queda recurso. */
  full: THREE.Object3D[];
  /** Tocón o arbusto seco, visible al agotarse el recurso. */
  spent: THREE.Object3D;
  crown: THREE.Mesh | null;
  crownMaterial: THREE.Material | null;
  fadedMaterial: THREE.Material | null;
  proxy: THREE.Mesh;
  kind: ResourceKind;
}

/** Árboles y arbustos con bayas de los nodos económicos; la geometría se comparte entre todos. */
export class NodeFactory {
  private readonly leafMaterials: readonly THREE.MeshLambertMaterial[];
  private readonly fadedMaterials: readonly THREE.MeshLambertMaterial[];
  private readonly stump: THREE.BufferGeometry;
  private readonly foliage: THREE.BufferGeometry;
  private readonly berries: THREE.BufferGeometry;
  private readonly dry: THREE.BufferGeometry;
  private readonly treeProxy: THREE.BufferGeometry;
  private readonly bushProxy: THREE.BufferGeometry;
  private readonly rocks: THREE.BufferGeometry;
  private readonly rockProxy: THREE.BufferGeometry;
  private readonly proxyMaterial: THREE.MeshBasicMaterial;

  constructor(
    assets: AssetLibrary,
    private readonly mat: Materials,
    private readonly trees: readonly [TreeGeometry, TreeGeometry, TreeGeometry],
  ) {
    this.leafMaterials = [mat.leafPine, mat.leafOak, mat.leafBirch];
    // Copa translúcida para no ocultar a quien trabaja detrás de un árbol (variante de material compartida).
    this.fadedMaterials = this.leafMaterials.map((m) =>
      assets.lambert({ color: m.color.getHex(), map: m.map, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    this.stump = assets.track(new THREE.CylinderGeometry(0.14, 0.19, 0.2, 7).translate(0, 0.1, 0));
    const b = (r: number, x: number, y: number, z: number): { geometry: THREE.BufferGeometry; position: [number, number, number] } => ({
      geometry: new THREE.SphereGeometry(r, 7, 5),
      position: [x, y, z],
    });
    const foliageParts = [b(0.3, 0, 0.26, 0), b(0.22, 0.24, 0.2, 0.1), b(0.2, -0.22, 0.2, -0.1), b(0.2, 0.05, 0.22, 0.24)];
    this.foliage = assets.track(mergeParts(foliageParts));
    foliageParts.forEach((p) => p.geometry.dispose());
    const rng = mulberry32(77);
    const berryParts = Array.from({ length: 9 }, () => {
      const a = rng() * Math.PI * 2;
      const r = 0.2 + rng() * 0.12;
      return b(0.04, Math.cos(a) * r, 0.2 + rng() * 0.2, Math.sin(a) * r);
    });
    this.berries = assets.track(mergeParts(berryParts));
    berryParts.forEach((p) => p.geometry.dispose());
    this.dry = assets.track(new THREE.SphereGeometry(0.22, 6, 4).scale(1, 0.45, 1).translate(0, 0.1, 0));
    this.treeProxy = assets.track(new THREE.CylinderGeometry(0.45, 0.45, 1.8, 8).translate(0, 0.9, 0));
    this.bushProxy = assets.track(new THREE.CylinderGeometry(0.5, 0.5, 0.7, 8).translate(0, 0.35, 0));
    this.proxyMaterial = assets.basic({ visible: false });
    const rock = (r: number, x: number, y: number, z: number, sy: number): { geometry: THREE.BufferGeometry; position: [number, number, number] } => ({
      geometry: new THREE.IcosahedronGeometry(r, 0).scale(1, sy, 1),
      position: [x, y, z],
    });
    const rockParts = [rock(0.34, 0, 0.24, 0, 0.85), rock(0.24, 0.3, 0.14, 0.1, 0.8), rock(0.2, -0.28, 0.12, -0.12, 0.9), rock(0.16, 0.05, 0.1, 0.32, 0.8)];
    this.rocks = assets.track(mergeParts(rockParts));
    rockParts.forEach((p) => p.geometry.dispose());
    this.rockProxy = assets.track(new THREE.CylinderGeometry(0.5, 0.5, 0.7, 8).translate(0, 0.35, 0));
  }

  create(kind: ResourceKind, id: number): NodeRig {
    const rng = mulberry32(id * 2654435761);
    const root = new THREE.Group();
    const scale = 0.92 + rng() * 0.22;
    root.rotation.y = rng() * Math.PI * 2;
    root.scale.setScalar(scale);

    if (kind === "stone") {
      const cluster = new THREE.Mesh(this.rocks, this.mat.stone);
      const gravel = new THREE.Mesh(this.dry, this.mat.stone);
      gravel.visible = false;
      const proxy = new THREE.Mesh(this.rockProxy, this.proxyMaterial);
      root.add(cluster, gravel, proxy);
      return { root, full: [cluster], spent: gravel, crown: null, crownMaterial: null, fadedMaterial: null, proxy, kind };
    }

    if (kind === "wood") {
      const variant = (id % 3) as TreeVariant;
      const geo = this.trees[variant];
      const trunk = new THREE.Mesh(geo.trunk, variant === 2 ? this.mat.barkLight : this.mat.bark);
      const crown = new THREE.Mesh(geo.crown, this.leafMaterials[variant]!);
      const stump = new THREE.Mesh(this.stump, this.mat.bark);
      stump.visible = false;
      const proxy = new THREE.Mesh(this.treeProxy, this.proxyMaterial);
      root.add(trunk, crown, stump, proxy);
      return { root, full: [trunk, crown], spent: stump, crown, crownMaterial: this.leafMaterials[variant]!, fadedMaterial: this.fadedMaterials[variant]!, proxy, kind };
    }

    const leaves = new THREE.Mesh(this.foliage, this.mat.leafBerry);
    const fruit = new THREE.Mesh(this.berries, this.mat.berry);
    const dry = new THREE.Mesh(this.dry, this.mat.dryBush);
    dry.visible = false;
    const proxy = new THREE.Mesh(this.bushProxy, this.proxyMaterial);
    root.add(leaves, fruit, dry, proxy);
    return { root, full: [leaves, fruit], spent: dry, crown: null, crownMaterial: null, fadedMaterial: null, proxy, kind };
  }
}

export function setNodeSpent(rig: NodeRig, spent: boolean): void {
  for (const part of rig.full) part.visible = !spent;
  rig.spent.visible = spent;
}
