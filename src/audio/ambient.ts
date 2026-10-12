import { attenuationOf, lowpassOf, onScreen, panOf, type CueRequest, type Projector } from "./cues";
import { createRng, type Rng } from "./dsp";
import { CUES } from "./voices";

/** Segundos entre dos cantos cuando hay árboles a la vista; sin ellos se duplica. */
export const BIRD_MIN_INTERVAL = 3;
export const BIRD_MAX_INTERVAL = 11;
/** Silencio de las aves tras ver un combate. */
export const BIRD_COMBAT_SILENCE = 6;
/** Un cuadro largo (pestaña en segundo plano) no adelanta los cantos. */
export const BIRD_MAX_DT = 0.25;
/** Árboles que se proyectan como máximo al decidir de dónde canta el ave. */
export const BIRD_TREE_SAMPLE = 48;
/** Las aves lejanas suenan a la mitad, apagadas y más reverberadas. */
export const DISTANT_GAIN = 0.5;
export const DISTANT_LOWPASS = 6000;

export interface BirdInput {
  /** Segundos de reloj de pared desde el cuadro anterior. */
  dt: number;
  /** Partida en curso, sin pausa, con efectos y sonido activos. */
  active: boolean;
  /** Hubo un combate o derrumbe visible en este cuadro. */
  combatVisible: boolean;
  trees: readonly { x: number; z: number }[];
  project: Projector;
}

/**
 * Cantos de ave de ambiente (P7-H04): pequeños y aleatorios, nunca dependen de la simulación. El reloj y el azar se
 * inyectan para probarlo en Node; el azar es propio y no toca el de la partida.
 */
export class BirdScheduler {
  private wait: number;
  private silence = 0;
  private lastVariant = -1;

  constructor(private readonly rng: Rng = createRng(4242)) {
    this.wait = this.interval(true);
  }

  private interval(local: boolean): number {
    return this.rng.range(BIRD_MIN_INTERVAL, BIRD_MAX_INTERVAL) * (local ? 1 : 2);
  }

  reset(): void {
    this.silence = 0;
    this.lastVariant = -1;
    this.wait = this.interval(true);
  }

  /** Devuelve un canto cuando toca; en pausa, sin sonido o terminada la partida el reloj se detiene. */
  update(input: BirdInput): CueRequest | null {
    if (!input.active) return null;
    const dt = Math.min(BIRD_MAX_DT, Math.max(0, input.dt));
    if (input.combatVisible) this.silence = BIRD_COMBAT_SILENCE;
    if (this.silence > 0) {
      this.silence = Math.max(0, this.silence - dt);
      return null;
    }
    this.wait -= dt;
    if (this.wait > 0) return null;

    const spec = CUES.bird;
    let variant = this.rng.int(spec.variants);
    if (variant === this.lastVariant) variant = (variant + 1 + this.rng.int(spec.variants - 1)) % spec.variants;
    this.lastVariant = variant;
    const rate = 1 + this.rng.range(-0.05, 0.05);
    const jitter = Math.pow(10, this.rng.range(-1, 1) / 20);

    let spot: { x: number; y: number } | null = null;
    const count = input.trees.length;
    for (let i = 0; i < Math.min(BIRD_TREE_SAMPLE, count) && spot === null; i++) {
      const tree = input.trees[this.rng.int(count)]!;
      const ndc = input.project(tree.x, tree.z);
      if (onScreen(ndc)) spot = ndc;
    }
    this.wait = this.interval(spot !== null);

    if (spot) {
      return { cue: "bird", variant, pan: panOf(spot), gain: spec.gain * attenuationOf(spot) * jitter, rate, delay: 0, lowpass: lowpassOf(spot), wet: spec.wet };
    }
    return { cue: "bird", variant, pan: this.rng.range(-0.5, 0.5), gain: spec.gain * DISTANT_GAIN * jitter, rate, delay: 0, lowpass: DISTANT_LOWPASS, wet: Math.min(1, spec.wet + 0.15) };
  }
}
