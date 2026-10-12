/** Cues, prioridades y control de voces. Sin Web Audio: el reloj se inyecta para poder probarlo en Node. */

export type CueId =
  | "sword"
  | "arrow"
  | "arrowHit"
  | "blow"
  | "death"
  | "bell"
  | "hammer"
  | "axe"
  | "pick"
  | "forage"
  | "door"
  | "collapse"
  | "victory"
  | "defeat"
  | "fire"
  | "bird";

export interface CueSpec {
  readonly priority: number;
  /** Voces simultáneas del cue (bucles para `fire`). */
  readonly cap: number;
  /** Separación mínima entre dos inicios, en segundos. */
  readonly minGap: number;
  /** Ganancia relativa. */
  readonly gain: number;
  /** Variantes de timbre disponibles. */
  readonly variants: number;
  /** Envío a la reverberación de espacio (0 a 1). */
  readonly wet: number;
}

export const CUES: Readonly<Record<CueId, CueSpec>> = {
  bell: { priority: 5, cap: 1, minGap: 8, gain: 1, variants: 1, wet: 0.35 },
  victory: { priority: 6, cap: 1, minGap: 0, gain: 1, variants: 1, wet: 0.3 },
  defeat: { priority: 6, cap: 1, minGap: 0, gain: 1, variants: 1, wet: 0.3 },
  // Cuatro variantes: las pares son pequeñas y las impares grandes (ver `collapseVariant`).
  collapse: { priority: 4, cap: 3, minGap: 0.15, gain: 1, variants: 4, wet: 0.45 },
  // Tres variantes de aldeano (0 a 2), tres de militar (3 a 5) y tres de aldeana (6 a 8).
  death: { priority: 4, cap: 4, minGap: 0.09, gain: 0.9, variants: 9, wet: 0.25 },
  door: { priority: 3, cap: 3, minGap: 0.2, gain: 0.5, variants: 1, wet: 0.2 },
  sword: { priority: 2, cap: 8, minGap: 0.05, gain: 0.85, variants: 8, wet: 0.2 },
  arrow: { priority: 2, cap: 8, minGap: 0.05, gain: 0.8, variants: 6, wet: 0.2 },
  arrowHit: { priority: 2, cap: 6, minGap: 0.05, gain: 0.5, variants: 3, wet: 0.1 },
  blow: { priority: 2, cap: 4, minGap: 0.08, gain: 0.6, variants: 3, wet: 0.1 },
  hammer: { priority: 1, cap: 6, minGap: 0.08, gain: 0.6, variants: 6, wet: 0.08 },
  axe: { priority: 1, cap: 1, minGap: 0.3, gain: 0.5, variants: 4, wet: 0.05 },
  pick: { priority: 1, cap: 1, minGap: 0.3, gain: 0.5, variants: 4, wet: 0.05 },
  forage: { priority: 1, cap: 1, minGap: 0.3, gain: 0.35, variants: 2, wet: 0.05 },
  fire: { priority: 0, cap: 3, minGap: 0, gain: 0.2, variants: 1, wet: 0.1 },
  // Ambiente: cuatro especies (variante % 4) con tres variaciones cada una; los dispara `BirdScheduler`, no la simulación.
  bird: { priority: 0, cap: 3, minGap: 0.4, gain: 0.35, variants: 12, wet: 0.25 },
};

/** Únicos cues que no suenan para ambos bandos: la puerta y la campana. */
export const PLAYER_ONLY_CUES: readonly CueId[] = ["door", "bell"];

export const GLOBAL_VOICE_CAP = 24;

export interface VoiceGateStats {
  active: number;
  dropped: number;
}

interface Voice {
  id: number;
  cue: CueId;
  priority: number;
  start: number;
  end: number;
}

/**
 * Admite o descarta cada voz según los topes global y por cue y la separación mínima.
 * `now` es el reloj de audio, que no avanza con el contexto suspendido.
 */
export class VoiceGate {
  private voices: Voice[] = [];
  private lastStart = new Map<CueId, number>();
  private nextId = 1;
  dropped = 0;

  constructor(private readonly now: () => number, private readonly onSteal: (id: number) => void = () => undefined) {}

  /** Devuelve el id de la voz admitida o null si se descarta. `delay` programa el inicio en el futuro. */
  acquire(cue: CueId, duration: number, delay = 0): number | null {
    const now = this.now();
    this.voices = this.voices.filter((v) => v.end > now);
    const spec = CUES[cue];
    const start = now + delay;

    const last = this.lastStart.get(cue);
    if (last !== undefined && Math.abs(start - last) < spec.minGap) return this.drop();
    if (this.voices.filter((v) => v.cue === cue).length >= spec.cap) return this.drop();

    if (this.voices.length >= GLOBAL_VOICE_CAP) {
      let victim: Voice | null = null;
      for (const v of this.voices) {
        if (v.priority >= spec.priority) continue;
        if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.start < victim.start)) victim = v;
      }
      if (!victim) return this.drop();
      this.voices = this.voices.filter((v) => v !== victim);
      this.onSteal(victim.id);
    }

    const id = this.nextId++;
    this.voices.push({ id, cue, priority: spec.priority, start, end: start + duration });
    this.lastStart.set(cue, start);
    return id;
  }

  private drop(): null {
    this.dropped += 1;
    return null;
  }

  stats(): VoiceGateStats {
    const now = this.now();
    return { active: this.voices.filter((v) => v.end > now).length, dropped: this.dropped };
  }

  reset(): void {
    this.voices = [];
    this.lastStart.clear();
  }
}
