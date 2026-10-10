import { MAX_CATCHUP_STEPS, TICK_MS } from "../content/balance";

export interface AdvanceResult {
  steps: number;
  /** Tiempo descartado por superar el límite de recuperación (sobrecarga). */
  discardedMs: number;
}

/** Acumulador de paso fijo: máximo 5 pasos por fotograma; el exceso se descarta, no se recupera. */
export class FixedStepper {
  private accumulatorMs = 0;

  advance(deltaMs: number): AdvanceResult {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) return { steps: 0, discardedMs: 0 };
    this.accumulatorMs += deltaMs;
    const available = Math.floor(this.accumulatorMs / TICK_MS);
    const steps = Math.min(available, MAX_CATCHUP_STEPS);
    this.accumulatorMs -= steps * TICK_MS;

    let discardedMs = 0;
    if (available > MAX_CATCHUP_STEPS) {
      discardedMs = this.accumulatorMs;
      this.accumulatorMs = 0;
    }
    return { steps, discardedMs };
  }

  /** Fracción [0,1) del siguiente tick, para interpolar el render. */
  get alpha(): number {
    return this.accumulatorMs / TICK_MS;
  }

  reset(): void {
    this.accumulatorMs = 0;
  }
}
