import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { AssetLibrary } from "./assets";
import { applyWind } from "./wind";

export const OWNER_COLORS = [0x3b82f6, 0xef4444] as const;

/** Material de superficie: PBR en calidad alta y Lambert en baja. */
export type SurfaceMaterial = THREE.MeshLambertMaterial | THREE.MeshStandardMaterial;

/** Catálogo visual: alturas de ancla para barras y marcas, independientes de la lógica. */
export const VISUAL = {
  buildingHeight: { townCenter: 4.4, house: 2.1, barracks: 2.9, tower: 3.9 },
  unitHeight: 1.1,
  barOffset: 0.3,
} as const;

/** Materiales compartidos: una sola instancia por aspecto, nunca por entidad. */
export class Materials {
  readonly stone: SurfaceMaterial;
  readonly moss;
  readonly plaster: SurfaceMaterial;
  readonly planks: SurfaceMaterial;
  readonly bark;
  readonly barkLight;
  readonly roofTile: SurfaceMaterial;
  readonly roofSlate: SurfaceMaterial;
  readonly dark;
  readonly glass;
  readonly straw;
  readonly skin;
  readonly trousers;
  readonly steel: SurfaceMaterial;
  readonly steelDark: SurfaceMaterial;
  readonly leather;
  readonly shaft;
  readonly feather;
  readonly log;
  readonly sack;
  readonly berry;
  readonly scaffold;
  readonly hood;
  readonly leafPine;
  readonly leafOak;
  readonly leafBirch;
  readonly leafBerry;
  readonly leafBush: readonly [THREE.MeshLambertMaterial, THREE.MeshLambertMaterial];
  readonly dryBush;
  readonly team: readonly [THREE.MeshLambertMaterial, THREE.MeshLambertMaterial];
  readonly flag: readonly [THREE.MeshLambertMaterial, THREE.MeshLambertMaterial];
  readonly mark: readonly [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial];
  readonly shadow;

  constructor(a: AssetLibrary) {
    const t = a.textures;
    const l = (color: number, map?: THREE.Texture, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial =>
      a.lambert({ color, ...(map ? { map } : {}), ...extra });
    const s = (color: number, map: THREE.Texture | undefined, extra: THREE.MeshStandardMaterialParameters = {}): SurfaceMaterial =>
      a.surface({ color, ...(map ? { map } : {}), ...extra });
    this.stone = s(0xffffff, t.stone, { roughness: 0.95, metalness: 0, bumpMap: t.stone, bumpScale: 1.6 });
    this.moss = l(0xffffff, t.grass);
    this.plaster = s(0xffffff, t.plaster, { roughness: 0.9, metalness: 0, bumpMap: t.plaster, bumpScale: 0.8 });
    this.planks = s(0xffffff, t.planks, { roughness: 0.82, metalness: 0, bumpMap: t.planks, bumpScale: 1.2 });
    this.bark = l(0xffffff, t.bark);
    this.barkLight = l(0xffffff, t.barkLight);
    this.roofTile = s(0xffffff, t.roofTile, { roughness: 0.68, metalness: 0, side: THREE.DoubleSide });
    this.roofSlate = s(0xffffff, t.roofSlate, { roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
    this.dark = l(0x2a1d14);
    this.glass = l(0x20303f);
    this.straw = l(0xd6b85a);
    this.skin = l(0xe0b08c);
    this.trousers = l(0x5a4632);
    this.steel = s(0xa7b0ba, undefined, { metalness: 0.8, roughness: 0.35 });
    this.steelDark = s(0x5c646d, undefined, { metalness: 0.8, roughness: 0.45 });
    this.leather = l(0x6b4a2b);
    this.shaft = l(0xb89a6a);
    this.feather = l(0xf2f2f2);
    this.log = l(0x7a5230);
    this.sack = l(0xcdb78a);
    this.berry = l(0xc0203a);
    this.scaffold = l(0x9a7a4c);
    this.hood = l(0x3f6b3a);
    this.leafPine = l(0x2d6a3a, t.leaf);
    this.leafOak = l(0x4f8a2f, t.leaf);
    this.leafBirch = l(0x8fb04a, t.leaf);
    this.leafBerry = l(0x2a5f33, t.leaf);
    if (a.quality === "high") {
      // Oclusión ambiental horneada en el color de vértice de las copas y balanceo por viento.
      for (const m of [this.leafPine, this.leafOak, this.leafBirch]) {
        m.vertexColors = true;
        applyWind(m, 0.032, "tree");
      }
    }
    this.leafBush = [l(0x5f8f3a, t.leaf), l(0x7a9a4a, t.leaf)];
    this.dryBush = l(0x6b5a3a);
    this.team = [l(OWNER_COLORS[0]), l(OWNER_COLORS[1])];
    this.flag = [l(OWNER_COLORS[0], undefined, { side: THREE.DoubleSide }), l(OWNER_COLORS[1], undefined, { side: THREE.DoubleSide })];
    // Marca independiente del color (RF-10): anillo blanco para el jugador, rombo hueco oscuro para el rival.
    this.mark = [a.basic({ color: 0xffffff }), a.basic({ color: 0x111111 })];
    this.shadow = a.basic({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
  }
}

/** Grosor del contorno de las marcas: 25 % del radio exterior, nunca menor de 0,05. */
function markThickness(outer: number): number {
  return Math.max(0.05, outer * 0.25);
}

/** Anillo plano (solo contorno) de radio exterior `outer`, tumbado sobre el suelo. */
export function ringMarkGeometry(outer: number): THREE.BufferGeometry {
  return new THREE.RingGeometry(outer - markThickness(outer), outer, 20).rotateX(-Math.PI / 2);
}

/** Rombo plano hueco de semidiagonal `outer`; el grosor se mide perpendicular a los lados. */
export function rhombusMarkGeometry(outer: number): THREE.BufferGeometry {
  const inner = outer - markThickness(outer) * Math.SQRT2;
  const shape = new THREE.Shape();
  shape.moveTo(outer, 0).lineTo(0, outer).lineTo(-outer, 0).lineTo(0, -outer).closePath();
  const hole = new THREE.Path();
  hole.moveTo(inner, 0).lineTo(0, -inner).lineTo(-inner, 0).lineTo(0, inner).closePath();
  shape.holes.push(hole);
  return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

/** Caja con UV proporcionales a su tamaño para que las texturas repetidas no se estiren. */
export function texBox(w: number, h: number, d: number, density = 1): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face++) {
    const [du, dv] = dims[face]!;
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      uv.setXY(idx, uv.getX(idx) * du * density, uv.getY(idx) * dv * density);
    }
  }
  return g;
}

export function texPlane(w: number, h: number, density = 1): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * density, uv.getY(i) * h * density);
  return g;
}

/** Prisma triangular con la cumbrera a lo largo de X: laderas y hastiales por separado. */
export function gableRoof(w: number, d: number, h: number): { slopes: THREE.BufferGeometry; ends: THREE.BufferGeometry } {
  const hw = w / 2;
  const hd = d / 2;
  const slopeLen = Math.hypot(hd, h);
  const quad = (a: number[], b: number[], c: number[], e: number[]): number[] => [...a, ...b, ...c, ...a, ...c, ...e];
  const front = quad([-hw, 0, hd], [hw, 0, hd], [hw, h, 0], [-hw, h, 0]);
  const back = quad([hw, 0, -hd], [-hw, 0, -hd], [-hw, h, 0], [hw, h, 0]);
  const slopes = new THREE.BufferGeometry();
  slopes.setAttribute("position", new THREE.Float32BufferAttribute([...front, ...back], 3));
  const uvQuad = [0, 0, w, 0, w, slopeLen, 0, 0, w, slopeLen, 0, slopeLen];
  slopes.setAttribute("uv", new THREE.Float32BufferAttribute([...uvQuad, ...uvQuad], 2));
  slopes.computeVertexNormals();

  const tri = (x: number): number[] => [x, 0, -hd, x, 0, hd, x, h, 0];
  const ends = new THREE.BufferGeometry();
  ends.setAttribute("position", new THREE.Float32BufferAttribute([...tri(hw), ...tri(-hw)], 3));
  ends.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, d, 0, d / 2, h, 0, 0, d, 0, d / 2, h], 2));
  ends.computeVertexNormals();
  return { slopes, ends };
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts);
  if (!g) throw new Error("No se pudieron combinar geometrías");
  parts.forEach((p) => p.dispose());
  return g;
}

function placed(g: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

export type TreeVariant = 0 | 1 | 2;
export interface TreeGeometry {
  trunk: THREE.BufferGeometry;
  crown: THREE.BufferGeometry;
}

/** Geometrías de árbol (pino, roble y abedul alto), compartidas por nodos y decoración. */
export function buildTreeGeometries(a: AssetLibrary): readonly [TreeGeometry, TreeGeometry, TreeGeometry] {
  const cone = (r: number, h: number, y: number): THREE.BufferGeometry => placed(new THREE.ConeGeometry(r, h, 8), 0, y, 0);
  const sphere = (r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry =>
    placed(new THREE.SphereGeometry(r, 8, 6), x, y, z, sx, sy, sz);
  const pine: TreeGeometry = {
    trunk: placed(new THREE.CylinderGeometry(0.08, 0.12, 0.75, 6), 0, 0.375, 0),
    crown: merged([cone(0.62, 0.8, 0.9), cone(0.5, 0.75, 1.25), cone(0.38, 0.7, 1.6), cone(0.26, 0.6, 1.95)]),
  };
  const oak: TreeGeometry = {
    trunk: placed(new THREE.CylinderGeometry(0.1, 0.16, 0.85, 6), 0, 0.425, 0),
    crown: merged([
      sphere(0.5, 0, 1.2, 0, 1, 0.85, 1),
      sphere(0.34, 0.28, 1.0, 0.1),
      sphere(0.32, -0.25, 1.05, -0.12),
      sphere(0.3, 0.05, 1.55, -0.05),
      sphere(0.26, -0.12, 1.28, 0.3),
      sphere(0.24, 0.3, 1.38, -0.2),
    ]),
  };
  const birch: TreeGeometry = {
    trunk: placed(new THREE.CylinderGeometry(0.055, 0.09, 1.3, 6), 0, 0.65, 0),
    crown: merged([sphere(0.36, 0, 1.6, 0, 1, 1.5, 1), sphere(0.24, 0.16, 1.25, 0.1), sphere(0.2, -0.14, 1.9, 0.08), sphere(0.2, -0.16, 1.4, -0.1)]),
  };
  for (const t of [pine, oak, birch]) {
    bakeCrownShade(t.crown);
    a.track(t.trunk);
    a.track(t.crown);
  }
  return [pine, oak, birch];
}

/** Oscurece la parte baja de la copa (oclusión ambiental barata) con color de vértice. */
function bakeCrownShade(g: THREE.BufferGeometry): void {
  const pos = g.getAttribute("position");
  g.computeBoundingBox();
  const { min, max } = g.boundingBox!;
  const span = Math.max(0.001, max.y - min.y);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - min.y) / span;
    colors.fill(0.58 + 0.42 * Math.pow(t, 0.8), i * 3, i * 3 + 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

export interface BushGeometry {
  crown: THREE.BufferGeometry;
}

export function buildBushGeometries(a: AssetLibrary): readonly [BushGeometry, BushGeometry] {
  const sphere = (r: number, x: number, y: number, z: number, sy = 0.75): THREE.BufferGeometry => placed(new THREE.SphereGeometry(r, 7, 5), x, y, z, 1, sy, 1);
  const round: BushGeometry = { crown: merged([sphere(0.28, 0, 0.2, 0), sphere(0.2, 0.22, 0.14, 0.08), sphere(0.18, -0.2, 0.13, -0.1)]) };
  const fern: BushGeometry = { crown: merged([placed(new THREE.ConeGeometry(0.3, 0.38, 6), 0, 0.19, 0), placed(new THREE.ConeGeometry(0.2, 0.3, 6), 0.2, 0.15, 0.1)]) };
  a.track(round.crown);
  a.track(fern.crown);
  return [round, fern];
}
