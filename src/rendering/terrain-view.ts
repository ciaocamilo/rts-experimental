import * as THREE from "three";
import type { TerrainRect } from "../core/types";
import type { AssetLibrary } from "./assets";
import { type Materials, texPlane, type TreeGeometry } from "./models";
import { type BushSpec, mulberry32, planScenery, ROCK_HEIGHT, type SceneryPlan, type TreeSpec } from "./scenery";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { BushGeometry } from "./models";
import { buildRiverGeometry, buildWaterGeometry, cornerRadius, waterSeed, type WaterLayer } from "./water";
import { WaterMaterial } from "./water-material";
import { applyWind, WIND } from "./wind";
import { buildMountainGeometry, buildValleyPixels, valleyPath, VALLEY_RES } from "./relief";
import { buildBridge } from "./bridge";
import { buildTentGeometry, pennantColor } from "./camp";

/** Máximo de mechones de hierba instanciados y margen respecto a roca y agua (P5-H08). */
const MAX_TUFTS = 6000;
const TUFT_ROCK_MARGIN = 0.15;
const TUFT_WATER_MARGIN = 1.1;
/** Altura de la cima de una montaña, en celdas. */
const MOUNTAIN_PEAK = 5;
/** Prolongación de un afluente dentro del cauce principal para que ambos se fundan, en celdas. */
const CANAL_OVERLAP = 2.2;

/** Semilla estable del valle a partir de su posición. */
function valleySeed(t: TerrainRect): number {
  return (t.x * 31 + t.z * 17) % 9973;
}

/** Roca con la cara superior irregular: solo baja la cresta (nunca sube) y no toca el rectángulo lógico. */
function roughRock(w: number, h: number, d: number, density: number, seed: number): THREE.BoxGeometry {
  const sx = Math.max(1, Math.ceil(w * 1.5));
  const sz = Math.max(1, Math.ceil(d * 1.5));
  const g = new THREE.BoxGeometry(w, h, d, sx, 2, sz);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const counts = [(sz + 1) * 3, (sz + 1) * 3, (sx + 1) * (sz + 1), (sx + 1) * (sz + 1), (sx + 1) * 3, (sx + 1) * 3];
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  let offset = 0;
  counts.forEach((count, face) => {
    const [du, dv] = dims[face]!;
    for (let i = 0; i < count; i++) uv.setXY(offset + i, uv.getX(offset + i) * du * density, uv.getY(offset + i) * dv * density);
    offset += count;
  });
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < h / 2 - 1e-4) continue;
    const n = Math.sin((pos.getX(i) + seed) * 12.9898 + (pos.getZ(i) + seed * 0.7) * 78.233) * 43758.5453;
    pos.setY(i, h / 2 - (n - Math.floor(n)) * 0.14);
  }
  g.computeVertexNormals();
  return g;
}

/** Nada se dibuja fuera del rectángulo del mapa: el exterior es el fondo negro (P6-H07). */
/** Orilla húmeda y agua: anillos desde el borde hacia el centro, con opacidad creciente y más profundidad. */
const SHORE_LAYERS: readonly WaterLayer[] = [
  { offset: 0, alpha: 0, shade: [0.72, 0.64, 0.45] },
  { offset: 0.35, alpha: 0.9, shade: [0.72, 0.64, 0.45] },
  { offset: 0.9, alpha: 1, shade: [0.6, 0.54, 0.38] },
];
const WATER_LAYERS: readonly WaterLayer[] = [
  { offset: 0.3, alpha: 0, shade: [1, 1, 1] },
  { offset: 0.75, alpha: 0.55, shade: [0.95, 0.98, 1] },
  { offset: 1.4, alpha: 0.9, shade: [0.82, 0.9, 0.97] },
  { offset: 1.8, alpha: 0.94, shade: [0.68, 0.8, 0.9] },
];

/** Suelo, roca, agua y vegetación decorativa. Es solo aspecto: la lógica del terreno vive en el núcleo. */
export class TerrainView {
  readonly group = new THREE.Group();
  private owned: { dispose(): void }[] = [];
  private plan: SceneryPlan = { trees: [], bushes: [] };
  private readonly groundMaterial: THREE.MeshLambertMaterial;
  private readonly tuftMaterial: THREE.MeshLambertMaterial;
  private readonly aoMaterial: THREE.MeshBasicMaterial;
  private readonly toneMaterial: THREE.MeshBasicMaterial;
  private readonly forestFloorMaterial: THREE.MeshBasicMaterial;
  private readonly campFloorMaterial: THREE.MeshBasicMaterial;
  private readonly campGeometry = new Map<string, THREE.BufferGeometry>();
  private readonly trailMaterial: THREE.MeshBasicMaterial;
  private readonly mountainMaterial: THREE.MeshLambertMaterial;
  private readonly shoreMaterial: THREE.MeshLambertMaterial;
  private readonly waterMaterial: THREE.MeshPhongMaterial;
  private readonly shaderWater: WaterMaterial | null;
  private readonly waterMeshes: THREE.Mesh[] = [];
  private readonly rippleMaterial: THREE.MeshBasicMaterial;
  private readonly rockMaterials: THREE.Material[];
  private readonly waterMap: THREE.Texture;
  private readonly rippleMap: THREE.Texture;
  private readonly animateWater: boolean;

  constructor(
    private readonly assets: AssetLibrary,
    private readonly mat: Materials,
    private readonly trees: readonly [TreeGeometry, TreeGeometry, TreeGeometry],
    private readonly bushes: readonly [BushGeometry, BushGeometry],
  ) {
    this.animateWater = assets.quality === "high";
    this.groundMaterial = assets.lambert({ map: assets.textures.grass, ...(assets.quality === "high" ? { bumpMap: assets.textures.grass, bumpScale: 0.9 } : {}) });
    this.tuftMaterial = assets.lambert({ map: assets.textures.tuft, alphaTest: 0.45, side: THREE.DoubleSide });
    applyWind(this.tuftMaterial, 0.3, "tuft");
    this.aoMaterial = assets.basic({ map: assets.textures.contact, transparent: true, depthWrite: false, toneMapped: false });
    this.toneMaterial = assets.basic({ map: assets.textures.tone, transparent: true, depthWrite: false });
    this.shoreMaterial = assets.lambert({ vertexColors: true, transparent: true, depthWrite: false });
    this.forestFloorMaterial = assets.basic({ color: 0x1c3a1d, transparent: true, opacity: 0.42, depthWrite: false });
    this.campFloorMaterial = assets.basic({ color: 0x6e5a3a, transparent: true, opacity: 0.6, depthWrite: false });
    this.trailMaterial = assets.basic({ vertexColors: true, transparent: true, depthWrite: false });
    this.mountainMaterial = assets.lambert({ vertexColors: true });
    this.waterMap = assets.textures.water;
    this.rippleMap = assets.textures.waterRipple;
    this.waterMaterial = this.assets.track(
      new THREE.MeshPhongMaterial({ map: this.waterMap, vertexColors: true, transparent: true, depthWrite: false, specular: 0x6f8fa8, shininess: 55 }),
    );
    this.rippleMaterial = assets.basic({ map: this.rippleMap, vertexColors: true, transparent: true, depthWrite: false, opacity: 0.55 });
    this.shaderWater = assets.quality === "high" ? assets.track(new WaterMaterial(assets)) : null;
    this.rockMaterials = [mat.stone, mat.stone, mat.moss, mat.stone, mat.stone, mat.stone];
  }

  get scenery(): SceneryPlan {
    return this.plan;
  }

  private own<T extends { dispose(): void }>(resource: T): T {
    this.owned.push(resource);
    return resource;
  }

  private clear(): void {
    for (const r of this.owned) r.dispose();
    this.owned = [];
    this.campGeometry.clear();
    this.waterMeshes.length = 0;
    this.group.clear();
  }

  build(width: number, depth: number, terrain: readonly TerrainRect[]): void {
    this.clear();
    const ground = new THREE.Mesh(this.own(texPlane(width, depth, 0.2).rotateX(-Math.PI / 2).translate(width / 2, 0, depth / 2)), this.groundMaterial);
    ground.matrixAutoUpdate = false;
    ground.receiveShadow = true;
    this.group.add(ground);

    if (this.assets.quality === "high") {
      const tone = new THREE.Mesh(this.own(new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2).translate(width / 2, 0.008, depth / 2)), this.toneMaterial);
      tone.renderOrder = 1;
      this.group.add(tone);
    }

    const bridges = terrain.filter((t) => t.kind === "bridge");
    const isRiver = (t: TerrainRect): boolean => t.kind === "water" && bridges.some((b) => b.x === t.x && b.w === t.w);
    const river = terrain.filter(isRiver);
    if (river.length > 0) this.addRiver([...river, ...bridges.filter((b) => river.some((r) => r.x === b.x && r.w === b.w))]);
    // Un cauce estrecho y largo que toca el río principal es un afluente: se dibuja continuo y desemboca en él.
    const canalSide = (t: TerrainRect): 1 | -1 | 0 => {
      if (t.kind !== "water" || isRiver(t) || t.w < 3 * t.h || t.h > 4) return 0;
      if (river.some((r) => r.x === t.x + t.w)) return 1;
      return river.some((r) => r.x + r.w === t.x) ? -1 : 0;
    };
    for (const t of terrain) {
      if (t.kind === "bridge") this.addBridge(t);
      else if (t.kind === "water") {
        const side = canalSide(t);
        if (side !== 0) this.addCanal(t, side);
        else if (!isRiver(t)) this.addWater(t);
      } else if (t.kind === "forest") this.addForestFloor(t);
      else if (t.kind === "mountain") this.addMountain(t);
      else if (t.kind === "valley") this.addValley(t);
      else if (t.kind === "camp") this.addCamp(t, width);
      else this.addRock(t);
    }

    this.plan = planScenery(width, depth, terrain, 1337, this.assets.quality === "high" ? 1 : 0.5);
    this.addTrees(this.plan.trees);
    if (this.assets.quality === "high") {
      this.addBushes(this.plan.bushes);
      this.addGrass(width, depth, terrain);
      this.addTreeShade(this.plan.trees);
    }
  }

  /** Mechones de hierba que se balancean con el viento; nunca sobre roca ni dentro del agua. */
  private addGrass(width: number, depth: number, terrain: readonly TerrainRect[]): void {
    const rng = mulberry32(8841);
    const blocked = (x: number, z: number): boolean =>
      terrain.some((t) => {
        if (t.kind === "valley") return false;
        const m = t.kind === "water" ? TUFT_WATER_MARGIN : TUFT_ROCK_MARGIN;
        return x > t.x - m && x < t.x + t.w + m && z > t.z - m && z < t.z + t.h + m;
      });
    const spots: { x: number; z: number; s: number; rot: number; tone: number }[] = [];
    for (let i = 0; i < MAX_TUFTS * 1.4 && spots.length < MAX_TUFTS; i++) {
      const x = rng() * width;
      const z = rng() * depth;
      const s = 0.7 + rng() * 0.7;
      const rot = rng() * Math.PI;
      const tone = rng();
      if (!blocked(x, z)) spots.push({ x, z, s, rot, tone });
    }
    // Los valles tienen hierba más alta y densa, salvo sobre la senda; flujo aleatorio propio para no alterar el resto del mapa.
    const valleyRng = mulberry32(5521);
    for (const t of terrain) {
      if (t.kind !== "valley") continue;
      const seed = valleySeed(t);
      const along = t.w >= t.h;
      const length = along ? t.w : t.h;
      const across = along ? t.h : t.w;
      for (let i = 0; i < t.w * t.h * 2.2; i++) {
        const x = t.x + valleyRng() * t.w;
        const z = t.z + valleyRng() * t.h;
        const s = 1 + valleyRng() * 0.9;
        const rot = valleyRng() * Math.PI;
        const tone = valleyRng();
        const a = along ? x - t.x : z - t.z;
        const c = along ? z - t.z : x - t.x;
        if (a >= 0 && a <= length && Math.abs(c - valleyPath(a, across, seed)) < 0.75) continue;
        spots.push({ x, z, s, rot, tone });
      }
    }
    const w = 0.55;
    const h = 0.42;
    const plane = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
    const crossed = this.own(mergeGeometries([plane, plane.clone().rotateY(Math.PI / 2)])!);
    plane.dispose();
    const mesh = this.own(new THREE.InstancedMesh(crossed, this.tuftMaterial, spots.length));
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    spots.forEach((p, i) => {
      dummy.position.set(p.x, 0, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.setScalar(0.7 + 0.5 * p.tone));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
  }

  /** Sombra de contacto bajo cada árbol: un disco oscuro suave instanciado. */
  private addTreeShade(specs: readonly TreeSpec[]): void {
    if (specs.length === 0) return;
    const geometry = this.own(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    const mesh = this.own(new THREE.InstancedMesh(geometry, this.aoMaterial, specs.length));
    const dummy = new THREE.Object3D();
    specs.forEach((s, i) => {
      dummy.position.set(s.x, s.y + 0.02, s.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1.5 * s.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.renderOrder = 1;
    this.group.add(mesh);
  }

  /** El bosque es suelo: una mancha de hojarasca oscura bajo los árboles; el obstáculo lógico sigue siendo el rectángulo. */
  private addForestFloor(t: TerrainRect): void {
    const geometry = this.own(new THREE.PlaneGeometry(t.w, t.h).rotateX(-Math.PI / 2).translate(t.x + t.w / 2, 0.012, t.z + t.h / 2));
    const floor = new THREE.Mesh(geometry, this.forestFloorMaterial);
    floor.renderOrder = 1;
    this.group.add(floor);
  }

  /** Tienda de campaña: escenario fijo sobre un claro de tierra pisada; la puerta mira al enemigo (P10-R20). */
  private addCamp(t: TerrainRect, mapWidth: number): void {
    const cx = t.x + t.w / 2;
    const cz = t.z + t.h / 2;
    const ground = new THREE.Mesh(this.own(new THREE.PlaneGeometry(t.w - 0.2, t.h - 0.2).rotateX(-Math.PI / 2).translate(cx, 0.014, cz)), this.campFloorMaterial);
    ground.renderOrder = 1;
    this.group.add(ground);

    const key = cx < mapWidth / 2 ? "west" : "east";
    let geometry = this.campGeometry.get(key);
    if (!geometry) {
      geometry = this.own(buildTentGeometry(pennantColor(cx, mapWidth)));
      this.campGeometry.set(key, geometry);
    }
    const tent = new THREE.Mesh(geometry, this.mountainMaterial);
    const yaw = (((t.x * 7 + t.z * 13) % 5) - 2) * 0.04;
    tent.position.set(cx, 0, cz);
    tent.rotation.y = (key === "east" ? Math.PI : 0) + yaw;
    tent.castShadow = tent.receiveShadow = true;
    this.group.add(tent);
  }

  /** Macizo montañoso: relieve irregular con laderas empinadas que cubre el rectángulo bloqueado; solo aspecto. */
  private addMountain(t: TerrainRect): void {
    const geometry = this.own(buildMountainGeometry(t.w, t.h, t.x * 7 + t.z * 13 + 1, MOUNTAIN_PEAK));
    const mesh = new THREE.Mesh(geometry, this.mountainMaterial);
    mesh.position.set(t.x + t.w / 2, 0, t.z + t.h / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** El valle es suelo transitable: una mancha de hierba más oscura y una senda de tierra que lo recorre. */
  private addValley(t: TerrainRect): void {
    const seed = valleySeed(t);
    const texture = this.own(new THREE.DataTexture(buildValleyPixels(t.w, t.h, seed), t.w * VALLEY_RES, t.h * VALLEY_RES, THREE.RGBAFormat, THREE.UnsignedByteType));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    const material = this.own(this.assets.basic({ map: texture, transparent: true, depthWrite: false }));
    const tint = new THREE.Mesh(this.own(new THREE.PlaneGeometry(t.w, t.h).rotateX(-Math.PI / 2).translate(t.x + t.w / 2, 0.011, t.z + t.h / 2)), material);
    tint.renderOrder = 1;
    this.group.add(tint, this.valleyTrail(t, seed));
  }

  /** Senda de tierra sinuosa de bordes suaves a lo largo del eje largo del valle. */
  private valleyTrail(t: TerrainRect, seed: number): THREE.Mesh {
    const along = t.w >= t.h;
    const length = along ? t.w : t.h;
    const across = along ? t.h : t.w;
    const segments = Math.max(4, Math.round(length * 2));
    const columns: readonly (readonly [number, number])[] = [[-0.85, 0], [-0.45, 0.55], [0, 0.72], [0.45, 0.55], [0.85, 0]];
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    for (let s = 0; s <= segments; s++) {
      const a = (length * s) / segments;
      const lateral = valleyPath(a, across, seed);
      for (const [offset, alpha] of columns) {
        const c = lateral + offset;
        positions.push(along ? t.x + a : t.x + c, 0.013, along ? t.z + c : t.z + a);
        const warm = 1 - Math.abs(offset) * 0.35;
        colors.push(0.5 * warm, 0.4 * warm, 0.27 * warm, alpha);
      }
    }
    const n = columns.length;
    for (let s = 0; s < segments; s++) {
      for (let c = 0; c < n - 1; c++) {
        const i = s * n + c;
        // Cara superior (+y) en ambos ejes: el sentido cambia si la senda corre a lo largo de z.
        if (along) indices.push(i, i + 1, i + n, i + 1, i + n + 1, i + n);
        else indices.push(i, i + n, i + 1, i + 1, i + n, i + n + 1);
      }
    }
    const geometry = this.own(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, this.trailMaterial);
    mesh.renderOrder = 1;
    return mesh;
  }

  private addRock(t: TerrainRect): void {
    const geometry = this.own(roughRock(t.w, ROCK_HEIGHT, t.h, 0.6, t.x * 3 + t.z));
    const rock = new THREE.Mesh(geometry, this.rockMaterials);
    rock.position.set(t.x + t.w / 2, ROCK_HEIGHT / 2, t.z + t.h / 2);
    rock.castShadow = rock.receiveShadow = true;
    this.group.add(rock);
  }

  /** Una sola cinta de agua que une los tramos y pasa bajo el puente, de borde a borde del mapa. */
  private addRiver(rects: readonly TerrainRect[]): void {
    const x = rects[0]!.x;
    const w = rects[0]!.w;
    const z0 = Math.min(...rects.map((r) => r.z));
    const z1 = Math.max(...rects.map((r) => r.z + r.h));
    const length = z1 - z0;
    const origin = { x: x + w / 2, z: z0 + length / 2 };
    const seed = waterSeed(x, z0);
    const fit = Math.min(1, Math.max(0.1, (0.9 * cornerRadius(w, w) - Math.min(0.4, w * 0.08)) / 1.8));
    const scale = (layers: readonly WaterLayer[]): WaterLayer[] => layers.map((l) => ({ ...l, offset: l.offset * fit }));
    const shore = new THREE.Mesh(this.own(buildRiverGeometry(w, length, seed, scale(SHORE_LAYERS), origin, 0)), this.shoreMaterial);
    shore.position.set(origin.x, 0.012, origin.z);
    shore.renderOrder = 1;
    const water = new THREE.Mesh(this.own(buildRiverGeometry(w, length, seed, scale(WATER_LAYERS), origin, 0.12)), this.shaderWater ?? this.waterMaterial);
    water.position.set(origin.x, 0.05, origin.z);
    water.renderOrder = 2;
    this.waterMeshes.push(water);
    this.group.add(shore, water);
  }

  private addBridge(t: TerrainRect): void {
    for (const part of buildBridge(t, this.mat)) {
      const mesh = new THREE.Mesh(this.own(part.geometry), part.material);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** Afluente: estanque en el nacimiento y una cinta continua que se interna en el río principal (`side` indica su lado). */
  private addCanal(t: TerrainRect, side: 1 | -1): void {
    const pond = Math.min(6, t.w / 2);
    this.addWater({ x: side > 0 ? t.x : t.x + t.w - pond, z: t.z, w: pond, h: t.h, kind: "water" });
    const x0 = side > 0 ? t.x + pond / 2 : t.x - CANAL_OVERLAP;
    const x1 = side > 0 ? t.x + t.w + CANAL_OVERLAP : t.x + t.w - pond / 2;
    const length = x1 - x0;
    const origin = { x: (x0 + x1) / 2, z: t.z + t.h / 2 };
    const seed = waterSeed(t.x, t.z) + 3;
    const fit = Math.min(1, Math.max(0.1, (0.9 * cornerRadius(t.h, t.h) - Math.min(0.4, t.h * 0.08)) / 1.8));
    const scale = (layers: readonly WaterLayer[]): WaterLayer[] => layers.map((l) => ({ ...l, offset: l.offset * fit }));
    const shore = new THREE.Mesh(this.own(buildRiverGeometry(t.h, length, seed, scale(SHORE_LAYERS), origin, 0)), this.shoreMaterial);
    shore.position.set(origin.x, 0.012, origin.z);
    const water = new THREE.Mesh(this.own(buildRiverGeometry(t.h, length, seed, scale(WATER_LAYERS), origin, 0.12)), this.shaderWater ?? this.waterMaterial);
    water.position.set(origin.x, 0.056, origin.z);
    // La cinta se construye a lo largo de z: un cuarto de vuelta la pone a lo largo de x.
    shore.rotation.y = water.rotation.y = Math.PI / 2;
    shore.renderOrder = 1;
    water.renderOrder = 2;
    this.waterMeshes.push(water);
    this.group.add(shore, water);
  }

  private addWater(t: TerrainRect): void {
    // La silueta visual es orgánica y queda dentro del rectángulo lógico, que sigue siendo el obstáculo real.
    const seed = waterSeed(t.x, t.z);
    const origin = { x: t.x + t.w / 2, z: t.z + t.h / 2 };
    const fit = Math.min(1, Math.max(0.1, (0.9 * cornerRadius(t.w, t.h) - Math.min(0.4, Math.min(t.w, t.h) * 0.08)) / 1.8));
    const scale = (layers: readonly WaterLayer[]): WaterLayer[] => layers.map((l) => ({ ...l, offset: l.offset * fit }));
    const shore = new THREE.Mesh(this.own(buildWaterGeometry(t.w, t.h, seed, scale(SHORE_LAYERS), origin, 0)), this.shoreMaterial);
    shore.position.set(origin.x, 0.012, origin.z);
    shore.renderOrder = 1;
    const waterGeometry = this.own(buildWaterGeometry(t.w, t.h, seed, scale(WATER_LAYERS), origin, 0.12));
    const water = new THREE.Mesh(waterGeometry, this.shaderWater ?? this.waterMaterial);
    water.position.set(origin.x, 0.05, origin.z);
    water.renderOrder = 2;
    this.waterMeshes.push(water);
    this.group.add(shore, water);
    if (this.animateWater && !this.shaderWater) {
      const ripples = new THREE.Mesh(this.own(buildWaterGeometry(t.w, t.h, seed, scale(WATER_LAYERS), origin, 0.21)), this.rippleMaterial);
      ripples.position.set(origin.x, 0.058, origin.z);
      ripples.renderOrder = 3;
      this.group.add(ripples);
    }
  }

  private addTrees(specs: readonly TreeSpec[]): void {
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const leafs = [this.mat.leafPine, this.mat.leafOak, this.mat.leafBirch];
    for (const variant of [0, 1, 2] as const) {
      const list = specs.filter((s) => s.variant === variant);
      if (list.length === 0) continue;
      const geo = this.trees[variant];
      const trunk = this.own(new THREE.InstancedMesh(geo.trunk, variant === 2 ? this.mat.barkLight : this.mat.bark, list.length));
      const crown = this.own(new THREE.InstancedMesh(geo.crown, leafs[variant]!, list.length));
      list.forEach((s, i) => {
        dummy.position.set(s.x, s.y, s.z);
        dummy.rotation.set(0, s.rot, 0);
        dummy.scale.setScalar(s.scale);
        dummy.updateMatrix();
        trunk.setMatrixAt(i, dummy.matrix);
        crown.setMatrixAt(i, dummy.matrix);
        crown.setColorAt(i, color.setScalar(0.72 + 0.4 * s.tone));
      });
      trunk.instanceMatrix.needsUpdate = true;
      crown.instanceMatrix.needsUpdate = true;
      trunk.castShadow = crown.castShadow = true;
      crown.receiveShadow = true;
      this.group.add(trunk, crown);
    }
  }

  private addBushes(specs: readonly BushSpec[]): void {
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (const variant of [0, 1] as const) {
      const list = specs.filter((s) => s.variant === variant);
      if (list.length === 0) continue;
      const mesh = this.own(new THREE.InstancedMesh(this.bushes[variant].crown, this.mat.leafBush[variant], list.length));
      list.forEach((s, i) => {
        dummy.position.set(s.x, s.y, s.z);
        dummy.rotation.set(0, s.rot, 0);
        dummy.scale.setScalar(s.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, color.setScalar(0.75 + 0.35 * s.tone));
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    }
  }

  /** Si el shader del agua no compila, vuelve al material de P4 (con las ondas animadas). */
  useFallbackWater(): void {
    if (!this.shaderWater) return;
    for (const mesh of this.waterMeshes) mesh.material = this.waterMaterial;
  }

  /** Corriente suave del agua; con tiempo congelado la superficie se detiene. */
  update(animTime: number): void {
    if (!this.animateWater) return;
    WIND.value = animTime;
    this.shaderWater?.setTime(animTime);
    this.waterMap.offset.set(animTime * 0.012, animTime * 0.006);
    this.rippleMap.offset.set(-animTime * 0.02, animTime * 0.014);
  }

  dispose(): void {
    this.clear();
  }
}
