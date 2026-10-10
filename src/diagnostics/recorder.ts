/** Búfer circular de números: conserva las últimas `capacity` muestras sin desplazar el resto. */
export class Ring {
  private readonly data: Float64Array;
  private next = 0;
  private filled = 0;

  constructor(readonly capacity: number) {
    this.data = new Float64Array(capacity);
  }

  push(value: number): void {
    this.data[this.next] = value;
    this.next = (this.next + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled += 1;
  }

  get length(): number {
    return this.filled;
  }

  sorted(): number[] {
    return Array.from(this.data.slice(0, this.filled).sort());
  }
}

/** Percentil por rango superior sobre una lista ya ordenada. */
export function percentileOf(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

export interface PerfSummary {
  frames: number;
  /** Fotogramas con simulación en marcha; los de pausa se cuentan aparte para no inflar los FPS. */
  pausedFrames: number;
  pausedMs: number;
  activeMs: number;
  medianFps: number;
  frameMsP95: number;
  frameMsMax: number;
  ticks: number;
  tickMsP50: number;
  tickMsP95: number;
  tickMsMax: number;
  maxPathQueue: number;
  maxUnits: number;
}

const WINDOW = 24_000;

/** Acumula tiempos de fotograma y de tick para RNF-01 y RNF-02. */
export class PerfRecorder {
  private readonly frameMs = new Ring(WINDOW);
  private readonly tickMs = new Ring(WINDOW);
  private frames = 0;
  private pausedFrames = 0;
  private pausedMs = 0;
  private activeMs = 0;
  private frameMax = 0;
  private tickMax = 0;
  private ticks = 0;
  private maxPathQueue = 0;
  private maxUnits = 0;

  recordFrame(deltaMs: number, paused: boolean): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    this.frames += 1;
    if (paused) {
      this.pausedFrames += 1;
      this.pausedMs += deltaMs;
      return;
    }
    this.activeMs += deltaMs;
    this.frameMs.push(deltaMs);
    if (deltaMs > this.frameMax) this.frameMax = deltaMs;
  }

  recordTick(ms: number): void {
    this.ticks += 1;
    this.tickMs.push(ms);
    if (ms > this.tickMax) this.tickMax = ms;
  }

  observeLoad(pathQueue: number, units: number): void {
    if (pathQueue > this.maxPathQueue) this.maxPathQueue = pathQueue;
    if (units > this.maxUnits) this.maxUnits = units;
  }

  summary(): PerfSummary {
    const frames = this.frameMs.sorted();
    const ticks = this.tickMs.sorted();
    const median = percentileOf(frames, 50);
    return {
      frames: this.frames,
      pausedFrames: this.pausedFrames,
      pausedMs: Math.round(this.pausedMs),
      activeMs: Math.round(this.activeMs),
      medianFps: median > 0 ? 1000 / median : 0,
      frameMsP95: percentileOf(frames, 95),
      frameMsMax: this.frameMax,
      ticks: this.ticks,
      tickMsP50: percentileOf(ticks, 50),
      tickMsP95: percentileOf(ticks, 95),
      tickMsMax: this.tickMax,
      maxPathQueue: this.maxPathQueue,
      maxUnits: this.maxUnits,
    };
  }
}
