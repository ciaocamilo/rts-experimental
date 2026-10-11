import * as THREE from "three";
import type { TerrainRect } from "../core/types";
import type { AssetLibrary } from "./assets";
import { type Materials, texBox, texPlane, type TreeGeometry } from "./models";
import { type BushSpec, planScenery, ROCK_HEIGHT, type SceneryPlan, type TreeSpec } from "./scenery";
import type { BushGeometry } from "./models";

const GROUND_MARGIN = 26;

/** Suelo, roca, agua y vegetación decorativa. Es solo aspecto: la lógica del terreno vive en el núcleo. */
export class TerrainView {
  readonly group = new THREE.Group();
  private owned: { dispose(): void }[] = [];
  private plan: SceneryPlan = { trees: [], bushes: [] };
  private readonly groundMaterial: THREE.MeshLambertMaterial;
  private readonly toneMaterial: THREE.MeshBasicMaterial;
  private readonly shoreMaterial: THREE.MeshLambertMaterial;
  private readonly waterMaterial: THREE.MeshPhongMaterial;
  private readonly rockMaterials: THREE.Material[];
  private readonly waterMap: THREE.Texture;
  private readonly animateWater: boolean;

  constructor(
    private readonly assets: AssetLibrary,
    private readonly mat: Materials,
    private readonly trees: readonly [TreeGeometry, TreeGeometry, TreeGeometry],
    private readonly bushes: readonly [BushGeometry, BushGeometry],
  ) {
    this.animateWater = assets.quality === "high";
    this.groundMaterial = assets.lambert({ map: assets.textures.grass });
    this.toneMaterial = assets.basic({ map: assets.textures.tone, transparent: true, depthWrite: false });
    this.shoreMaterial = assets.lambert({ color: 0xc8b98a });
    this.waterMap = assets.textures.water;
    this.waterMaterial = this.assets.track(
      new THREE.MeshPhongMaterial({ map: this.waterMap, transparent: true, opacity: 0.88, specular: 0x6f8fa8, shininess: 55 }),
    );
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
    this.group.clear();
  }

  build(width: number, depth: number, terrain: readonly TerrainRect[]): void {
    this.clear();
    const gw = width + GROUND_MARGIN * 2;
    const gd = depth + GROUND_MARGIN * 2;
    const ground = new THREE.Mesh(this.own(texPlane(gw, gd, 0.2).rotateX(-Math.PI / 2).translate(width / 2, 0, depth / 2)), this.groundMaterial);
    ground.matrixAutoUpdate = false;
    this.group.add(ground);

    if (this.assets.quality === "high") {
      const tone = new THREE.Mesh(this.own(new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2).translate(width / 2, 0.008, depth / 2)), this.toneMaterial);
      tone.renderOrder = 1;
      this.group.add(tone);
    }

    for (const t of terrain) {
      if (t.kind === "water") this.addWater(t);
      else this.addRock(t);
    }

    this.plan = planScenery(width, depth, terrain);
    this.addTrees(this.plan.trees);
    if (this.assets.quality === "high") this.addBushes(this.plan.bushes);
  }

  private addRock(t: TerrainRect): void {
    const geometry = this.own(texBox(t.w, ROCK_HEIGHT, t.h, 0.6));
    const rock = new THREE.Mesh(geometry, this.rockMaterials);
    rock.position.set(t.x + t.w / 2, ROCK_HEIGHT / 2, t.z + t.h / 2);
    this.group.add(rock);
  }

  private addWater(t: TerrainRect): void {
    const shore = new THREE.Mesh(this.own(new THREE.PlaneGeometry(t.w + 0.7, t.h + 0.7).rotateX(-Math.PI / 2)), this.shoreMaterial);
    shore.position.set(t.x + t.w / 2, 0.012, t.z + t.h / 2);
    const water = new THREE.Mesh(this.own(texPlane(t.w, t.h, 0.25).rotateX(-Math.PI / 2)), this.waterMaterial);
    water.position.set(t.x + t.w / 2, 0.05, t.z + t.h / 2);
    water.renderOrder = 2;
    this.group.add(shore, water);
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

  /** Corriente suave del agua; con tiempo congelado la superficie se detiene. */
  update(animTime: number): void {
    if (!this.animateWater) return;
    this.waterMap.offset.set(animTime * 0.012, animTime * 0.006);
  }

  dispose(): void {
    this.clear();
  }
}
