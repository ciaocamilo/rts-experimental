import * as THREE from "three";
import type { AssetLibrary } from "./assets";
import { mergeParts, type Part } from "./merge";
import { type Materials, OWNER_COLORS, rhombusMarkGeometry, ringMarkGeometry, VISUAL } from "./models";
import {
  cannonBarrelParts,
  cannonCarriageParts,
  cannonWheelParts,
  FORE_Z,
  HIND_Z,
  horseBodyParts,
  horseLowerParts,
  horseNeckParts,
  horseTailParts,
  horseUpperParts,
  LEG_X,
  NECK_PIVOT,
  SADDLE_Y,
  SADDLE_Z,
  TAIL_PIVOT,
} from "./mounts";
import { CANNON, CREW, HORSE, type CannonPose, type CrewPose, type HorsePose, type Pose, type Role } from "./pose";

/** Articulaciones del caballo: patas en orden delantera izq., delantera der., trasera izq., trasera der. */
export interface HorseRig {
  /** Gira sobre la cadera trasera: el caballo se encabrita sin despegar las patas traseras. */
  pitch: THREE.Group;
  neck: THREE.Group;
  tail: THREE.Group;
  chest: THREE.Object3D;
  upper: [THREE.Group, THREE.Group, THREE.Group, THREE.Group];
  lower: [THREE.Group, THREE.Group, THREE.Group, THREE.Group];
  jointed: boolean;
}

export interface CrewRig {
  root: THREE.Group;
  torso: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  /** Mecha en la mano derecha; gira respecto al brazo. */
  staff: THREE.Group;
  /** Ascua de la mecha. */
  ember: THREE.Mesh;
}

export interface CannonRig {
  barrel: THREE.Group;
  gun: THREE.Group;
  wheelL: THREE.Group;
  wheelR: THREE.Group;
  crew: CrewRig;
}

/** Apertura lateral de las piernas del jinete (radianes). */
const RIDER_SPLAY = 0.55;

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
  horse: HorseRig | null;
  cannon: CannonRig | null;
  /** Capa y estandarte del comandante: nodo que la vista mece según la marcha. */
  cape: THREE.Group | null;
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
  private readonly mountProxy: THREE.BufferGeometry;
  private readonly cannonProxy: THREE.BufferGeometry;
  private readonly emberGeometry: THREE.BufferGeometry;
  private readonly emberMaterial: THREE.MeshBasicMaterial;
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
    this.mountProxy = assets.track(new THREE.CylinderGeometry(0.55, 0.55, 1.6, 8).translate(0, 0.8, 0));
    this.cannonProxy = assets.track(new THREE.CylinderGeometry(0.85, 0.85, 1.2, 8).translate(0, 0.6, -0.55));
    this.emberGeometry = assets.track(new THREE.SphereGeometry(0.04, 6, 5));
    this.emberMaterial = assets.basic({ color: 0xff8a2a });
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
      if (role === "knight") {
        parts.push({ geometry: new THREE.ConeGeometry(0.04, 0.2, 6), position: [0, 0.66, -0.03], rotation: [-0.5, 0, 0], color: team });
      }
      if (role === "commander") parts.push(...this.commanderTorsoParts(team));
    }
    return parts;
  }

  /** Atuendo de gala del comandante: penacho alto, coraza con ribetes dorados, hombreras y gola. */
  private commanderTorsoParts(team: number): Part[] {
    const gold = 0xd4af37;
    const white = 0xf3efe2;
    return [
      { geometry: new THREE.CylinderGeometry(0.02, 0.026, 0.1, 6), position: [0, 0.6, 0], color: gold },
      { geometry: new THREE.ConeGeometry(0.05, 0.34, 6), position: [0, 0.82, -0.04], rotation: [-0.35, 0, 0], color: team },
      { geometry: new THREE.ConeGeometry(0.04, 0.3, 6), position: [0.05, 0.8, -0.06], rotation: [-0.5, 0, -0.3], color: white },
      { geometry: new THREE.ConeGeometry(0.04, 0.3, 6), position: [-0.05, 0.8, -0.06], rotation: [-0.5, 0, 0.3], color: white },
      { geometry: new THREE.TorusGeometry(0.118, 0.012, 5, 14).rotateX(Math.PI / 2), position: [0, 0.49, 0], color: gold },
      { geometry: new THREE.TorusGeometry(0.15, 0.014, 5, 16).scale(1.15, 1, 1).rotateX(Math.PI / 2), position: [0, 0.34, 0], color: gold },
      { geometry: new THREE.TorusGeometry(0.15, 0.014, 5, 16).scale(1.15, 1, 1).rotateX(Math.PI / 2), position: [0, 0.18, 0], color: gold },
      { geometry: new THREE.BoxGeometry(0.03, 0.2, 0.012), position: [0, 0.27, 0.16], color: gold },
      { geometry: new THREE.SphereGeometry(0.095, 8, 6), position: [0.21, 0.37, 0], color: gold },
      { geometry: new THREE.SphereGeometry(0.095, 8, 6), position: [-0.21, 0.37, 0], color: gold },
      { geometry: new THREE.CylinderGeometry(0.02, 0.02, 0.02, 6).rotateX(Math.PI / 2), position: [0.0, 0.3, 0.185], color: white },
    ];
  }

  /** Capa larga y estandarte del bando; cuelgan de un nodo propio que la vista mece con la marcha. */
  private commanderCapeParts(team: number): Part[] {
    const m = this.mat;
    return [
      { geometry: new THREE.BoxGeometry(0.38, 0.62, 0.025).translate(0, -0.31, 0), position: [0, 0, 0], color: team },
      { geometry: new THREE.BoxGeometry(0.4, 0.04, 0.03), position: [0, -0.6, 0], color: 0xd4af37 },
      { geometry: new THREE.CylinderGeometry(0.012, 0.012, 0.95, 5), position: [0.12, 0.25, -0.04], color: m.leather.color.getHex() },
      { geometry: new THREE.BoxGeometry(0.26, 0.2, 0.012), position: [0.25, 0.56, -0.04], color: team },
      { geometry: new THREE.BoxGeometry(0.26, 0.025, 0.014), position: [0.25, 0.67, -0.04], color: 0xd4af37 },
      { geometry: new THREE.ConeGeometry(0.025, 0.06, 5), position: [0.12, 0.75, -0.04], color: 0xd4af37 },
    ];
  }

  /** Gualdrapa del caballo del comandante: manta del bando con ribete dorado y testera. */
  private caparisonParts(team: number): Part[] {
    const gold = 0xd4af37;
    return [
      { geometry: new THREE.BoxGeometry(0.03, 0.36, 0.56), position: [0.215, 0.6, SADDLE_Z], color: team },
      { geometry: new THREE.BoxGeometry(0.03, 0.36, 0.56), position: [-0.215, 0.6, SADDLE_Z], color: team },
      { geometry: new THREE.BoxGeometry(0.034, 0.03, 0.58), position: [0.215, 0.42, SADDLE_Z], color: gold },
      { geometry: new THREE.BoxGeometry(0.034, 0.03, 0.58), position: [-0.215, 0.42, SADDLE_Z], color: gold },
      { geometry: new THREE.BoxGeometry(0.36, 0.22, 0.03), position: [0, 0.85, 0.42], color: gold },
    ];
  }

  /** Artillero: jubón del bando, gorra negra, cinto con cuerno de pólvora y delantal de cuero. */
  private gunnerTorsoParts(owner: 0 | 1): Part[] {
    const m = this.mat;
    const team = m.team[owner].color.getHex();
    const leather = m.leather.color.getHex();
    return [
      { geometry: new THREE.CapsuleGeometry(0.1, 0.18, 4, 10).scale(1.5, 1, 0.95), position: [0, 0.19, 0], color: team },
      { geometry: new THREE.CylinderGeometry(0.11, 0.11, 0.05, 12).scale(1.5, 1, 1), position: [0, 0.05, 0], color: leather },
      { geometry: new THREE.BoxGeometry(0.2, 0.26, 0.03), position: [0, 0.14, 0.14], color: leather },
      { geometry: new THREE.CylinderGeometry(0.03, 0.045, 0.14, 6), position: [0.17, 0.06, 0.02], rotation: [0, 0, -0.6], color: m.straw.color.getHex() },
      { geometry: new THREE.SphereGeometry(0.1, 10, 8), position: [0, 0.47, 0], color: m.skin.color.getHex() },
      { geometry: new THREE.SphereGeometry(0.114, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), position: [0, 0.495, -0.005], color: 0x2b2623 },
      { geometry: new THREE.CylinderGeometry(0.15, 0.15, 0.018, 12), position: [0, 0.505, 0], color: 0x2b2623 },
    ];
  }

  /** Mecha de cañón: vara de madera con el extremo de cuerda incandescente (el ascua es una malla aparte). */
  private staffParts(): Part[] {
    const m = this.mat;
    return [{ geometry: new THREE.CylinderGeometry(0.014, 0.014, 0.82, 5), position: [0, 0.25, 0], color: m.leather.color.getHex() }];
  }

  private armParts(role: Role, owner: 0 | 1, side: "L" | "R"): Part[] {
    const m = this.mat;
    const parts: Part[] = [
      { geometry: new THREE.CapsuleGeometry(0.04, 0.22, 3, 8), position: [0, -0.15, 0], color: m.team[owner].color.getHex() },
      { geometry: new THREE.SphereGeometry(0.045, 8, 6), position: [0, -0.32, 0], color: m.skin.color.getHex() },
    ];
    const armed = role === "soldier" || role === "knight" || role === "commander";
    if (armed && side === "R") {
      parts.push({ geometry: new THREE.BoxGeometry(0.035, 0.42, 0.012), position: [0, -0.55, 0], color: m.steel.color.getHex() });
      parts.push({ geometry: new THREE.CylinderGeometry(0.015, 0.015, 0.12, 6).rotateZ(Math.PI / 2), position: [0, -0.34, 0], color: m.leather.color.getHex() });
    }
    if (armed && side === "L") {
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

  /** Construye un humano articulado por rol (aldeano, arquero, soldado o caballero); `female` solo aplica al aldeano. */
  create(role: Role, owner: 0 | 1, withShadow: boolean, female = false): UnitRig {
    female = female && role === "villager";
    const m = this.mat;
    const root = new THREE.Group();
    const facing = new THREE.Group();
    const bob = new THREE.Group();
    root.add(facing);
    facing.add(bob);
    if (role === "cannon") return this.createCannon(owner, withShadow, root, facing, bob);

    let seat: THREE.Object3D = bob;
    let horse: HorseRig | null = null;
    const mountedRole = role === "knight" || role === "commander";
    if (mountedRole) {
      const mounted = this.createHorse(owner, bob, role === "commander");
      horse = mounted.rig;
      seat = mounted.rider;
    }

    const legGeo = this.geometry("leg", () => this.legParts());
    const legL = new THREE.Group();
    const legR = new THREE.Group();
    legL.position.set(0.085, 0.42, 0);
    legR.position.set(-0.085, 0.42, 0);
    for (const leg of [legL, legR]) {
      this.mesh(legGeo, leg);
      seat.add(leg);
    }

    const torso = new THREE.Group();
    torso.position.set(0, 0.42, 0);
    seat.add(torso);
    this.mesh(this.geometry(`torso:${role}:${owner}${female ? ":f" : ""}`, () => this.torsoParts(role, owner, female)), torso);

    const armL = new THREE.Group();
    const armR = new THREE.Group();
    armL.position.set(0.2, 0.34, 0);
    armR.position.set(-0.2, 0.34, 0);
    this.mesh(this.geometry(`arm:${role}:${owner}:L`, () => this.armParts(role, owner, "L")), armL);
    this.mesh(this.geometry(`arm:${role}:${owner}:R`, () => this.armParts(role, owner, "R")), armR);
    torso.add(armL, armR);

    let cape: THREE.Group | null = null;
    if (role === "commander") {
      cape = new THREE.Group();
      cape.position.set(0, 0.4, -0.12);
      this.mesh(this.geometry(`cape:${owner}`, () => this.commanderCapeParts(this.mat.team[owner].color.getHex())), cape);
      torso.add(cape);
    }

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
    let proxyGeometry = this.proxyGeometry;
    if (mountedRole) {
      mark.position.z = -0.8;
      mark.scale.setScalar(role === "commander" ? 1.9 : 1.6);
      shadow?.scale.set(1.5, 1, 2.3);
      proxyGeometry = this.mountProxy;
    }
    const proxy = this.mesh(proxyGeometry, root, this.proxyMaterial);

    return { root, facing, bob, torso, legL, legR, armL, armR, bundleWood, bundleFood, bundleStone, tools: { axe, hammer }, nocked, shadow, mark, proxy, role, horse, cannon: null, cape };
  }

  /** Caballo articulado con su jinete: devuelve el grupo del asiento donde se monta el esqueleto humano. */
  private createHorse(owner: 0 | 1, bob: THREE.Group, commander = false): { rig: HorseRig; rider: THREE.Group } {
    const high = this.assets.quality === "high";
    const team = this.mat.team[owner].color.getHex();
    const pitch = new THREE.Group();
    pitch.position.set(0, HORSE.hip, HIND_Z);
    // El caballo del comandante es mayor (≈ 1,15 ×).
    if (commander) pitch.scale.setScalar(1.15);
    const inner = new THREE.Group();
    inner.position.set(0, -HORSE.hip, -HIND_Z);
    pitch.add(inner);
    bob.add(pitch);

    const chest = this.mesh(
      this.geometry(commander ? `horse:body:commander:${owner}` : `horse:body:${owner}`, () => [...horseBodyParts({ team }), ...(commander ? this.caparisonParts(team) : [])]),
      inner,
    );
    const neck = new THREE.Group();
    neck.position.set(...NECK_PIVOT);
    this.mesh(this.geometry("horse:neck", () => horseNeckParts()), neck);
    const tail = new THREE.Group();
    tail.position.set(...TAIL_PIVOT);
    this.mesh(this.geometry("horse:tail", () => horseTailParts()), tail);
    inner.add(neck, tail);

    const upper: THREE.Group[] = [];
    const lower: THREE.Group[] = [];
    for (let i = 0; i < 4; i++) {
      const hind = i >= 2;
      const leg = new THREE.Group();
      leg.position.set(i % 2 === 0 ? LEG_X : -LEG_X, HORSE.hip, hind ? HIND_Z : FORE_Z);
      this.mesh(this.geometry(`horse:upper:${hind ? "h" : "f"}:${high ? "j" : "r"}`, () => horseUpperParts(hind, high)), leg);
      const knee = new THREE.Group();
      knee.position.y = -HORSE.upper;
      if (high) this.mesh(this.geometry("horse:lower", () => horseLowerParts()), knee);
      leg.add(knee);
      inner.add(leg);
      upper.push(leg);
      lower.push(knee);
    }

    const rider = new THREE.Group();
    rider.position.set(0, SADDLE_Y - 0.42, SADDLE_Z);
    inner.add(rider);
    const rig: HorseRig = {
      pitch,
      neck,
      tail,
      chest,
      upper: upper as HorseRig["upper"],
      lower: lower as HorseRig["lower"],
      jointed: high,
    };
    return { rig, rider };
  }

  /** Cañón de bronce sobre cureña con dos ruedas de radios; el tubo gira sobre los muñones y retrocede al disparar. */
  private createCannon(owner: 0 | 1, withShadow: boolean, root: THREE.Group, facing: THREE.Group, bob: THREE.Group): UnitRig {
    const m = this.mat;
    const team = m.team[owner].color.getHex();
    this.mesh(this.geometry(`cannon:carriage:${owner}`, () => cannonCarriageParts({ team })), bob);
    const barrel = new THREE.Group();
    barrel.position.set(0, CANNON.pivotY, CANNON.pivotZ);
    barrel.rotation.x = -CANNON.elevation;
    const gun = new THREE.Group();
    barrel.add(gun);
    this.mesh(this.geometry("cannon:barrel", () => cannonBarrelParts()), gun);
    bob.add(barrel);
    const wheelGeometry = this.geometry("cannon:wheel", () => cannonWheelParts());
    const wheelL = new THREE.Group();
    const wheelR = new THREE.Group();
    wheelL.position.set(0.38, CANNON.wheelRadius, 0);
    wheelR.position.set(-0.38, CANNON.wheelRadius, 0);
    for (const wheel of [wheelL, wheelR]) {
      this.mesh(wheelGeometry, wheel);
      bob.add(wheel);
    }

    const crew = this.createCrew(owner, facing);

    const silhouette = this.occluded[owner];
    bob.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material === this.material) object.material = [this.material, silhouette];
    });
    crew.root.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material === this.material) object.material = [this.material, silhouette];
    });

    const mark = this.mesh(this.markGeometry[owner], facing, m.mark[owner]);
    mark.position.set(0, 0.03, -1.95);
    mark.scale.setScalar(1.5);
    let shadow: THREE.Object3D | null = null;
    if (withShadow) {
      shadow = this.mesh(this.shadowGeometry, root, m.shadow);
      shadow.position.set(0, 0.015, 0);
      shadow.scale.set(1.9, 1, 4.2);
    }
    const proxy = this.mesh(this.cannonProxy, root, this.proxyMaterial);
    // Los miembros no se usan en el cañón; existen para que el resto del código trate todos los roles igual.
    const none = (): THREE.Group => new THREE.Group();
    return {
      root,
      facing,
      bob,
      torso: none(),
      legL: none(),
      legR: none(),
      armL: none(),
      armR: none(),
      bundleWood: none(),
      bundleFood: none(),
      bundleStone: none(),
      tools: { axe: null, hammer: null },
      nocked: null,
      shadow,
      mark,
      proxy,
      role: "cannon",
      horse: null,
      cannon: { barrel, gun, wheelL, wheelR, crew },
      cape: null,
    };
  }

  /** Artillero articulado (piernas, torso, brazos y mecha) que acompaña al cañón; cuelga de `facing`, no de la cureña. */
  private createCrew(owner: 0 | 1, parent: THREE.Group): CrewRig {
    const root = new THREE.Group();
    root.position.set(0, 0, CREW.rearZ);
    parent.add(root);
    const legGeo = this.geometry("leg", () => this.legParts());
    const legL = new THREE.Group();
    const legR = new THREE.Group();
    legL.position.set(0.085, 0.42, 0);
    legR.position.set(-0.085, 0.42, 0);
    for (const leg of [legL, legR]) {
      this.mesh(legGeo, leg);
      root.add(leg);
    }
    const torso = new THREE.Group();
    torso.position.set(0, 0.42, 0);
    root.add(torso);
    this.mesh(this.geometry(`torso:gunner:${owner}`, () => this.gunnerTorsoParts(owner)), torso);
    const armL = new THREE.Group();
    const armR = new THREE.Group();
    armL.position.set(0.2, 0.34, 0);
    armR.position.set(-0.2, 0.34, 0);
    this.mesh(this.geometry(`arm:villager:${owner}:L`, () => this.armParts("villager", owner, "L")), armL);
    this.mesh(this.geometry(`arm:villager:${owner}:R`, () => this.armParts("villager", owner, "R")), armR);
    torso.add(armL, armR);
    const staff = new THREE.Group();
    staff.position.set(0, -0.32, 0);
    armR.add(staff);
    this.mesh(this.geometry("cannon:staff", () => this.staffParts()), staff);
    const ember = this.mesh(this.emberGeometry, staff, this.emberMaterial);
    ember.position.y = 0.68;
    return { root, torso, legL, legR, armL, armR, staff, ember };
  }
}

/** Fija el rumbo de la unidad: gira el cuerpo y la sombra alargada de las monturas y el cañón. */
export function setYaw(rig: UnitRig, yaw: number): void {
  rig.facing.rotation.y = yaw;
  if (rig.shadow) rig.shadow.rotation.y = yaw;
}

/** Mueve el caballo con la pose de zancada (patas, cuello, cola, cabeceo y respiración). */
export function applyHorse(rig: UnitRig, pose: HorsePose): void {
  const horse = rig.horse;
  if (!horse) return;
  horse.pitch.rotation.x = pose.pitch;
  horse.pitch.position.y = HORSE.hip + pose.bob;
  horse.neck.rotation.x = pose.neck;
  horse.tail.rotation.set(pose.tail, 0, pose.tailSway);
  horse.chest.scale.y = pose.chest;
  for (let i = 0; i < 4; i++) {
    const leg = pose.legs[i]!;
    // Las patas traseras compensan el cabeceo para seguir apoyadas cuando el caballo se encabrita.
    horse.upper[i]!.rotation.x = leg.upper - (i >= 2 ? pose.pitch : 0);
    if (horse.jointed) horse.lower[i]!.rotation.x = leg.lower;
  }
}

/** Mueve el cañón: giro de ruedas, retroceso del tubo y respingo de la cureña. */
export function applyCannon(rig: UnitRig, pose: CannonPose): void {
  const cannon = rig.cannon;
  if (!cannon) return;
  cannon.wheelL.rotation.x = pose.wheelSpin;
  cannon.wheelR.rotation.x = pose.wheelSpin;
  cannon.gun.position.z = -pose.recoil;
  cannon.barrel.rotation.x = -(CANNON.elevation + pose.pitchKick);
  rig.bob.position.y = pose.hop + pose.bounce;
  rig.bob.position.z = -pose.slide;
}

/** Mueve al artillero con su pose: puesto, giro, extremidades y brillo de la mecha. */
export function applyCrew(rig: UnitRig, pose: CrewPose): void {
  const crew = rig.cannon?.crew;
  if (!crew) return;
  crew.root.position.set(pose.x, pose.bob, pose.z);
  crew.root.rotation.y = pose.yaw;
  crew.legL.rotation.x = pose.legL;
  crew.legR.rotation.x = pose.legR;
  crew.armL.rotation.set(pose.armLx, 0, pose.armLz);
  crew.armR.rotation.set(pose.armRx, 0, pose.armRz);
  crew.torso.rotation.x = pose.torsoPitch;
  crew.staff.rotation.x = pose.staff;
  crew.ember.scale.setScalar(pose.ember);
}

/** Cuerpo caído: relaja el esqueleto y lo tumba hacia atrás sobre el suelo. `fall` va de 0 (de pie) a 1 (tendido). */
export function applyDeath(rig: UnitRig, pose: Pose, fall: number): void {
  applyPose(rig, pose);
  if (rig.horse) {
    // El caballo cae de costado con su jinete y las patas se encogen.
    rig.bob.rotation.set(0, 0, (Math.PI / 2) * fall);
    rig.bob.position.set(0.43 * fall, 0.19 * fall, 0);
    for (let i = 0; i < 4; i++) {
      rig.horse.upper[i]!.rotation.x = (i % 2 === 0 ? -0.5 : 0.4) * fall;
      rig.horse.lower[i]!.rotation.x = 0.8 * fall;
    }
    rig.horse.neck.rotation.x = 0.3 * fall;
    rig.horse.pitch.rotation.x = 0;
    rig.horse.pitch.position.y = HORSE.hip;
  } else if (rig.cannon) {
    // La cureña se hunde de lado, el tubo cae y una rueda sale rodando.
    rig.bob.rotation.set(0, 0, 0.32 * fall);
    rig.bob.position.set(0, -0.06 * fall, 0);
    rig.cannon.barrel.rotation.x = -CANNON.elevation + 0.45 * fall;
    rig.cannon.gun.position.z = 0;
    rig.cannon.wheelL.position.x = 0.38 + 0.45 * fall;
    rig.cannon.wheelL.rotation.z = 0.5 * fall;
    // El artillero cae de espaldas junto a la pieza.
    const crew = rig.cannon.crew;
    crew.root.rotation.set(-(Math.PI / 2) * fall, crew.root.rotation.y, 0);
    crew.root.position.y = 0.11 * fall;
    crew.ember.visible = false;
  } else {
    rig.bob.rotation.x = -(Math.PI / 2) * fall;
    rig.bob.position.y = 0.11 * fall;
  }
  rig.mark.visible = false;
  rig.bundleWood.visible = false;
  rig.bundleFood.visible = false;
  rig.bundleStone.visible = false;
  if (rig.tools.axe) rig.tools.axe.visible = false;
  if (rig.tools.hammer) rig.tools.hammer.visible = false;
}

/** Aplica una pose calculada por `computePose` al esqueleto. */
export function applyPose(rig: UnitRig, pose: Pose): void {
  const splay = rig.horse ? RIDER_SPLAY : 0;
  rig.legL.rotation.set(pose.legL, 0, splay);
  rig.legR.rotation.set(pose.legR, 0, -splay);
  rig.armL.rotation.set(pose.armLx, 0, pose.armLz);
  rig.armR.rotation.set(pose.armRx, 0, pose.armRz);
  rig.torso.rotation.x = pose.torsoPitch;
  rig.bob.position.y = pose.bob;
  if (rig.nocked) rig.nocked.visible = pose.bowDraw > 0.15;
}
