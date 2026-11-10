/** Radio, en celdas, dentro del cual una explosión lanza por los aires a las unidades (puramente visual). */
export const LAUNCH_RADIUS = 2.5;
/** Máximo de unidades lanzadas a la vez; las demás se ignoran sin error. */
export const MAX_AIRBORNE = 24;
/** Tiempo, en segundos, en que la pose vuelve a la normal tras aterrizar. */
export const LAND_RECOVER_S = 0.15;

const TWO_PI = Math.PI * 2;
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export interface LaunchProfile {
  /** Altura máxima de la parábola. */
  height: number;
  /** Duración del vuelo en segundos. */
  duration: number;
  /** Desplazamiento radial máximo, alejándose del centro, en unidades de mundo. */
  push: number;
  /** Ángulo total de balanceo y de cabeceo; siempre un número entero de vueltas, así la unidad aterriza derecha. */
  roll: number;
  pitch: number;
}

/** Hash entero estable de (id, tick); no usa Math.random para que la vista sea reproducible. */
function mix(id: number, tick: number): number {
  let h = Math.imul(id | 0, 0x9e3779b1) ^ Math.imul(tick | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * Lanzamiento de una unidad a `d` celdas del impacto: más cerca sube más alto, más tiempo y más lejos. Devuelve
 * null si queda fuera del radio. El sentido y la cantidad de volteretas salen del id y del tick.
 */
export function launchProfile(d: number, id: number, tick: number): LaunchProfile | null {
  if (!(d <= LAUNCH_RADIUS) || d < 0) return null;
  const closeness = clamp01(1 - d / LAUNCH_RADIUS);
  const a = mix(id, tick);
  const b = mix(id ^ 0x5bd1e995, tick + 1);
  const sign = a < 0.5 ? -1 : 1;
  return {
    height: lerp(0.6, 2.2, closeness),
    duration: 0.5 + 0.35 * closeness,
    push: lerp(0.3, 1.6, closeness),
    roll: sign * Math.round(1 + closeness * (0.4 + b)) * TWO_PI,
    pitch: (b < 0.5 ? -1 : 1) * (closeness > 0.55 ? TWO_PI : 0),
  };
}

export interface LaunchOffset {
  /** Altura sobre la posición lógica. */
  y: number;
  /** Desplazamiento radial transitorio. */
  push: number;
  roll: number;
  pitch: number;
}

/** Desplazamiento visual a los `t` segundos del lanzamiento; empieza y termina con y = 0 y push = 0. */
export function launchOffset(profile: LaunchProfile, t: number): LaunchOffset {
  const k = clamp01(t / profile.duration);
  const ease = k * k * (3 - 2 * k);
  return { y: 4 * profile.height * k * (1 - k), push: profile.push * Math.sin(Math.PI * k), roll: profile.roll * ease, pitch: profile.pitch * ease };
}

export interface Launch {
  profile: LaunchProfile;
  startedAt: number;
  /** Dirección radial unitaria, alejándose del centro. */
  dirX: number;
  dirZ: number;
}

/** Estados del lanzamiento de cada unidad por id; una nueva explosión reinicia el vuelo con la nueva fuerza. */
export class AirborneTracker {
  private readonly launches = new Map<number, Launch>();

  get size(): number {
    return this.launches.size;
  }

  /** Registra un lanzamiento; false si se ignoró por el tope de unidades a la vez. */
  launch(id: number, profile: LaunchProfile, dirX: number, dirZ: number, now: number): boolean {
    this.prune(now);
    if (!this.launches.has(id) && this.launches.size >= MAX_AIRBORNE) return false;
    this.launches.set(id, { profile, startedAt: now, dirX, dirZ });
    return true;
  }

  get(id: number): Launch | undefined {
    return this.launches.get(id);
  }

  /** Quita los vuelos terminados (con su recuperación). */
  prune(now: number): void {
    for (const [id, l] of this.launches) if (now - l.startedAt > l.profile.duration + LAND_RECOVER_S) this.launches.delete(id);
  }

  /** Cuántas unidades están en el aire en este instante. */
  active(now: number): number {
    let n = 0;
    for (const l of this.launches.values()) if (now - l.startedAt < l.profile.duration) n++;
    return n;
  }

  clear(): void {
    this.launches.clear();
  }
}
