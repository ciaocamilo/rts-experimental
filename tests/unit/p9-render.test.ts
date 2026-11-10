import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { AirborneTracker, LAUNCH_RADIUS, MAX_AIRBORNE, launchOffset, launchProfile } from "../../src/rendering/airborne";
import type { AssetLibrary } from "../../src/rendering/assets";
import { arcHeight, ballisticPoint } from "../../src/rendering/blast";
import { Materials } from "../../src/rendering/models";
import { STABLE_COATS, stableHorseGeometry } from "../../src/rendering/mounts";
import { CHIMNEY_TOP } from "../../src/rendering/buildings";
import { CHIMNEY_PARTICLES, ChimneyFactory, updateChimney } from "../../src/rendering/chimney";
import { CANNON, CREW, HORSE, cannonPose, crewPose, gallopPose, hoofHeight } from "../../src/rendering/pose";
import { UnitFactory } from "../../src/rendering/units";

describe("P9 galope del caballo", () => {
  it("las pezuñas nunca se hunden en el suelo y se despegan al galopar", () => {
    let lowest = Infinity;
    let highest = -Infinity;
    for (let i = 0; i < 200; i++) {
      const p = gallopPose(i / 200, 1);
      expect(p.bob).toBeGreaterThanOrEqual(0);
      for (const leg of p.legs) {
        const h = hoofHeight(leg, p.bob);
        lowest = Math.min(lowest, h);
        highest = Math.max(highest, h);
      }
    }
    expect(lowest).toBeGreaterThanOrEqual(-0.06);
    expect(highest).toBeGreaterThan(0.15);
  });

  it("el galope es periódico y continuo", () => {
    const a = gallopPose(0.3, 1);
    const b = gallopPose(1.3, 1);
    expect(b.legs[0].upper).toBeCloseTo(a.legs[0].upper, 9);
    expect(b.pitch).toBeCloseTo(a.pitch, 9);
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      const p = gallopPose(i / 400, 1);
      const q = gallopPose((i + 1) / 400, 1);
      for (let l = 0; l < 4; l++) worst = Math.max(worst, Math.abs(q.legs[l]!.upper - p.legs[l]!.upper));
    }
    expect(worst).toBeLessThan(0.1);
  });

  it("al reposo las patas se acercan a la vertical y el galope es determinista", () => {
    const rest = gallopPose(0.4, 0);
    expect(Math.abs(rest.legs[0].upper)).toBeLessThan(0.05);
    expect(gallopPose(0.37, 0.8, { t: 2, seed: 5 })).toEqual(gallopPose(0.37, 0.8, { t: 2, seed: 5 }));
    expect(HORSE.hip).toBeGreaterThan(HORSE.upper);
  });
});

describe("P9 pose del cañón", () => {
  it("las ruedas giran en proporción al recorrido", () => {
    expect(cannonPose({ rolled: 0, sinceShot: null }).wheelSpin).toBe(0);
    const one = cannonPose({ rolled: 1, sinceShot: null }).wheelSpin;
    expect(one).toBeCloseTo(1 / CANNON.wheelRadius, 9);
    expect(cannonPose({ rolled: 2, sinceShot: null }).wheelSpin).toBeCloseTo(2 * one, 9);
  });

  it("el retroceso sube al disparar y vuelve a cero", () => {
    expect(cannonPose({ rolled: 0, sinceShot: null }).recoil).toBe(0);
    const peak = cannonPose({ rolled: 0, sinceShot: 0.06 }).recoil;
    expect(peak).toBeCloseTo(CANNON.recoil, 9);
    expect(cannonPose({ rolled: 0, sinceShot: 0.2 }).recoil).toBeLessThan(peak);
    const after = cannonPose({ rolled: 0, sinceShot: CANNON.recoilSeconds + 0.5 });
    expect(after.recoil).toBe(0);
    expect(after.hop).toBe(0);
    expect(after.slide).toBe(0);
  });
});

describe("P9 trayectoria de la bala", () => {
  it("la altura del arco crece con la distancia y está acotada", () => {
    expect(arcHeight(0)).toBeCloseTo(0.6, 9);
    expect(arcHeight(100)).toBeCloseTo(2.4, 9);
    expect(arcHeight(5)).toBeGreaterThan(arcHeight(2));
  });

  it("es parabólica: sale de la boca, alcanza el vértice a mitad y cae al suelo", () => {
    const from = { x: 0, z: 0 };
    const to = { x: 4, z: 3 };
    const start = ballisticPoint(from, to, 0.9, 1.5, 0);
    const mid = ballisticPoint(from, to, 0.9, 1.5, 0.5);
    const end = ballisticPoint(from, to, 0.9, 1.5, 1);
    expect(start).toMatchObject({ x: 0, y: 0.9, z: 0 });
    expect(end).toMatchObject({ x: 4, y: 0, z: 3 });
    expect(mid.y).toBeCloseTo(0.45 + 1.5, 9);
    expect(mid.x).toBeCloseTo(2, 9);
    let prev = -Infinity;
    let rising = true;
    for (let i = 0; i <= 20; i++) {
      const y = ballisticPoint(from, to, 0.9, 1.5, i / 20).y;
      if (rising && y < prev) rising = false;
      if (!rising) expect(y).toBeLessThanOrEqual(prev + 1e-9);
      prev = y;
    }
    expect(rising).toBe(false);
  });
});

describe("P9 unidades por los aires", () => {
  it("solo se lanza lo que está dentro del radio", () => {
    expect(launchProfile(LAUNCH_RADIUS + 0.01, 1, 1)).toBeNull();
    expect(launchProfile(-1, 1, 1)).toBeNull();
    expect(launchProfile(0, 1, 1)).not.toBeNull();
    expect(launchProfile(LAUNCH_RADIUS, 1, 1)).not.toBeNull();
  });

  it("lo más cercano sube más alto y es estable para el mismo id y tick", () => {
    const close = launchProfile(0.2, 7, 100)!;
    const edge = launchProfile(2.4, 7, 100)!;
    expect(close.height).toBeGreaterThan(edge.height);
    expect(close.duration).toBeGreaterThan(edge.duration);
    expect(launchProfile(0.2, 7, 100)).toEqual(close);
  });

  it("empieza y aterriza en el suelo y derecha, con vueltas enteras", () => {
    for (let id = 1; id < 40; id++) {
      const p = launchProfile((id % 10) * 0.25, id, id * 3)!;
      const a = launchOffset(p, 0);
      const z = launchOffset(p, p.duration);
      expect(a.y).toBeCloseTo(0, 9);
      expect(z.y).toBeCloseTo(0, 9);
      expect(z.push).toBeCloseTo(0, 9);
      expect(z.roll / (Math.PI * 2)).toBeCloseTo(Math.round(z.roll / (Math.PI * 2)), 9);
      expect(z.pitch / (Math.PI * 2)).toBeCloseTo(Math.round(z.pitch / (Math.PI * 2)), 9);
      let top = 0;
      for (let k = 0; k <= 10; k++) top = Math.max(top, launchOffset(p, (p.duration * k) / 10).y);
      expect(top).toBeCloseTo(p.height, 1);
    }
  });

  it("el rastreador limita las unidades en el aire y las retira al aterrizar", () => {
    const tracker = new AirborneTracker();
    const profile = launchProfile(0.5, 1, 1)!;
    for (let id = 1; id <= MAX_AIRBORNE; id++) expect(tracker.launch(id, profile, 1, 0, 0)).toBe(true);
    expect(tracker.launch(MAX_AIRBORNE + 1, profile, 1, 0, 0)).toBe(false);
    expect(tracker.launch(1, profile, 0, 1, 0.1)).toBe(true);
    expect(tracker.size).toBe(MAX_AIRBORNE);
    expect(tracker.active(0.1)).toBe(MAX_AIRBORNE);
    expect(tracker.active(profile.duration + 0.2)).toBe(0);
    tracker.prune(profile.duration + 1);
    expect(tracker.size).toBe(0);
    tracker.launch(3, profile, 1, 0, 0);
    tracker.clear();
    expect(tracker.get(3)).toBeUndefined();
  });
});

describe("P9 presupuesto de mallas", () => {
  // WebGL no existe en Node: el sustituto fabrica materiales reales sin texturas.
  const assets = {
    track: <T>(r: T): T => r,
    basic: (p: THREE.MeshBasicMaterialParameters) => new THREE.MeshBasicMaterial(p),
    lambert: (p: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial(p),
    surface: (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p),
    textures: new Proxy({}, { get: () => undefined }),
  } as unknown as AssetLibrary;

  const count = (root: THREE.Object3D): number => {
    let n = 0;
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) n++;
    });
    return n;
  };

  it("el caballero y el cañón caben en su tope de mallas", () => {
    const factory = new UnitFactory(assets, new Materials(assets));
    const knight = factory.create("knight", 0, true);
    const cannon = factory.create("cannon", 1, true);
    expect(count(knight.root)).toBeLessThanOrEqual(16 + 3);
    expect(count(cannon.root)).toBeLessThanOrEqual(11 + 3);
    expect(count(knight.root)).toBeGreaterThan(count(factory.create("soldier", 0, true).root));
  });
});

describe("P9 artillero del cañón", () => {
  const base = { t: 1, walking: false, rolled: 0, station: 0, lighting: 0, sinceShot: null } as const;

  it("va de la cola a la culata, y la mecha baja al encender", () => {
    const rear = crewPose({ ...base, station: 0 });
    const side = crewPose({ ...base, station: 1 });
    expect(rear.z).toBeCloseTo(CREW.rearZ, 9);
    expect(side.z).toBeCloseTo(CREW.sideZ, 9);
    expect(side.x).toBeCloseTo(CREW.sideX, 9);
    let prev = crewPose({ ...base, station: 1, lighting: 0 }).armRx;
    for (let k = 1; k <= 10; k++) {
      const arm = crewPose({ ...base, station: 1, lighting: k / 10 }).armRx;
      expect(arm).toBeLessThanOrEqual(prev + 1e-9);
      prev = arm;
    }
    expect(crewPose({ ...base, station: 1, lighting: 1 }).ember).toBeGreaterThan(crewPose({ ...base, station: 1, lighting: 0 }).ember);
  });

  it("empuja con zancadas al rodar, se tapa un oído tras el disparo y la mecha siempre arde", () => {
    const still = crewPose({ ...base, rolled: 0.2 });
    const walking = crewPose({ ...base, walking: true, rolled: 0.2 });
    expect(still.legL).toBe(0);
    expect(Math.abs(walking.legL)).toBeGreaterThan(0.1);
    const calm = crewPose({ ...base, station: 1, sinceShot: null });
    const blast = crewPose({ ...base, station: 1, sinceShot: 0.3 });
    expect(blast.armLx).toBeLessThan(calm.armLx - 0.5);
    const later = crewPose({ ...base, station: 1, sinceShot: 2 });
    expect(later.armLx).toBeCloseTo(calm.armLx, 9);
    for (let i = 0; i < 100; i++) expect(crewPose({ ...base, t: i / 7 }).ember).toBeGreaterThan(0);
    expect(crewPose({ ...base, walking: true, rolled: 0.3, station: 0.4, sinceShot: 0.2 })).toEqual(crewPose({ ...base, walking: true, rolled: 0.3, station: 0.4, sinceShot: 0.2 }));
  });
});

describe("P9 caballos del establo", () => {
  it("cada caballo es una geometría con color de vértice en el pelaje elegido", () => {
    for (const coat of STABLE_COATS) {
      const g = stableHorseGeometry(coat, { neck: 0, scale: 1, yaw: 0 });
      const color = g.getAttribute("color");
      expect(color).toBeDefined();
      expect(color!.count).toBe(g.getAttribute("position").count);
      const hex = new Set<number>();
      const c = new THREE.Color();
      for (let i = 0; i < color!.count; i++) hex.add(c.setRGB(color!.getX(i), color!.getY(i), color!.getZ(i)).getHex());
      expect(hex.size).toBeGreaterThan(1);
      g.dispose();
    }
    expect(STABLE_COATS.length).toBeGreaterThanOrEqual(3);
  });

  it("la escala y el giro cambian el tamaño y la orientación", () => {
    const size = (s: number, yaw: number): THREE.Vector3 => {
      const g = stableHorseGeometry(STABLE_COATS[0]!, { neck: 0, scale: s, yaw });
      g.computeBoundingBox();
      const v = g.boundingBox!.getSize(new THREE.Vector3());
      g.dispose();
      return v;
    };
    const big = size(1, 0);
    expect(size(0.5, 0).y).toBeCloseTo(big.y / 2, 5);
    const turned = size(1, Math.PI / 2);
    expect(turned.x).toBeCloseTo(big.z, 5);
    expect(big.z).toBeGreaterThan(big.x);
  });
});

describe("P9 humo de la chimenea de la armería", () => {
  const assets = { track: <T>(r: T): T => r } as unknown as AssetLibrary;

  it("en calidad baja no crea partículas y en alta sí, con presupuesto propio", () => {
    expect(new ChimneyFactory(assets, false).create(1)).toBeNull();
    const rig = new ChimneyFactory(assets, true).create(3)!;
    expect(rig.smoke.count).toBe(CHIMNEY_PARTICLES);
    expect(rig.group.visible).toBe(false);
  });

  it("el humo es constante: sube sobre la chimenea, siempre hay partículas visibles y no se ve inactivo", () => {
    const rig = new ChimneyFactory(assets, true).create(5)!;
    updateChimney(rig, false, 4);
    expect(rig.group.visible).toBe(false);
    for (const t of [0, 1.7, 3.1, 9.4, 50]) {
      updateChimney(rig, true, t);
      expect(rig.group.visible).toBe(true);
      const pos = rig.smoke.points.geometry.getAttribute("position");
      let above = 0;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) >= CHIMNEY_TOP[1] - 1e-6) above++;
      expect(above).toBe(pos.count);
    }
  });

  it("la boca de la chimenea queda por encima del tejado de la armería", () => {
    expect(CHIMNEY_TOP[1]).toBeGreaterThan(0.3 + 1.3 + 0.8);
  });
});
