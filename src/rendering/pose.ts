export type Role = "villager" | "archer" | "soldier" | "knight" | "cannon";
export type WorkKind = "wood" | "food" | "stone" | "build";

export interface PoseInput {
  role: Role;
  /** Tiempo de animación en segundos; se detiene con la pausa. */
  t: number;
  walking: boolean;
  work: WorkKind | null;
  carrying: boolean;
  /** Fase 0..1 desde el último ataque efectivo; null si la unidad no está combatiendo. */
  combatPhase: number | null;
  /** Solo jinete: 0 (al paso o parado) a 1 (galope); inclina el torso hacia delante. */
  gait?: number;
}

/** Ángulos en radianes. Los brazos y piernas giran sobre X: negativo levanta hacia delante. */
export interface Pose {
  legL: number;
  legR: number;
  armLx: number;
  armLz: number;
  armRx: number;
  armRz: number;
  torsoPitch: number;
  bob: number;
  /** 0 = cuerda en reposo, 1 = arco completamente tensado. */
  bowDraw: number;
}

const WALK_OMEGA = 14;
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const easeIn = (k: number): number => k * k;
const easeOut = (k: number): number => 1 - (1 - k) * (1 - k);

function rest(): Pose {
  return { legL: 0, legR: 0, armLx: 0, armLz: 0.08, armRx: 0, armRz: -0.08, torsoPitch: 0, bob: 0, bowDraw: 0 };
}

/** P2-H09: duración de la caída, tiempo total que permanece el cuerpo y tramo final de encogimiento (segundos). */
export const DEATH_FALL_S = 0.6;
export const DEATH_LINGER_S = 5;
export const DEATH_SHRINK_S = 0.4;

export interface DeathState {
  /** 0 = de pie, 1 = tendido. */
  fall: number;
  /** Escala del cuerpo; baja a 0 en el último tramo. */
  scale: number;
  /** El cuerpo ya debe retirarse. */
  done: boolean;
}

/** Estado visual de un cuerpo según los segundos de juego transcurridos desde la muerte. */
export function deathState(age: number): DeathState {
  const a = Math.max(0, age);
  if (a >= DEATH_LINGER_S) return { fall: 1, scale: 0, done: true };
  const k = clamp01(a / DEATH_FALL_S);
  const shrink = clamp01((a - (DEATH_LINGER_S - DEATH_SHRINK_S)) / DEATH_SHRINK_S);
  return { fall: easeIn(k) * (2 - k), scale: 1 - shrink, done: false };
}

/** Esqueleto relajado de un cuerpo caído; las extremidades se abren según avanza la caída. */
export function deathPose(fall: number): Pose {
  return { legL: 0.12 * fall, legR: -0.18 * fall, armLx: -0.2 * fall, armLz: 0.08 + 0.7 * fall, armRx: 0.15 * fall, armRz: -0.08 - 0.9 * fall, torsoPitch: 0, bob: 0, bowDraw: 0 };
}

/** Pose de un esqueleto articulado; función pura para poder comprobarla sin renderizar. */
export function computePose(input: PoseInput): Pose {
  const { role, t } = input;
  const pose = rest();
  const breathe = Math.sin(t * 2) * 0.03;
  pose.armLz += breathe;
  pose.armRz -= breathe;

  if (role === "knight") return riderPose(pose, input, breathe);
  if (role === "cannon") return pose;

  if (input.walking) {
    const s = Math.sin(t * WALK_OMEGA);
    pose.legL = s * 0.75;
    pose.legR = -s * 0.75;
    pose.armLx = -s * 0.55;
    pose.armRx = s * 0.55;
    pose.bob = Math.abs(s) * 0.035;
    pose.torsoPitch = 0.06;
    if (input.carrying) {
      pose.armLx = -0.5;
      pose.armRx = -0.5;
      pose.torsoPitch = 0.12;
    }
    if (role === "archer") pose.armLx = -0.9;
    if (role === "soldier") pose.armLx = -0.6;
    return pose;
  }

  if (input.combatPhase !== null) {
    const p = clamp01(input.combatPhase);
    if (role === "villager") {
      // Golpe de tosco: el brazo derecho se alza y cae con el torso, el izquierdo se adelanta para guardarse.
      pose.armLx = -0.7;
      pose.armLz = 0.25;
      if (p < 0.3) {
        const k = easeIn(p / 0.3);
        pose.armRx = lerp(-2.1, 0.3, k);
        pose.torsoPitch = lerp(-0.12, 0.35, k);
      } else {
        const k = easeOut((p - 0.3) / 0.7);
        pose.armRx = lerp(0.3, -2.1, k);
        pose.torsoPitch = lerp(0.35, -0.12, k);
      }
      return pose;
    }
    if (role === "soldier") {
      // Golpe inmediato, recuperación y elevación del arma para el siguiente.
      pose.armLx = -0.9;
      pose.armLz = 0.3;
      if (p < 0.25) {
        const k = easeIn(p / 0.25);
        pose.armRx = lerp(-2.3, 0.35, k);
        pose.torsoPitch = lerp(-0.1, 0.3, k);
      } else if (p < 0.55) {
        const k = easeOut((p - 0.25) / 0.3);
        pose.armRx = lerp(0.35, -1.0, k);
        pose.torsoPitch = lerp(0.3, 0, k);
      } else {
        const k = (p - 0.55) / 0.45;
        pose.armRx = lerp(-1.0, -2.3, k);
        pose.torsoPitch = lerp(0, -0.1, k);
      }
      return pose;
    }
    if (role === "archer") {
      // Suelta, encaja y tensa; el brazo del arco permanece extendido hacia el objetivo.
      pose.armLx = -1.5;
      pose.armLz = 0;
      if (p < 0.12) {
        pose.armRx = lerp(-0.9, -1.55, p / 0.12);
        pose.bowDraw = 0;
        pose.torsoPitch = 0.04;
      } else if (p < 0.35) {
        const k = (p - 0.12) / 0.23;
        pose.armRx = lerp(-1.55, -0.95, k);
        pose.bowDraw = 0.15 * k;
      } else {
        const k = (p - 0.35) / 0.65;
        pose.armRx = lerp(-0.95, -0.55, k);
        pose.bowDraw = lerp(0.15, 1, k);
        pose.torsoPitch = -0.08 * k;
      }
      pose.armRz = lerp(-0.1, -0.45, pose.bowDraw);
      return pose;
    }
  }

  if (input.work === "wood" || input.work === "stone") {
    const cycle = (t * 1.8) % 1;
    // Subida lenta y golpe rápido: la curva baja en el tramo final del ciclo.
    const rise = cycle < 0.6 ? easeOut(cycle / 0.6) : 1 - easeIn((cycle - 0.6) / 0.4);
    const angle = lerp(0.2, -2.4, rise);
    pose.armLx = angle;
    pose.armRx = angle;
    pose.torsoPitch = lerp(0.3, -0.12, rise);
    return pose;
  }

  if (input.work === "food") {
    const sway = Math.sin(t * 5);
    pose.torsoPitch = 0.75;
    pose.armLx = -0.9 + sway * 0.35;
    pose.armRx = -0.9 - sway * 0.35;
    pose.bob = -0.05;
    return pose;
  }

  if (input.work === "build") {
    const cycle = (t * 2.2) % 1;
    const rise = cycle < 0.6 ? easeOut(cycle / 0.6) : 1 - easeIn((cycle - 0.6) / 0.4);
    pose.armRx = lerp(-0.3, -2.0, rise);
    pose.armLx = -0.9;
    pose.armLz = 0.2;
    pose.torsoPitch = lerp(0.25, 0, rise);
    return pose;
  }

  if (input.carrying) {
    pose.armLx = -0.5;
    pose.armRx = -0.5;
    pose.torsoPitch = 0.1;
  }
  if (role === "archer") pose.armLx = -0.5 + breathe;
  return pose;
}

/**
 * Jinete sentado a horcajadas: las piernas se abren con `legSplay` (lo aplica `applyPose`), el torso acompaña al
 * caballo y el tajo es lateral, distinto del golpe del soldado a pie. El bamboleo lo pone el caballo.
 */
function riderPose(pose: Pose, input: PoseInput, breathe: number): Pose {
  const gait = clamp01(input.gait ?? (input.walking ? 1 : 0));
  pose.legL = -0.45;
  pose.legR = -0.45;
  pose.armLx = lerp(-0.55, -0.85, gait);
  pose.armLz = 0.12 + breathe;
  pose.armRx = lerp(-0.35, -1.3, gait);
  pose.torsoPitch = lerp(0, 0.3, gait);
  if (input.combatPhase !== null) {
    const p = clamp01(input.combatPhase);
    pose.armLx = -0.9;
    pose.armLz = 0.3;
    if (p < 0.25) {
      const k = easeIn(p / 0.25);
      pose.armRx = lerp(-2.4, -0.2, k);
      pose.armRz = lerp(-1.1, 0.35, k);
      pose.torsoPitch = lerp(-0.08, 0.35, k);
    } else if (p < 0.6) {
      const k = easeOut((p - 0.25) / 0.35);
      pose.armRx = lerp(-0.2, -1.1, k);
      pose.armRz = lerp(0.35, -0.5, k);
      pose.torsoPitch = lerp(0.35, 0.05, k);
    } else {
      const k = (p - 0.6) / 0.4;
      pose.armRx = lerp(-1.1, -2.4, k);
      pose.armRz = lerp(-0.5, -1.1, k);
      pose.torsoPitch = lerp(0.05, -0.08, k);
    }
  }
  return pose;
}

/** Ángulos de una pata de dos tramos; positivo lleva el tramo hacia atrás. `lower` es relativo al tramo superior. */
export interface LegAngles {
  upper: number;
  lower: number;
}

/** Pata delantera izquierda, delantera derecha, trasera izquierda y trasera derecha. */
export type HorseLegs = readonly [LegAngles, LegAngles, LegAngles, LegAngles];

export interface HorsePose {
  legs: HorseLegs;
  /** Cabeceo del cuerpo en radianes; positivo baja el pecho, negativo lo alza (encabritado). */
  pitch: number;
  /** Subida vertical del cuerpo en unidades de mundo (nunca negativa). */
  bob: number;
  /** Cabeceo del cuello y la cabeza; positivo los baja (pastar). */
  neck: number;
  /** Cola: caída hacia atrás (x) y vaivén lateral (z). */
  tail: number;
  tailSway: number;
  /** Escala vertical del pecho al respirar. */
  chest: number;
  /** 1 = encabritado completo. */
  rear: number;
}

export interface GallopOptions {
  /** Segundos de animación, para el reposo con vida. */
  t?: number;
  /** Semilla estable (identificador de la unidad) para desfasar los gestos de reposo. */
  seed?: number;
  /** 0..1: encabritado del ataque. */
  rear?: number;
}

/** Dimensiones del caballo compartidas por el modelo y la cinemática de las patas. */
export const HORSE = { hip: 0.52, upper: 0.26, lower: 0.25 } as const;

const GALLOP_OFFSETS = [0.5, 0.62, 0, 0.12] as const;
const STANCE = 0.3;
const smooth = (k: number): number => k * k * (3 - 2 * k);

function gallopLeg(phase: number, offset: number, amplitude: number): LegAngles {
  const u = ((phase + offset) % 1 + 1) % 1;
  if (u < STANCE) return { upper: lerp(-amplitude, amplitude, u / STANCE), lower: 0 };
  const k = (u - STANCE) / (1 - STANCE);
  return { upper: lerp(amplitude, -amplitude, smooth(k)), lower: 1.1 * Math.sin(Math.PI * k) };
}

/** Pata trasera: el corvejón queda algo doblado incluso en reposo. */
const HIND_REST: LegAngles = { upper: -0.12, lower: 0.2 };

/**
 * Pose del caballo. `phase` son ciclos de zancada (se repite con periodo 1) y `speedRatio` va de 0 (reposo con
 * vida) a 1 (galope); entre ambos la mezcla es continua, sin saltos de pose. Función pura.
 */
export function gallopPose(phase: number, speedRatio: number, options: GallopOptions = {}): HorsePose {
  const s = clamp01(speedRatio);
  const t = options.t ?? 0;
  const seed = options.seed ?? 0;
  const rear = clamp01(options.rear ?? 0);
  const phi = 2 * Math.PI * phase;
  const restLeg: LegAngles = { upper: 0, lower: 0 };
  const legs = GALLOP_OFFSETS.map((offset, i) => {
    const hind = i >= 2;
    const g = gallopLeg(phase, offset, hind ? 0.5 : 0.45);
    const base = hind ? HIND_REST : restLeg;
    return { upper: lerp(base.upper, g.upper, s), lower: lerp(base.lower, g.lower, s) };
  }) as unknown as [LegAngles, LegAngles, LegAngles, LegAngles];

  // Reposo con vida: pastar y escarbar salen de la semilla, no de Math.random.
  const grazeCycle = frac01(t / (9 + (seed % 5)) + seed * 0.137);
  const graze = (1 - s) * (1 - rear) * smooth(clamp01((grazeCycle - 0.62) / 0.06)) * (1 - smooth(clamp01((grazeCycle - 0.84) / 0.06)));
  const pawCycle = frac01(t / (7 + (seed % 3)) + seed * 0.291);
  const paw = (1 - s) * (1 - rear) * (1 - graze) * (pawCycle > 0.82 ? Math.max(0, Math.sin(((pawCycle - 0.82) / 0.18) * Math.PI * 4)) : 0);
  legs[0] = { upper: legs[0].upper - 0.55 * paw, lower: legs[0].lower + 0.7 * paw };

  const pitch = lerp(0, 0.06 * Math.sin(phi + 0.6), s) - 0.35 * rear + 0.05 * graze;
  const bob = lerp(0, 0.05 * (0.5 + 0.5 * Math.sin(2 * phi + 0.4)) + 0.02, s) + 0.1 * rear;
  const neck = lerp(0.03 * Math.sin(t * 0.9 + seed), -0.05 + 0.1 * Math.sin(phi + Math.PI / 2), s) + 0.85 * graze - 0.15 * rear;
  const tail = lerp(0.12 + 0.05 * Math.sin(t * 1.3 + seed), 0.75 + 0.15 * Math.sin(2 * phi), s);
  const tailSway = lerp(0.3 * Math.sin(t * 2.1 + seed * 1.7), 0.12 * Math.sin(phi), s);

  if (rear > 0) {
    for (let i = 0; i < 2; i++) legs[i] = { upper: lerp(legs[i]!.upper, -0.8, rear), lower: lerp(legs[i]!.lower, 0.9, rear) };
  }
  return { legs, pitch, bob, neck, tail, tailSway, chest: 1 + 0.018 * Math.sin(t * 1.8 + seed), rear };
}

const frac01 = (x: number): number => x - Math.floor(x);

/** Altura del casco sobre el suelo con la pose dada (cinemática directa; el cuerpo no se cabecea). */
export function hoofHeight(leg: LegAngles, bob: number): number {
  return bob + HORSE.hip - HORSE.upper * Math.cos(leg.upper) - HORSE.lower * Math.cos(leg.upper + leg.lower);
}

/** Entrada de la pose del cañón. */
export interface CannonInput {
  /** Distancia recorrida en celdas; mueve las ruedas. */
  rolled: number;
  /** Segundos desde el último disparo; null si no ha disparado. */
  sinceShot: number | null;
}

export interface CannonPose {
  /** Giro de las ruedas en radianes. */
  wheelSpin: number;
  /** Retroceso del tubo a lo largo de su eje, en unidades de mundo. */
  recoil: number;
  /** Respingo vertical de la cureña. */
  hop: number;
  /** Cabeceo extra del tubo al disparar (radianes, positivo sube la boca). */
  pitchKick: number;
  /** Rebote del tubo al rodar. */
  bounce: number;
  /** Desplazamiento hacia atrás de la cureña por el disparo. */
  slide: number;
}

export const CANNON = { wheelRadius: 0.3, recoil: 0.25, recoilSeconds: 0.4, elevation: 0.5, pivotY: 0.58, pivotZ: 0.05, muzzleY: 0.9, muzzleZ: 0.62 } as const;

/** Pose del cañón: ruedas proporcionales al recorrido y retroceso amortiguado que vuelve a 0. Función pura. */
export function cannonPose(input: CannonInput): CannonPose {
  const spin = input.rolled / CANNON.wheelRadius;
  const bounce = 0.012 * Math.abs(Math.sin(input.rolled * 9));
  let recoil = 0;
  let hop = 0;
  let pitchKick = 0;
  let slide = 0;
  const tau = input.sinceShot;
  if (tau !== null && tau >= 0 && tau < CANNON.recoilSeconds) {
    const peak = 0.06;
    recoil = CANNON.recoil * (tau < peak ? tau / peak : (1 - (tau - peak) / (CANNON.recoilSeconds - peak)) ** 2);
    const k = tau / CANNON.recoilSeconds;
    hop = 0.035 * Math.sin(Math.PI * Math.min(1, k * 1.5));
    pitchKick = 0.06 * (recoil / CANNON.recoil);
    slide = 0.06 * (recoil / CANNON.recoil);
  }
  return { wheelSpin: spin, recoil, hop, pitchKick, bounce, slide };
}

/** Puestos del artillero en el marco del cañón (+z = boca): empujando tras la cola o junto a la culata con la mecha. */
export const CREW = {
  rearZ: -1.5,
  sideX: 0.84,
  sideZ: 0,
  sideYaw: -1.45,
  /** Distancia recorrida por zancada completa del artillero al empujar. */
  strideLength: 0.9,
  /** Segundos tras el disparo en que sigue junto a la culata antes de retirarse. */
  holdSeconds: 0.35,
  /** Ticks antes del disparo en que el artillero ya está junto a la culata, y ticks en que baja la mecha. */
  leadTicks: 16,
  lightTicks: 8,
} as const;

export interface CrewInput {
  /** Tiempo de animación en segundos. */
  t: number;
  /** El cañón se está desplazando: el artillero empuja. */
  walking: boolean;
  /** Distancia rodada por el cañón (celdas). */
  rolled: number;
  /** 0 = tras la cola, 1 = junto a la culata. */
  station: number;
  /** 0 = mecha en alto, 1 = mecha sobre el oído de la pieza. */
  lighting: number;
  /** Segundos desde el último disparo; null si no ha disparado. */
  sinceShot: number | null;
}

export interface CrewPose extends Pose {
  /** Posición del artillero respecto al cañón. */
  x: number;
  z: number;
  yaw: number;
  /** Giro de la mecha respecto al antebrazo (rad). */
  staff: number;
  /** Escala del ascua de la mecha: vive siempre y se aviva al encender. */
  ember: number;
}

const smoothstep = (k: number): number => {
  const c = clamp01(k);
  return c * c * (3 - 2 * c);
};

/**
 * Pose del artillero: empuja la cola al rodar, se sitúa junto a la culata antes de cada tiro, baja la mecha sobre el
 * oído y se aparta tapándose un oído tras el estampido. Función pura.
 */
export function crewPose(input: CrewInput): CrewPose {
  const pose = rest();
  const e = smoothstep(input.station);
  const L = clamp01(input.lighting);
  const breathe = Math.sin(input.t * 2) * 0.03;
  const transit = Math.sin(Math.PI * clamp01(input.station));

  let armRx = lerp(-1.0, -0.3, e);
  pose.armLx = lerp(-1.0, -0.35, e);
  pose.armLz += breathe;
  pose.armRz -= breathe;
  if (input.walking && e < 0.5) {
    const s = Math.sin((input.rolled / CREW.strideLength) * Math.PI * 2);
    pose.legL = s * 0.7;
    pose.legR = -s * 0.7;
    pose.bob = Math.abs(s) * 0.03;
    pose.torsoPitch = 0.22;
  } else if (transit > 0.02) {
    const s = Math.sin(input.t * 14);
    pose.legL = s * 0.7 * transit;
    pose.legR = -s * 0.7 * transit;
    pose.bob = Math.abs(s) * 0.03 * transit;
    pose.torsoPitch = 0.1 * transit;
  }

  // Baja la mecha desde lo alto hasta tocar el oído; el brazo se extiende hacia la culata.
  armRx = lerp(armRx, -1.45, L);
  pose.armRx = armRx;
  pose.armRz = lerp(pose.armRz, -0.05, L);
  pose.torsoPitch = lerp(pose.torsoPitch, 0.18, L);
  // Ángulo total de la mecha: vertical en reposo, apuntando al oído de la pieza al encender; `staff` es relativo al brazo.
  const staffAngle = lerp(0, 1.95, smoothstep(L));
  let ember = 0.75 + 0.2 * Math.sin(input.t * 9) + 0.55 * L;

  const tau = input.sinceShot;
  if (tau !== null && tau >= 0 && tau < 1.4) {
    // Tras el estampido echa el cuerpo atrás y se tapa un oído mientras se retira.
    const ear = smoothstep(tau / 0.2) * (1 - smoothstep((tau - 0.9) / 0.4));
    pose.armLx = lerp(pose.armLx, -2.55, ear);
    pose.armLz = lerp(pose.armLz, -0.55, ear);
    pose.torsoPitch = lerp(pose.torsoPitch, -0.2, ear);
    ember += 0.6 * (1 - smoothstep(tau / 0.3));
  }

  return {
    ...pose,
    x: lerp(0, CREW.sideX, e),
    z: lerp(CREW.rearZ, CREW.sideZ, e),
    yaw: lerp(0, CREW.sideYaw, e),
    staff: staffAngle - armRx,
    ember,
  };
}
