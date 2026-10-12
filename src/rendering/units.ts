import * as THREE from "three";
import type { AssetLibrary } from "./assets";
import { mergeParts, type Part } from "./merge";
import { type Materials, OWNER_COLORS, rhombusMarkGeometry, ringMarkGeometry, VISUAL } from "./models";
import type { Pose, Role } from "./pose";

export interface UnitRig {
  root: THREE.Group;
  facing: THREE.Group;
  bob: THREE.Group;
  torso: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  bundleWood: THREE.Object3D;
  bundleFood: THREE.Object3D;
  bundleStone: THREE.Object3D;
  tools: { axe: THREE.Object3D | null; hammer: THREE.Object3D | null };
  nocked: THREE.Object3D | null;
  shadow: THREE.Object3D | null;
  mark: THREE.Object3D;
  proxy: THREE.Mesh;
  role: Role;
}

/**
 * Fábrica de personajes. Cada rol y bando funde sus piezas en geometrías con color de vértice, que se
 * comparten entre todas las unidades: crear una unidad no asigna geometría ni material nuevos.
 */
export class UnitFactory {
  private readonly cache = new Map<string, THREE.BufferGeometry>();
  private readonly material: THREE.MeshLambertMaterial;
  private readonly proxyMaterial: THREE.MeshBasicMaterial;
  private readonly markGeometry: readonly [THREE.BufferGeometry, THREE.BufferGeometry];
  private readonly shadowGeometry: THREE.BufferGeometry;
  private readonly proxyGeometry: THREE.BufferGeometry;
  /**
   * Segunda pasada de cada cuerpo: solo se dibuja donde la unidad queda detrás de un edificio (profundidad mayor y
   * plantilla marcada por los edificios), con el color del bando. Nunca por detrás de árboles ni de otras unidades.
   */
  private readonly occluded: readonly [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial];

  constructor(
    private readonly assets: AssetLibrary,
    private readonly mat: Materials,
  ) {
    this.material = assets.lambert({ vertexColors: true });
    const silhouette = (owner: 0 | 1): THREE.MeshBasicMaterial =>
      assets.basic({
        color: new THREE.Color(OWNER_COLORS[owner]).lerp(new THREE.Color(0xffffff), 0.25),
        transparent: true,
        opacity: 0.7,
        depthFunc: THREE.GreaterDepth,
        depthWrite: false,
        stencilWrite: true,
        stencilFunc: THREE.EqualStencilFunc,
        stencilRef: 1,
        stencilFail: THREE.KeepStencilOp,
        stencilZFail: THREE.KeepStencilOp,
        stencilZPass: THREE.KeepStencilOp,
      });
    this.occluded = [silhouette(0), silhouette(1)];
    this.proxyMaterial = assets.basic({ visible: false });
    this.markGeometry = [assets.track(ringMarkGeometry(0.2)), assets.track(rhombusMarkGeometry(0.212))];
    this.shadowGeometry = assets.track(new THREE.CircleGeometry(0.34, 12).rotateX(-Math.PI / 2));
    this.proxyGeometry = assets.track(new THREE.CylinderGeometry(0.4, 0.4, VISUAL.unitHeight, 8).translate(0, VISUAL.unitHeight / 2, 0));
  }

  private geometry(key: string, parts: () => Part[]): THREE.BufferGeometry {
    let g = this.cache.get(key);
    if (!g) {
      const list = parts();
      g = this.assets.track(mergeParts(list));
      const count = g.getAttribute("position").count;
      g.addGroup(0, count, 0);
      g.addGroup(0, count, 1);
      list.forEach((p) => p.geometry.dispose());
      this.cache.set(key, g);
    }
    return g;
  }

  private mesh(geometry: THREE.BufferGeometry, parent: THREE.Object3D, material: THREE.Material = this.material): THREE.Mesh {
    const m = new THREE.Mesh(geometry, material);
    parent.add(m);
    return m;
  }

  /** Piezas de un miembro: la geometría primitiva es temporal; solo la geometría fundida se conserva. */
  private legParts(): Part[] {
    const m = this.mat;
    return [
      { geometry: new THREE.CapsuleGeometry(0.058, 0.244, 3, 8), position: [0, -0.19, 0], color: m.trousers.color.getHex() },
      { geometry: new THREE.SphereGeometry(0.065, 8, 6).scale(1, 0.65, 1.5), position: [0, -0.385, 0.035], color: m.leather.color.getHex() },
    ];
  }

  /** Aldeana: corpiño del bando, falda larga de lana, delantal de lino, toca blanca y trenza. */
  private dressParts(team: number): Part[] {
    const m = this.mat;
    return [
      { geometry: new THREE.CapsuleGeometry(0.095, 0.17, 4, 10).scale(1.3, 1, 0.9), position: [0, 0.2, 0], color: team },
      { geometry: new THREE.CylinderGeometry(0.11, 0.11, 0.035, 12).scale(1.25, 1, 0.95), position: [0, 0.075, 0], color: m.leather.color.getHex() },
      { geometry: new THREE.CylinderGeometry(0.125, 0.235, 0.4, 14), position: [0, -0.13, 0], color: m.trousers.color.getHex() },
      { geometry: new THREE.BoxGeometry(0.2, 0.3, 0.02).rotateX(0.12), position: [0, -0.1, 0.17], color: m.sack.color.getHex() },
      { geometry: new THREE.SphereGeometry(0.1, 10, 8), position: [0, 0.47, 0], color: m.skin.color.getHex() },
      { geometry: new THREE.SphereGeometry(0.112, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), position: [0, 0.49, -0.012], color: m.feather.color.getHex() },
      { geometry: new THREE.SphereGeometry(0.05, 8, 6), position: [0, 0.45, -0.1], color: m.feather.color.getHex() },
      { geometry: new THREE.CapsuleGeometry(0.03, 0.13, 3, 6), position: [0, 0.33, -0.115], color: m.leather.color.getHex() },
    ];
  }

  private torsoParts(role: Role, owner: 0 | 1, female: boolean): Part[] {
    const m = this.mat;
    const team = m.team[owner].color.getHex();
    if (female) return this.dressParts(team);
    const parts: Part[] = [
      { geometry: new THREE.CapsuleGeometry(0.1, 0.18, 4, 10).scale(1.5, 1, 0.95), position: [0, 0.19, 0], color: team },
      { geometry: new THREE.CylinderGeometry(0.11, 0.11, 0.05, 12).scale(1.5, 1, 1), position: [0, 0.05, 0], color: m.leather.color.getHex() },
      { geometry: new THREE.SphereGeometry(0.1, 10, 8), position: [0, 0.47, 0], color: m.skin.color.getHex() },
    ];
    if (role === "villager") {
      parts.push({ geometry: new THREE.CylinderGeometry(0.19, 0.19, 0.02, 16), position: [0, 0.54, 0], color: m.straw.color.getHex() });
      parts.push({ geometry: new THREE.ConeGeometry(0.1, 0.1, 12), position: [0, 0.6, 0], color: m.straw.color.getHex() });
    } else if (role === "archer") {
      parts.push({ geometry: new THREE.SphereGeometry(0.115, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), position: [0, 0.49, -0.01], color: m.hood.color.getHex() });
      parts.push({ geometry: new THREE.CylinderGeometry(0.05, 0.045, 0.3, 10), position: [0.07, 0.24, -0.15], rotation: [0, 0, -0.25], color: m.leather.color.getHex() });
      parts.push({ geometry: new THREE.CylinderGeometry(0.03, 0.03, 0.1, 8), position: [0.085, 0.42, -0.15], rotation: [0, 0, -0.25], color: m.feather.color.getHex() });
    } else {
      parts.push({ geometry: new THREE.SphereGeometry(0.118, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), position: [0, 0.49, 0], color: m.steel.color.getHex() });
      parts.push({ geometry: new THREE.CylinderGeometry(0.012, 0.012, 0.09, 6), position: [0, 0.46, 0.115], color: m.steel.color.getHex() });
      parts.push({ geometry: new THREE.CapsuleGeometry(0.1, 0.06, 4, 10).scale(1.6, 1, 1.1), position: [0, 0.26, 0], color: m.steel.color.getHex() });
      parts.push({ geometry: new THREE.SphereGeometry(0.075, 8, 6), position: [0.2, 0.36, 0], color: m.steelDark.color.getHex() });
      parts.push({ geometry: new THREE.SphereGeometry(0.075, 8, 6), position: [-0.2, 0.36, 0], color: m.steelDark.color.getHex() });
    }
    return parts;
  }

  private armParts(role: Role, owner: 0 | 1, side: "L" | "R"): Part[] {
    const m = this.mat;
    const parts: Part[] = [
      { geometry: new THREE.CapsuleGeometry(0.04, 0.22, 3, 8), position: [0, -0.15, 0], color: m.team[owner].color.getHex() },
      { geometry: new THREE.SphereGeometry(0.045, 8, 6), position: [0, -0.32, 0], color: m.skin.color.getHex() },
    ];
    if (role === "soldier" && side === "R") {
      parts.push({ geometry: new THREE.BoxGeometry(0.035, 0.42, 0.012), position: [0, -0.55, 0], color: m.steel.color.getHex() });
      parts.push({ geometry: new THREE.CylinderGeometry(0.015, 0.015, 0.12, 6).rotateZ(Math.PI / 2), position: [0, -0.34, 0], color: m.leather.color.getHex() });
    }
    if (role === "soldier" && side === "L") {
      parts.push({ geometry: new THREE.CylinderGeometry(0.17, 0.17, 0.03, 16).rotateZ(Math.PI / 2), position: [0.07, -0.2, 0], color: m.team[owner].color.getHex() });
      parts.push({ geometry: new THREE.SphereGeometry(0.05, 8, 6), position: [0.1, -0.2, 0], color: m.steel.color.getHex() });
    }
    if (role === "archer" && side === "L") {
      // Semicírculo en el plano YZ del brazo, centrado en la mano; la cuerda queda del lado del arquero.
      const r = 0.26;
      parts.push({ geometry: new THREE.TorusGeometry(r, 0.012, 5, 14, Math.PI).rotateY(Math.PI / 2).rotateZ(Math.PI), position: [0, r - 0.32, 0], color: m.leather.color.getHex() });
      parts.push({ geometry: new THREE.CylinderGeometry(0.004, 0.004, r * 2, 3).rotateX(Math.PI / 2), position: [0, r - 0.32, 0], color: m.feather.color.getHex() });
    }
    return parts;
  }

  private toolParts(kind: "axe" | "hammer"): Part[] {
    const m = this.mat;
    if (kind === "axe") {
      return [
        { geometry: new THREE.CylinderGeometry(0.018, 0.018, 0.4, 5), position: [0, -0.5, 0], color: m.leather.color.getHex() },
        { geometry: new THREE.BoxGeometry(0.03, 0.1, 0.14), position: [0, -0.66, 0.05], color: m.steelDark.color.getHex() },
      ];
    }
    return [
      { geometry: new THREE.CylinderGeometry(0.018, 0.018, 0.3, 5), position: [0, -0.46, 0], color: m.leather.color.getHex() },
      { geometry: new THREE.BoxGeometry(0.06, 0.07, 0.14), position: [0, -0.62, 0], color: m.steelDark.color.getHex() },
    ];
  }

  /** Construye un humano articulado por rol (aldeano, arquero o soldado); `female` solo aplica al aldeano. */
  create(role: Role, owner: 0 | 1, withShadow: boolean, female = false): UnitRig {
    female = female && role === "villager";
    const m = this.mat;
    const root = new THREE.Group();
    const facing = new THREE.Group();
    const bob = new THREE.Group();
    root.add(facing);
    facing.add(bob);

    const legGeo = this.geometry("leg", () => this.legParts());
    const legL = new THREE.Group();
    const legR = new THREE.Group();
    legL.position.set(0.085, 0.42, 0);
    legR.position.set(-0.085, 0.42, 0);
    for (const leg of [legL, legR]) {
      this.mesh(legGeo, leg);
      bob.add(leg);
    }

    const torso = new THREE.Group();
    torso.position.set(0, 0.42, 0);
    bob.add(torso);
    this.mesh(this.geometry(`torso:${role}:${owner}${female ? ":f" : ""}`, () => this.torsoParts(role, owner, female)), torso);

    const armL = new THREE.Group();
    const armR = new THREE.Group();
    armL.position.set(0.2, 0.34, 0);
    armR.position.set(-0.2, 0.34, 0);
    this.mesh(this.geometry(`arm:${role}:${owner}:L`, () => this.armParts(role, owner, "L")), armL);
    this.mesh(this.geometry(`arm:${role}:${owner}:R`, () => this.armParts(role, owner, "R")), armR);
    torso.add(armL, armR);

    let axe: THREE.Object3D | null = null;
    let hammer: THREE.Object3D | null = null;
    let nocked: THREE.Object3D | null = null;
    if (role === "villager") {
      axe = this.mesh(this.geometry("tool:axe", () => this.toolParts("axe")), armR);
      hammer = this.mesh(this.geometry("tool:hammer", () => this.toolParts("hammer")), armR);
      axe.visible = false;
      hammer.visible = false;
    } else if (role === "archer") {
      nocked = this.mesh(
        this.geometry("arrow:nocked", () => [
          { geometry: new THREE.CylinderGeometry(0.01, 0.01, 0.4, 4), position: [0, 0.13 - 0.32, 0], color: m.shaft.color.getHex() },
          { geometry: new THREE.ConeGeometry(0.025, 0.06, 4), position: [0, -0.42, 0], rotation: [Math.PI, 0, 0], color: m.steel.color.getHex() },
        ]),
        armL,
      );
      nocked.visible = false;
    }

    const bundleWood = this.mesh(
      this.geometry("bundle:wood", () =>
        ([[0.18, -0.16], [0.26, -0.16], [0.22, -0.2]] as const).map(([y, z]) => ({
          geometry: new THREE.CylinderGeometry(0.04, 0.04, 0.3, 6).rotateZ(Math.PI / 2),
          position: [0, y, z] as const,
          color: m.log.color.getHex(),
        })),
      ),
      torso,
    );
    const bundleFood = this.mesh(
      this.geometry("bundle:food", () => [
        { geometry: new THREE.SphereGeometry(0.11, 7, 5).scale(1, 1.1, 0.9), position: [0, 0.22, -0.18], color: m.sack.color.getHex() },
        { geometry: new THREE.SphereGeometry(0.035, 5, 4), position: [0.03, 0.34, -0.17], color: m.berry.color.getHex() },
      ]),
      torso,
    );
    bundleWood.visible = false;
    bundleFood.visible = false;
    const bundleStone = this.mesh(
      this.geometry("bundle:stone", () => [
        { geometry: new THREE.IcosahedronGeometry(0.09, 0), position: [-0.06, 0.22, -0.18], color: m.steelDark.color.getHex() },
        { geometry: new THREE.IcosahedronGeometry(0.07, 0), position: [0.07, 0.25, -0.17], color: m.steel.color.getHex() },
      ]),
      torso,
    );
    bundleStone.visible = false;

    // Cada cuerpo se dibuja con su pasada de contorno; la silueta solo aparece tras los edificios.
    const silhouette = this.occluded[owner];
    bob.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material === this.material) object.material = [this.material, silhouette];
    });

    const mark = this.mesh(this.markGeometry[owner], facing, m.mark[owner]);
    mark.position.y = 0.03;
    let shadow: THREE.Object3D | null = null;
    if (withShadow) {
      shadow = this.mesh(this.shadowGeometry, root, m.shadow);
      shadow.position.y = 0.015;
    }
    const proxy = this.mesh(this.proxyGeometry, root, this.proxyMaterial);

    return { root, facing, bob, torso, legL, legR, armL, armR, bundleWood, bundleFood, bundleStone, tools: { axe, hammer }, nocked, shadow, mark, proxy, role };
  }
}

/** Cuerpo caído: relaja el esqueleto y lo tumba hacia atrás sobre el suelo. `fall` va de 0 (de pie) a 1 (tendido). */
export function applyDeath(rig: UnitRig, pose: Pose, fall: number): void {
  applyPose(rig, pose);
  rig.bob.rotation.x = -(Math.PI / 2) * fall;
  rig.bob.position.y = 0.11 * fall;
  rig.mark.visible = false;
  rig.bundleWood.visible = false;
  rig.bundleFood.visible = false;
  rig.bundleStone.visible = false;
  if (rig.tools.axe) rig.tools.axe.visible = false;
  if (rig.tools.hammer) rig.tools.hammer.visible = false;
}

/** Aplica una pose calculada por `computePose` al esqueleto. */
export function applyPose(rig: UnitRig, pose: Pose): void {
  rig.legL.rotation.x = pose.legL;
  rig.legR.rotation.x = pose.legR;
  rig.armL.rotation.set(pose.armLx, 0, pose.armLz);
  rig.armR.rotation.set(pose.armRx, 0, pose.armRz);
  rig.torso.rotation.x = pose.torsoPitch;
  rig.bob.position.y = pose.bob;
  if (rig.nocked) rig.nocked.visible = pose.bowDraw > 0.15;
}
