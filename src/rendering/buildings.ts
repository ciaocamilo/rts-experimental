import * as THREE from "three";
import type { BuildingKind } from "../content/balance";
import type { AssetLibrary } from "./assets";
import { mergeParts, type Part } from "./merge";
import { gableRoof, type Materials, texBox, VISUAL } from "./models";

export interface BuildingRig {
  root: THREE.Group;
  foundation: THREE.Group;
  walls: THREE.Group;
  roof: THREE.Group;
  scaffold: THREE.Group;
  proxy: THREE.Mesh;
  kind: BuildingKind;
  /** Altura de la cimentación y de los muros, para ordenar las fases de una obra. */
  foundationTop: number;
  wallsHeight: number;
}

/** Geometrías compartidas por tipo: crear un edificio nunca asigna geometría nueva tras el primero. */
export class GeometryCache {
  private readonly map = new Map<string, THREE.BufferGeometry>();
  constructor(private readonly assets: AssetLibrary) {}

  get(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.map.get(key);
    if (!g) {
      g = this.assets.track(make());
      this.map.set(key, g);
    }
    return g;
  }

  box(w: number, h: number, d: number, density = 1): THREE.BufferGeometry {
    return this.get(`box:${w}:${h}:${d}:${density}`, () => texBox(w, h, d, density));
  }

  private readonly stenciled = new Map<THREE.Material, THREE.Material>();

  /**
   * Variante del material que marca la plantilla (1) donde se dibuja un edificio. Las unidades detrás de un edificio usan
   * esa marca para mostrar su contorno solo ahí (P3-R05). Comparte texturas con el original.
   */
  stencil(material: THREE.Material): THREE.Material {
    let m = this.stenciled.get(material);
    if (!m) {
      m = this.assets.track(material.clone());
      m.stencilWrite = true;
      m.stencilRef = 1;
      m.stencilFunc = THREE.AlwaysStencilFunc;
      m.stencilZPass = THREE.ReplaceStencilOp;
      this.stenciled.set(material, m);
    }
    return m;
  }
}

type Place = [number, number, number];

function build(kind: BuildingKind, owner: 0 | 1, mat: Materials, cache: GeometryCache, proxyMat: THREE.Material, footprint: number): BuildingRig {
  const root = new THREE.Group();
  const foundation = new THREE.Group();
  const walls = new THREE.Group();
  const roof = new THREE.Group();
  const scaffold = new THREE.Group();
  root.add(foundation, walls, roof, scaffold);

  // Las piezas se acumulan por grupo y material; al final cada combinación es una sola malla.
  const pending = new Map<THREE.Group, Map<THREE.Material, Part[]>>();
  const put = (parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, at: Place): void => {
    let byMaterial = pending.get(parent);
    if (!byMaterial) pending.set(parent, (byMaterial = new Map()));
    let list = byMaterial.get(material);
    if (!list) byMaterial.set(material, (list = []));
    list.push({ geometry, position: at });
  };
  const box = (parent: THREE.Group, w: number, h: number, d: number, material: THREE.Material, at: Place, density = 1): void =>
    put(parent, cache.box(w, h, d, density), material, at);
  const flag = (parent: THREE.Group, w: number, h: number, at: Place): void => {
    put(parent, cache.get(`flag:${w}:${h}`, () => new THREE.PlaneGeometry(w, h)), mat.flag[owner], at);
  };
  const pole = (parent: THREE.Group, h: number, at: Place): void => {
    put(parent, cache.get(`pole:${h}`, () => new THREE.CylinderGeometry(0.03, 0.03, h, 5)), mat.bark, [at[0], at[1] + h / 2, at[2]]);
  };
  const roofOf = (parent: THREE.Group, w: number, d: number, h: number, slope: THREE.Material, end: THREE.Material): void => {
    const slopes = cache.get(`gable:s:${w}:${d}:${h}`, () => gableRoof(w, d, h).slopes);
    const ends = cache.get(`gable:e:${w}:${d}:${h}`, () => gableRoof(w, d, h).ends);
    put(parent, slopes, slope, [0, 0, 0]);
    put(parent, ends, end, [0, 0, 0]);
    box(parent, w + 0.1, 0.08, 0.1, mat.bark, [0, h, 0]);
  };

  let foundationTop = 0;
  let wallsHeight = 0;

  if (kind === "townCenter") {
    foundationTop = 0.45;
    wallsHeight = 1.3;
    box(foundation, 3.6, 0.45, 3.6, mat.stone, [0, 0.225, 0], 0.8);
    box(foundation, 1.4, 0.16, 0.5, mat.stone, [0, 0.08, 2.05]);

    box(walls, 3.2, 1.3, 3.2, mat.plaster, [0, 0.65, 0]);
    for (const [x, z] of [[1.6, 1.6], [-1.6, 1.6], [1.6, -1.6], [-1.6, -1.6]] as const) box(walls, 0.16, 1.3, 0.16, mat.bark, [x, 0.65, z]);
    for (const y of [0.05, 1.25]) {
      for (const z of [1.62, -1.62]) box(walls, 3.2, 0.1, 0.06, mat.bark, [0, y, z]);
      for (const x of [1.62, -1.62]) box(walls, 0.06, 0.1, 3.2, mat.bark, [x, y, 0]);
    }
    box(walls, 0.95, 1.05, 0.04, mat.bark, [0, 0.525, 1.61]);
    box(walls, 0.8, 0.95, 0.06, mat.dark, [0, 0.475, 1.62]);
    for (const x of [-1.0, 1.0]) {
      box(walls, 0.36, 0.36, 0.04, mat.bark, [x, 0.8, 1.61]);
      box(walls, 0.3, 0.3, 0.05, mat.glass, [x, 0.8, 1.62]);
    }
    for (const z of [-0.8, 0.8]) {
      box(walls, 0.04, 0.36, 0.36, mat.bark, [1.61, 0.8, z]);
      box(walls, 0.05, 0.3, 0.3, mat.glass, [1.62, 0.8, z]);
    }
    put(walls, cache.get("tower", () => new THREE.CylinderGeometry(0.58, 0.64, 2.55, 10)), mat.stone, [-1.45, 0.825, -1.45]);
    flag(walls, 0.5, 0.9, [1.15, 0.8, 1.65]);

    roofOf(roof, 3.6, 3.5, 1.0, mat.roofTile, mat.plaster);
    box(roof, 0.3, 0.7, 0.3, mat.stone, [1.0, 0.7, -0.5]);
    put(roof, cache.get("tower-roof", () => new THREE.ConeGeometry(0.8, 0.95, 10)), mat.roofSlate, [-1.45, 1.25, -1.45]);
    pole(roof, 1.4, [1.5, 1.0, 0]);
    flag(roof, 0.85, 0.5, [1.95, 2.15, 0]);
  } else if (kind === "house") {
    foundationTop = 0.2;
    wallsHeight = 0.8;
    box(foundation, 1.8, 0.2, 1.6, mat.stone, [0, 0.1, 0], 0.8);

    box(walls, 1.6, 0.8, 1.4, mat.plaster, [0, 0.4, 0]);
    for (const [x, z] of [[0.8, 0.7], [-0.8, 0.7], [0.8, -0.7], [-0.8, -0.7]] as const) box(walls, 0.1, 0.8, 0.1, mat.bark, [x, 0.4, z]);
    for (const y of [0.04, 0.76]) box(walls, 1.6, 0.07, 0.05, mat.bark, [0, y, 0.71]);
    box(walls, 0.46, 0.62, 0.04, mat.bark, [0, 0.31, 0.71]);
    box(walls, 0.38, 0.56, 0.05, mat.planks, [0, 0.28, 0.72]);
    box(walls, 0.5, 0.07, 0.06, mat.team[owner], [0, 0.66, 0.73]);
    for (const x of [-0.5, 0.5]) {
      box(walls, 0.26, 0.26, 0.03, mat.bark, [x, 0.5, 0.71]);
      box(walls, 0.2, 0.2, 0.05, mat.glass, [x, 0.5, 0.72]);
    }
    box(walls, 0.05, 0.2, 0.2, mat.glass, [0.81, 0.5, 0]);

    roofOf(roof, 1.9, 1.8, 0.75, mat.roofTile, mat.plaster);
    box(roof, 0.18, 0.5, 0.18, mat.stone, [0.55, 0.5, -0.3]);
  } else if (kind === "barracks") {
    foundationTop = 0.35;
    wallsHeight = 1.0;
    box(foundation, 2.7, 0.35, 2.4, mat.stone, [0, 0.175, 0], 0.8);

    box(walls, 2.5, 1.0, 2.2, mat.planks, [0, 0.5, 0], 0.6);
    for (const [x, z] of [[1.25, 1.1], [-1.25, 1.1], [1.25, -1.1], [-1.25, -1.1]] as const) box(walls, 0.22, 1.05, 0.22, mat.stone, [x, 0.525, z]);
    for (const z of [1.12, -1.12]) box(walls, 2.5, 0.1, 0.06, mat.bark, [0, 0.95, z]);
    box(walls, 1.0, 0.8, 0.06, mat.dark, [0, 0.4, 1.11]);
    box(walls, 1.25, 0.12, 0.1, mat.bark, [0, 0.86, 1.13]);
    for (const x of [-0.55, 0.55]) box(walls, 0.1, 0.85, 0.1, mat.bark, [x, 0.425, 1.13]);
    for (const x of [-0.95, 0.95]) {
      put(walls, cache.get("shield", () => new THREE.CylinderGeometry(0.2, 0.2, 0.04, 12).rotateX(Math.PI / 2)), mat.team[owner], [x, 0.55, 1.13]);
      put(walls, cache.get("shield-boss", () => new THREE.SphereGeometry(0.06, 6, 5)), mat.steel, [x, 0.55, 1.17]);
    }
    for (const x of [-0.75, 0.75]) {
      pole(walls, 1.1, [x, 0, 1.22]);
      put(walls, cache.get("spear", () => new THREE.ConeGeometry(0.04, 0.14, 5)), mat.steel, [x, 1.17, 1.22]);
    }
    for (const x of [1.26, -1.26]) box(walls, 0.05, 0.12, 0.45, mat.dark, [x, 0.65, 0]);

    roofOf(roof, 2.8, 2.6, 0.8, mat.roofSlate, mat.planks);
    pole(roof, 0.9, [-1.3, 0.35, 0]);
    flag(roof, 0.6, 0.4, [-1.0, 1.0, 0]);
  } else {
    // Torre de piedra: base ancha, fuste cónico, plataforma de madera con parapeto y techo de pizarra.
    foundationTop = 0.3;
    wallsHeight = 2.2;
    box(foundation, 1.9, 0.3, 1.9, mat.stone, [0, 0.15, 0], 0.8);

    put(walls, cache.get("keep", () => new THREE.CylinderGeometry(0.62, 0.78, 2.2, 8).translate(0, 1.1, 0)), mat.stone, [0, 0, 0]);
    box(walls, 0.34, 0.7, 0.05, mat.dark, [0, 0.35, 0.74]);
    for (const y of [1.2, 1.75]) box(walls, 0.07, 0.3, 0.06, mat.dark, [0, y, 0.64]);
    box(walls, 0.5, 0.07, 0.06, mat.team[owner], [0, 0.82, 0.75]);

    box(roof, 1.6, 0.12, 1.6, mat.planks, [0, 0.06, 0]);
    for (const [x, z] of [[0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]] as const) box(roof, 0.12, 0.5, 0.12, mat.bark, [x, 0.37, z]);
    for (const z of [0.72, -0.72]) box(roof, 1.5, 0.08, 0.06, mat.bark, [0, 0.3, z]);
    for (const x of [0.72, -0.72]) box(roof, 0.06, 0.08, 1.5, mat.bark, [x, 0.3, 0]);
    put(roof, cache.get("keep-roof", () => new THREE.ConeGeometry(1.0, 0.8, 8).translate(0, 0.4, 0)), mat.roofSlate, [0, 0.5, 0]);
    pole(roof, 0.6, [0, 1.3, 0]);
    flag(roof, 0.5, 0.3, [0.3, 1.75, 0]);
  }

  // Andamio: postes y travesaños alrededor de la huella; se muestra mientras la obra no está completa.
  const sw = footprint * 0.9 + 0.3;
  const sh = foundationTop + wallsHeight + 0.35;
  const poleGeo = cache.get(`scaf:${sh}`, () => new THREE.CylinderGeometry(0.035, 0.035, sh, 5).translate(0, sh / 2, 0));
  const half = sw / 2;
  for (const [x, z] of [[half, half], [-half, half], [half, -half], [-half, -half], [0, half], [0, -half], [half, 0], [-half, 0]] as const) put(scaffold, poleGeo, mat.scaffold, [x, 0, z]);
  for (const y of [sh * 0.4, sh * 0.75]) {
    for (const z of [half, -half]) box(scaffold, sw, 0.05, 0.05, mat.scaffold, [0, y, z]);
    for (const x of [half, -half]) box(scaffold, 0.05, 0.05, sw, mat.scaffold, [x, y, 0]);
  }
  box(scaffold, sw * 0.5, 0.05, 0.4, mat.planks, [0, sh * 0.4 + 0.05, half + 0.15]);

  const names = new Map<THREE.Group, string>([[foundation, "f"], [walls, "w"], [roof, "r"], [scaffold, "s"]]);
  for (const [group, byMaterial] of pending) {
    for (const [material, parts] of byMaterial) {
      const geometry = cache.get(`b:${kind}:${owner}:${names.get(group)}:${material.uuid}`, () => mergeParts(parts));
      group.add(new THREE.Mesh(geometry, cache.stencil(material)));
    }
  }

  walls.position.y = foundationTop;
  roof.position.y = foundationTop + wallsHeight;
  scaffold.visible = false;

  // Marca de bando independiente del color: disco blanco (jugador) o rombo oscuro (rival).
  const markGeo = cache.get(owner === 0 ? "bm:disc" : "bm:rhombus", () => (owner === 0 ? new THREE.CylinderGeometry(0.28, 0.28, 0.03, 14) : new THREE.BoxGeometry(0.42, 0.03, 0.42).rotateY(Math.PI / 4)));
  const mark = new THREE.Mesh(markGeo, mat.mark[owner]);
  mark.position.set(footprint * 0.45 - 0.25, 0.02, footprint * 0.45 + 0.1);
  mark.scale.setScalar(footprint >= 4 ? 1.4 : 1);
  root.add(mark);

  const height = VISUAL.buildingHeight[kind];
  const w = footprint * 0.95;
  const proxy = new THREE.Mesh(cache.box(w, height, w), proxyMat);
  proxy.position.y = height / 2;
  root.add(proxy);

  return { root, foundation, walls, roof, scaffold, proxy, kind, foundationTop, wallsHeight };
}

export function buildBuilding(kind: BuildingKind, owner: 0 | 1, mat: Materials, cache: GeometryCache, proxyMat: THREE.Material, footprint: number): BuildingRig {
  return build(kind, owner, mat, cache, proxyMat, footprint);
}

/** Muestra las fases de una obra: cimientos, muros que crecen y tejado, con andamio hasta completarse. */
export function applyConstruction(rig: BuildingRig, complete: boolean, progress: number): void {
  const p = Math.min(1, Math.max(0, progress));
  rig.scaffold.visible = !complete;
  if (complete) {
    rig.walls.visible = true;
    rig.walls.scale.y = 1;
    rig.roof.visible = true;
    rig.roof.scale.setScalar(1);
    return;
  }
  rig.walls.visible = p > 0.04;
  rig.walls.scale.y = Math.max(0.05, Math.min(1, p / 0.7));
  rig.roof.visible = p >= 0.7;
  rig.roof.scale.setScalar(0.5 + 0.5 * Math.min(1, (p - 0.7) / 0.3));
  rig.roof.position.y = rig.foundationTop + rig.wallsHeight;
}
