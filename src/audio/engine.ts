import type { CueRequest, FireLoop } from "./cues";
import { VoiceGate, type CueId } from "./voices";
import { DEFAULT_SETTINGS, saveSettings, type AudioSettings } from "./settings";
import type { MusicTrack } from "./music";
import { buildSfxBank, type SfxBank } from "./sfx";

/** Subconjunto de la Web Audio API que usa el motor; permite probarlo con un contexto falso. */
export interface ParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(value: number, time: number, timeConstant: number): unknown;
  cancelScheduledValues(time: number): unknown;
}
export interface NodeLike {
  connect(destination: unknown): unknown;
  disconnect(): void;
}
export interface GainLike extends NodeLike {
  gain: ParamLike;
}
export interface PannerLike extends NodeLike {
  pan: ParamLike;
}
export interface BufferLike {
  readonly duration: number;
  getChannelData(channel: number): Float32Array;
}
export interface SourceLike extends NodeLike {
  buffer: BufferLike | null;
  loop: boolean;
  playbackRate: ParamLike;
  onended: ((event: unknown) => unknown) | null;
  start(when?: number): void;
  stop(when?: number): void;
}
export interface ContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  createGain(): GainLike;
  createStereoPanner(): PannerLike;
  createBufferSource(): SourceLike;
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike;
  createDynamicsCompressor(): NodeLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
}

export type AudioStatus = "activo" | "bloqueado" | "silenciado" | "no disponible";
export type MusicStatus = "desactivada" | "pendiente" | "lista" | "fallida";

export const SFX_LEVEL = 0.8;
export const MUSIC_LEVEL = 0.22;
export const MUSIC_FADE_IN = 3;
/** Fracción del nivel musical durante la fanfarria y al terminar la partida. */
export const JINGLE_DUCK = 0.1;
export const AFTER_END_LEVEL = 0.3;
const FIRE_FADE = 0.2;
const FIRE_FADE_FAST = 0.1;

export interface EngineOptions {
  /** Devuelve un contexto nuevo o lanza si no hay Web Audio. */
  createContext?: () => ContextLike;
  settings?: AudioSettings;
  /** Genera la música en segundo plano. */
  loadMusic?: () => Promise<MusicTrack>;
  /** Fuente de los efectos; por defecto la síntesis de `sfx.ts`. */
  buildBank?: () => SfxBank;
  store?: Parameters<typeof saveSettings>[1];
}

interface Playing {
  source: SourceLike;
  nodes: NodeLike[];
}

interface FireVoice {
  source: SourceLike;
  gain: GainLike;
  pan: PannerLike;
}

function defaultContext(): ContextLike {
  const Ctor = (globalThis as { AudioContext?: new () => unknown }).AudioContext;
  if (!Ctor) throw new Error("AudioContext no disponible");
  return new Ctor() as ContextLike;
}

/** Motor de audio sobre Web Audio: desbloqueo, cadena maestra, voces, bucles de fuego y música. */
export class AudioEngine {
  settings: AudioSettings;
  private ctx: ContextLike | null = null;
  private unavailable = false;
  private bank: SfxBank | null = null;
  private buffers = new Map<CueId, BufferLike[]>();
  private gate: VoiceGate | null = null;
  private sfxBus: GainLike | null = null;
  private musicBus: GainLike | null = null;
  private master: GainLike | null = null;
  private playing = new Map<number, Playing>();
  private fire = new Map<number, FireVoice>();
  private musicLevel = 1;
  private suspended = false;
  private musicState: MusicStatus = "desactivada";
  private musicStarted = false;
  private unlocking: Promise<void> | null = null;
  dropped = 0;

  constructor(private readonly options: EngineOptions = {}) {
    this.settings = { ...(options.settings ?? DEFAULT_SETTINGS) };
    if (!options.createContext && !(globalThis as { AudioContext?: unknown }).AudioContext) this.unavailable = true;
  }

  get status(): AudioStatus {
    if (this.unavailable) return "no disponible";
    if (!this.ctx || !this.bank) return "bloqueado";
    return this.settings.muted ? "silenciado" : "activo";
  }

  get unlocked(): boolean {
    return this.ctx !== null && this.bank !== null && !this.unavailable;
  }

  get music(): MusicStatus {
    return this.musicState;
  }

  get activeVoices(): number {
    return this.gate?.stats().active ?? 0;
  }

  get droppedVoices(): number {
    return (this.gate?.dropped ?? 0) + this.dropped;
  }

  get fireLoops(): number {
    return this.fire.size;
  }

  /** Crea y reanuda el contexto con el primer gesto del usuario; es idempotente. */
  unlock(): Promise<void> {
    if (this.unavailable) return Promise.resolve();
    if (this.unlocking) return this.unlocking;
    this.unlocking = this.doUnlock();
    return this.unlocking;
  }

  private async doUnlock(): Promise<void> {
    try {
      const ctx = (this.options.createContext ?? defaultContext)();
      this.master = ctx.createGain();
      const compressor = ctx.createDynamicsCompressor();
      this.sfxBus = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.sfxBus.connect(compressor);
      this.musicBus.connect(this.master);
      compressor.connect(this.master);
      this.master.connect(ctx.destination);
      this.sfxBus.gain.value = SFX_LEVEL;
      this.musicBus.gain.value = MUSIC_LEVEL;
      this.master.gain.value = 1;
      this.ctx = ctx;
      await ctx.resume().catch(() => undefined);

      this.bank = (this.options.buildBank ?? buildSfxBank)();
      for (const [cue, bank] of Object.entries(this.bank) as [CueId, SfxBank[CueId]][]) {
        this.buffers.set(
          cue,
          bank.variants.map((data) => {
            const buffer = ctx.createBuffer(1, data.length, bank.sampleRate);
            buffer.getChannelData(0).set(data);
            return buffer;
          }),
        );
      }
      this.gate = new VoiceGate(() => ctx.currentTime, (id) => this.stopVoice(id));
      this.applySettings();
      if (this.suspended) await ctx.suspend();
      this.startMusicLoad();
    } catch {
      this.unavailable = true;
      this.ctx = null;
    }
  }

  private startMusicLoad(): void {
    const load = this.options.loadMusic;
    if (!load || this.musicStarted) return;
    this.musicStarted = true;
    this.musicState = "pendiente";
    load().then(
      (track) => this.installMusic(track),
      () => {
        this.musicState = "fallida";
      },
    );
  }

  private installMusic(track: MusicTrack): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    try {
      const buffer = ctx.createBuffer(2, track.left.length, track.sampleRate);
      buffer.getChannelData(0).set(track.left);
      buffer.getChannelData(1).set(track.right);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const fade = ctx.createGain();
      fade.gain.setValueAtTime(0, ctx.currentTime);
      fade.gain.linearRampToValueAtTime(1, ctx.currentTime + MUSIC_FADE_IN);
      source.connect(fade);
      fade.connect(this.musicBus);
      source.start();
      this.musicState = "lista";
    } catch {
      this.musicState = "fallida";
    }
  }

  /** Reproduce una solicitud; descarta en silencio si el audio no puede sonar. */
  play(request: CueRequest): void {
    const ctx = this.ctx;
    if (!ctx || !this.gate || !this.sfxBus || !this.unlocked) return;
    if (this.settings.muted || !this.settings.sfx) return;
    const variants = this.buffers.get(request.cue);
    const buffer = variants?.[request.variant % (variants?.length ?? 1)];
    if (!buffer) return;
    const duration = buffer.duration / request.rate;
    const id = this.gate.acquire(request.cue, duration, request.delay);
    if (id === null) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = request.rate;
    const gain = ctx.createGain();
    gain.gain.value = request.gain;
    const nodes: NodeLike[] = [gain];
    source.connect(gain);
    if (request.pan !== 0) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = request.pan;
      gain.connect(pan);
      pan.connect(this.sfxBus);
      nodes.push(pan);
    } else {
      gain.connect(this.sfxBus);
    }
    source.onended = () => {
      this.playing.delete(id);
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };
    const start = ctx.currentTime + request.delay;
    source.start(start);
    this.playing.set(id, { source, nodes });

    if (request.cue === "victory" || request.cue === "defeat") this.duckMusic(start, duration);
  }

  private duckMusic(start: number, duration: number): void {
    const bus = this.musicBus;
    if (!bus) return;
    const base = MUSIC_LEVEL;
    bus.gain.setTargetAtTime(base * JINGLE_DUCK, start, 0.1);
    bus.gain.setTargetAtTime(base * AFTER_END_LEVEL, start + duration, 0.3);
    this.musicLevel = AFTER_END_LEVEL;
  }

  private stopVoice(id: number): void {
    const voice = this.playing.get(id);
    if (!voice) return;
    this.playing.delete(id);
    try {
      voice.source.stop();
    } catch {
      // Ya detenida.
    }
    voice.source.disconnect();
    for (const node of voice.nodes) node.disconnect();
  }

  /** Alinea los bucles de fuego con los deseados; `fast` acorta el fundido de salida (edificio derrumbado). */
  syncFire(loops: readonly FireLoop[], fast: ReadonlySet<number> = new Set()): void {
    const ctx = this.ctx;
    const fireBuffer = this.buffers.get("fire")?.[0];
    const muted = !this.unlocked || this.settings.muted || !this.settings.sfx || !fireBuffer || !this.sfxBus;
    const wanted = new Map<number, FireLoop>();
    if (!muted) for (const loop of loops) wanted.set(loop.id, loop);

    for (const [id, voice] of this.fire) {
      if (wanted.has(id)) continue;
      this.fire.delete(id);
      this.fadeOut(voice, fast.has(id) ? FIRE_FADE_FAST : FIRE_FADE);
    }
    if (muted || !ctx || !fireBuffer || !this.sfxBus) return;

    for (const loop of wanted.values()) {
      const existing = this.fire.get(loop.id);
      if (existing) {
        existing.gain.gain.setTargetAtTime(loop.gain, ctx.currentTime, 0.05);
        existing.pan.pan.setTargetAtTime(loop.pan, ctx.currentTime, 0.05);
        continue;
      }
      const source = ctx.createBufferSource();
      source.buffer = fireBuffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(loop.gain, ctx.currentTime + FIRE_FADE);
      const pan = ctx.createStereoPanner();
      pan.pan.value = loop.pan;
      source.connect(gain);
      gain.connect(pan);
      pan.connect(this.sfxBus);
      source.start(ctx.currentTime);
      this.fire.set(loop.id, { source, gain, pan });
    }
  }

  private fadeOut(voice: FireVoice, seconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, seconds / 3);
    try {
      voice.source.stop(now + seconds + 0.05);
    } catch {
      // Ya detenida.
    }
    voice.source.onended = () => {
      voice.source.disconnect();
      voice.gain.disconnect();
      voice.pan.disconnect();
    };
  }

  /** Reinicio de partida: corta efectos y fuego, vacía las voces y restaura el nivel de música; la música sigue. */
  reset(): void {
    for (const id of [...this.playing.keys()]) this.stopVoice(id);
    for (const [id, voice] of this.fire) {
      this.fire.delete(id);
      this.fadeOut(voice, FIRE_FADE_FAST);
    }
    this.gate?.reset();
    this.musicLevel = 1;
    const ctx = this.ctx;
    if (ctx && this.musicBus) {
      this.musicBus.gain.cancelScheduledValues(ctx.currentTime);
      this.musicBus.gain.setTargetAtTime(this.musicTarget(), ctx.currentTime, 0.1);
    }
  }

  /** Suspende o reanuda el contexto con la pausa del juego. */
  setPaused(paused: boolean): void {
    this.suspended = paused;
    const ctx = this.ctx;
    if (!ctx) return;
    void (paused ? ctx.suspend() : ctx.resume()).catch(() => undefined);
  }

  setMusic(on: boolean): void {
    this.settings.music = on;
    this.persist();
  }

  setSfx(on: boolean): void {
    this.settings.sfx = on;
    this.persist();
  }

  toggleMuted(): boolean {
    this.settings.muted = !this.settings.muted;
    this.persist();
    return this.settings.muted;
  }

  private persist(): void {
    saveSettings(this.settings, this.options.store);
    this.applySettings();
  }

  private musicTarget(): number {
    return this.settings.music && !this.settings.muted ? MUSIC_LEVEL * this.musicLevel : 0;
  }

  /** Aplica el estado de silenciado y de los botones con rampas cortas contra clics. */
  private applySettings(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.sfxBus || !this.musicBus) return;
    const t = ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 1, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx ? SFX_LEVEL : 0, t, 0.03);
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(this.musicTarget(), t, 0.03);
    if (!this.settings.sfx || this.settings.muted) this.syncFire([]);
  }
}
