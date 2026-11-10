import * as THREE from "three";
import { mergeParts, type Part } from "./merge";
import { HORSE } from "./pose";

/**
 * Piezas del caballo y del cañón. Todas son geometría pura (sin materiales ni escena): `units.ts` las funde con color
 * de vértice y las comparte entre todas las unidades del mismo tipo y bando.
 *
 * Convenio del caballo: mira hacia +z; las caderas están a `HORSE.hip` de altura, la trasera en z = HIND_Z y la
 * delantera en z = FORE_Z. Los grupos de pata, cuello y cola se articulan en los pivotes de abajo.
 */
export const FORE_Z = 0.3;
export const HIND_Z = -0.32;
export const LEG_X = 0.1;
export const NECK_PIVOT = [0, 0.78, 0.4] as const;
export const TAIL_PIVOT = [0, 0.74, -0.5] as const;
/** Altura del asiento: la cadera del jinete se coloca aquí. */
export const SADDLE_Y = 0.85;
export const SADDLE_Z = -0.02;

export const COAT = 0x8a4b24;
const COAT_DARK = 0x6e3a1b;
const MANE = 0x2a1a10;
const HOOF = 0x2b2623;
const BLAZE = 0xf2f2f2;
const LEATHER = 0x5a3a20;
const STEEL = 0xa7b0ba;
const BRONZE = 0xb07a3a;
const BRONZE_DARK = 0x7d5524;
const WOOD = 0x7a5230;
const WOOD_DARK = 0x5a3b22;
const IRON = 0x3b4046;

export interface Palette {
  team: number;
}

export function horseBodyParts({ team }: Palette): Part[] {
  const barrel = new THREE.CapsuleGeometry(0.19, 0.5, 4, 12).rotateX(Math.PI / 2);
  return [
    { geometry: barrel, position: [0, 0.65, 0], color: COAT },
    { geometry: new THREE.SphereGeometry(0.205, 10, 8), position: [0, 0.67, FORE_Z - 0.02], color: COAT },
    { geometry: new THREE.SphereGeometry(0.215, 10, 8), position: [0, 0.65, HIND_Z + 0.02], color: COAT },
    { geometry: new THREE.SphereGeometry(0.17, 8, 6).scale(1, 0.6, 1), position: [0, 0.46, 0.0], color: COAT_DARK },
    // Manta del bando y silla de cuero con estribos.
    { geometry: new THREE.BoxGeometry(0.4, 0.035, 0.36), position: [0, 0.835, SADDLE_Z], color: team },
    { geometry: new THREE.BoxGeometry(0.03, 0.2, 0.34), position: [0.2, 0.74, SADDLE_Z], color: team },
    { geometry: new THREE.BoxGeometry(0.03, 0.2, 0.34), position: [-0.2, 0.74, SADDLE_Z], color: team },
    { geometry: new THREE.BoxGeometry(0.28, 0.05, 0.26), position: [0, 0.865, SADDLE_Z], color: LEATHER },
    { geometry: new THREE.BoxGeometry(0.26, 0.07, 0.04), position: [0, 0.89, SADDLE_Z - 0.12], color: LEATHER },
    { geometry: new THREE.BoxGeometry(0.2, 0.05, 0.04), position: [0, 0.89, SADDLE_Z + 0.12], color: LEATHER },
    { geometry: new THREE.BoxGeometry(0.014, 0.2, 0.014), position: [0.235, 0.62, SADDLE_Z], color: LEATHER },
    { geometry: new THREE.BoxGeometry(0.014, 0.2, 0.014), position: [-0.235, 0.62, SADDLE_Z], color: LEATHER },
    { geometry: new THREE.BoxGeometry(0.05, 0.016, 0.1), position: [0.235, 0.52, SADDLE_Z], color: STEEL },
    { geometry: new THREE.BoxGeometry(0.05, 0.016, 0.1), position: [-0.235, 0.52, SADDLE_Z], color: STEEL },
    // Pretal y cincha.
    { geometry: new THREE.TorusGeometry(0.19, 0.012, 4, 12, Math.PI).rotateY(Math.PI / 2), position: [0, 0.65, FORE_Z + 0.02], color: LEATHER },
  ];
}

/** Cuello, cabeza, orejas, crines y brida, relativos al pivote del cuello (`NECK_PIVOT`). */
export function horseNeckParts(): Part[] {
  const neck = 0.8;
  const dir = [Math.cos(neck), Math.sin(neck)] as const;
  const head = 2.2;
  const hdir = [Math.cos(head), Math.sin(head)] as const;
  const neckEnd = [0.3 * dir[0], 0.3 * dir[1]] as const;
  const headCenter = [neckEnd[0] - 0.02, neckEnd[1] + 0.1] as const;
  const out: Part[] = [
    { geometry: new THREE.CapsuleGeometry(0.085, 0.24, 4, 10), position: [0, 0.15 * dir[0], 0.15 * dir[1]], rotation: [neck, 0, 0], color: COAT },
    { geometry: new THREE.CapsuleGeometry(0.06, 0.15, 4, 10), position: [0, headCenter[0], headCenter[1]], rotation: [head, 0, 0], color: COAT },
    { geometry: new THREE.BoxGeometry(0.1, 0.075, 0.1), position: [0, headCenter[0] + 0.13 * hdir[0] + 0.01, headCenter[1] + 0.13 * hdir[1] - 0.005], rotation: [head, 0, 0], color: COAT_DARK },
    { geometry: new THREE.BoxGeometry(0.024, 0.11, 0.012), position: [0, headCenter[0] + 0.048, headCenter[1] + 0.035], rotation: [head, 0, 0], color: BLAZE },
    { geometry: new THREE.TorusGeometry(0.064, 0.01, 4, 10), position: [0, headCenter[0] + 0.08 * hdir[0], headCenter[1] + 0.08 * hdir[1]], rotation: [head - Math.PI / 2, 0, 0], color: LEATHER },
    { geometry: new THREE.SphereGeometry(0.014, 5, 4), position: [0.057, headCenter[0] + 0.04, headCenter[1] - 0.03], color: 0x111111 },
    { geometry: new THREE.SphereGeometry(0.014, 5, 4), position: [-0.057, headCenter[0] + 0.04, headCenter[1] - 0.03], color: 0x111111 },
    { geometry: new THREE.ConeGeometry(0.022, 0.07, 5), position: [0.04, headCenter[0] + 0.1, headCenter[1] - 0.1], rotation: [-0.2, 0, 0.2], color: COAT },
    { geometry: new THREE.ConeGeometry(0.022, 0.07, 5), position: [-0.04, headCenter[0] + 0.1, headCenter[1] - 0.1], rotation: [-0.2, 0, -0.2], color: COAT },
  ];
  for (let i = 0; i < 4; i++) {
    const s = 0.04 + i * 0.07;
    out.push({
      geometry: new THREE.BoxGeometry(0.035, 0.1, 0.07),
      position: [0, s * dir[0] + 0.09 * dir[1], s * dir[1] - 0.09 * dir[0]],
      rotation: [neck, 0, 0],
      color: MANE,
    });
  }
  out.push({ geometry: new THREE.BoxGeometry(0.04, 0.05, 0.08), position: [0, headCenter[0] + 0.1, headCenter[1] - 0.07], color: MANE });
  return out;
}

/** Cola colgante, relativa a `TAIL_PIVOT`. */
export function horseTailParts(): Part[] {
  return [
    { geometry: new THREE.CapsuleGeometry(0.035, 0.26, 3, 6), position: [0, -0.15, -0.02], rotation: [0.1, 0, 0], color: MANE },
    { geometry: new THREE.SphereGeometry(0.05, 6, 5).scale(1, 1.6, 1), position: [0, -0.32, -0.03], color: MANE },
  ];
}

/**
 * Tramo superior de la pata (muslo o antebrazo), colgando del pivote de la cadera. Con `jointed` falso se añade el
 * tramo inferior en la misma malla (calidad baja: pata rígida).
 */
export function horseUpperParts(hind: boolean, jointed: boolean): Part[] {
  const r = hind ? 0.07 : 0.058;
  const out: Part[] = [
    { geometry: new THREE.CapsuleGeometry(r, HORSE.upper - 2 * r, 3, 8), position: [0, -HORSE.upper / 2, 0], color: COAT },
  ];
  if (!jointed) out.push(...horseLowerParts().map((p) => ({ ...p, position: [0, -HORSE.upper + (p.position?.[1] ?? 0), 0] as const })));
  return out;
}

/** Caña, menudillo y casco, relativos a la rodilla/corvejón. */
export function horseLowerParts(): Part[] {
  return [
    { geometry: new THREE.CapsuleGeometry(0.038, 0.12, 3, 8), position: [0, -0.11, 0], color: COAT_DARK },
    { geometry: new THREE.CylinderGeometry(0.046, 0.054, 0.06, 8), position: [0, -0.22, 0.005], color: HOOF },
    { geometry: new THREE.CylinderGeometry(0.05, 0.05, 0.02, 8), position: [0, -0.17, 0.003], color: BLAZE },
  ];
}

export interface Coat {
  body: number;
  dark: number;
}

/** Pelajes de los caballos que se asoman en el establo: castaño, oscuro y tordo. */
export const STABLE_COATS: readonly Coat[] = [
  { body: COAT, dark: COAT_DARK },
  { body: 0x3a2b24, dark: 0x261b16 },
  { body: 0xbdbab0, dark: 0x97928a },
];

export interface StableHorsePose {
  /** Giro extra del cuello hacia delante (0 = cabeza alta, ~0,9 = pastando). */
  neck: number;
  /** Escala uniforme del caballo. */
  scale: number;
  /** Giro alrededor de la vertical. */
  yaw: number;
}

/**
 * Caballo quieto y sin silla para el establo, ya fundido en una sola geometría con color de vértice. Los pivotes son
 * los mismos del caballo montado, de modo que ambos comparten proporciones.
 */
export function stableHorseGeometry(coat: Coat, pose: StableHorsePose): THREE.BufferGeometry {
  const tint = (parts: Part[]): Part[] => parts.map((p) => (p.color === COAT ? { ...p, color: coat.body } : p.color === COAT_DARK ? { ...p, color: coat.dark } : p));
  const at = (parts: Part[], x: number, y: number, z: number, rx = 0): THREE.BufferGeometry => {
    const g = mergeParts(tint(parts));
    if (rx !== 0) g.rotateX(rx);
    return g.translate(x, y, z);
  };
  const pieces: THREE.BufferGeometry[] = [at(horseBodyParts({ team: 0 }).slice(0, 4), 0, 0, 0), at(horseNeckParts(), NECK_PIVOT[0], NECK_PIVOT[1], NECK_PIVOT[2], pose.neck), at(horseTailParts(), TAIL_PIVOT[0], TAIL_PIVOT[1], TAIL_PIVOT[2], 0.12)];
  for (const [x, z, hind] of [[LEG_X, FORE_Z, false], [-LEG_X, FORE_Z, false], [LEG_X, HIND_Z, true], [-LEG_X, HIND_Z, true]] as const) {
    pieces.push(at(horseUpperParts(hind, true), x, HORSE.hip, z), at(horseLowerParts(), x, HORSE.hip - HORSE.upper, z));
  }
  const merged = mergeParts(pieces.map((geometry) => ({ geometry })));
  for (const g of pieces) g.dispose();
  return merged.scale(pose.scale, pose.scale, pose.scale).rotateY(pose.yaw);
}

/** Caja de la cureña: laterales, eje, cola de apoyo, pila de balas y banderín del bando. */
export function cannonCarriageParts({ team }: Palette): Part[] {
  const ball = new THREE.SphereGeometry(0.085, 8, 6);
  return [
    { geometry: new THREE.BoxGeometry(0.09, 0.22, 0.9), position: [0.17, 0.42, 0.02], color: WOOD },
    { geometry: new THREE.BoxGeometry(0.09, 0.22, 0.9), position: [-0.17, 0.42, 0.02], color: WOOD },
    { geometry: new THREE.BoxGeometry(0.095, 0.025, 0.5), position: [0.17, 0.545, 0.1], color: team },
    { geometry: new THREE.BoxGeometry(0.095, 0.025, 0.5), position: [-0.17, 0.545, 0.1], color: team },
    { geometry: new THREE.BoxGeometry(0.8, 0.06, 0.07), position: [0, 0.3, 0.02], color: WOOD_DARK },
    { geometry: new THREE.BoxGeometry(0.14, 0.07, 0.8), position: [0, 0.2, -0.62], rotation: [0.16, 0, 0], color: WOOD },
    { geometry: new THREE.BoxGeometry(0.3, 0.05, 0.08), position: [0, 0.12, -1.0], color: IRON },
    { geometry: new THREE.BoxGeometry(0.34, 0.06, 0.1), position: [0, 0.4, 0.45], color: WOOD_DARK },
    { geometry: new THREE.BoxGeometry(0.22, 0.05, 0.14), position: [0, 0.36, -0.3], color: IRON },
    { geometry: ball, position: [0.07, 0.3, -0.52], color: IRON },
    { geometry: ball, position: [-0.07, 0.3, -0.52], color: IRON },
    { geometry: ball, position: [0, 0.37, -0.52], color: IRON },
    // Palanca de maniobra con empuñadura: el artillero empuja de ella al desplazar la pieza.
    { geometry: new THREE.CylinderGeometry(0.022, 0.022, 0.55, 6), position: [0, 0.385, -1.1], rotation: [-0.374, 0, 0], color: WOOD_DARK },
    { geometry: new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6).rotateZ(Math.PI / 2), position: [0, 0.64, -1.2], color: WOOD },
    { geometry: new THREE.CylinderGeometry(0.012, 0.012, 0.6, 4), position: [0.17, 0.85, -0.38], color: WOOD_DARK },
    { geometry: new THREE.BoxGeometry(0.01, 0.12, 0.24), position: [0.17, 0.99, -0.5], color: team },
  ];
}

/** Tubo de bronce relativo al muñón: culata en -z, boca en +z. */
export function cannonBarrelParts(): Part[] {
  return [
    { geometry: new THREE.CylinderGeometry(0.105, 0.15, 0.9, 12).rotateX(Math.PI / 2), position: [0, 0, 0.2], color: BRONZE },
    { geometry: new THREE.TorusGeometry(0.118, 0.03, 6, 14), position: [0, 0, 0.64], color: BRONZE_DARK },
    { geometry: new THREE.TorusGeometry(0.128, 0.022, 6, 14), position: [0, 0, 0.32], color: BRONZE_DARK },
    { geometry: new THREE.TorusGeometry(0.15, 0.025, 6, 14), position: [0, 0, -0.08], color: BRONZE_DARK },
    { geometry: new THREE.SphereGeometry(0.075, 8, 6), position: [0, 0, -0.3], color: BRONZE },
    { geometry: new THREE.CylinderGeometry(0.04, 0.04, 0.44, 8).rotateZ(Math.PI / 2), position: [0, 0, 0], color: IRON },
    { geometry: new THREE.CircleGeometry(0.075, 10), position: [0, 0, 0.652], color: 0x0b0b0b },
  ];
}

/** Rueda de radios; el eje de giro es X. */
export function cannonWheelParts(): Part[] {
  const out: Part[] = [
    { geometry: new THREE.TorusGeometry(0.27, 0.035, 5, 16).rotateY(Math.PI / 2), color: IRON },
    { geometry: new THREE.CylinderGeometry(0.07, 0.07, 0.12, 8).rotateZ(Math.PI / 2), color: WOOD_DARK },
  ];
  for (let i = 0; i < 4; i++) {
    out.push({ geometry: new THREE.BoxGeometry(0.035, 0.54, 0.045), rotation: [(i * Math.PI) / 4, 0, 0], color: WOOD });
  }
  return out;
}
