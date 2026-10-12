export type Role = "villager" | "archer" | "soldier";
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
