import { BALANCE } from "../content/balance";
import { flameCount } from "../rendering/health";
import type { BuildingDestroyedEvent, DeathEvent, GameState, SpawnEvent, StrikeEvent, WorkEvent } from "../core/types";
import { createRng, type Rng } from "./dsp";
import { CUES, PLAYER_ONLY_CUES, type CueId } from "./voices";

export type Projector = (x: number, z: number) => { x: number; y: number };

export interface CueRequest {
  cue: CueId;
  variant: number;
  /** −0,7 a 0,7. */
  pan: number;
  gain: number;
  /** Multiplicador de `playbackRate`. */
  rate: number;
  /** Segundos de espera en el reloj de audio. */
  delay: number;
}

type Seq<T> = T & { seq: number };

/** Los eventos llegan con identificador creciente; el traductor solo consume los nuevos. */
export interface AudioFrame {
  state: GameState;
  strikes: readonly (StrikeEvent & { id: number })[];
  deaths: readonly Seq<DeathEvent>[];
  spawns: readonly Seq<SpawnEvent>[];
  works: readonly Seq<WorkEvent>[];
  destroyed: readonly Seq<BuildingDestroyedEvent>[];
  project: Projector;
}

export interface FireLoop {
  id: number;
  level: number;
  pan: number;
  gain: number;
}

/** Margen (coordenadas normalizadas) que absorbe la altura de los modelos. */
export const VISIBLE_LIMIT = 1.05;
/** Segundos entre las flechas de una salva del centro urbano. */
export const SALVO_GAP = 0.5;
/** Segundos entre el fin de la partida y el sonido de resultado. */
export const END_DELAY = 1;
export const MAX_FIRE_LOOPS = 3;

export const onScreen = (p: { x: number; y: number }): boolean => Math.abs(p.x) <= VISIBLE_LIMIT && Math.abs(p.y) <= VISIBLE_LIMIT;
export const panOf = (p: { x: number }): number => Math.max(-0.7, Math.min(0.7, p.x * 0.7));
export const attenuationOf = (p: { x: number; y: number }): number => 1 - 0.3 * Math.min(1, Math.hypot(p.x, p.y) / Math.SQRT2);

/** Los cues del bando 0 únicamente; el resto suena para ambos bandos. */
export const audibleFor = (cue: CueId, owner: 0 | 1): boolean => !PLAYER_ONLY_CUES.includes(cue) || owner === 0;

const FIXED_RATE: readonly CueId[] = ["bell", "victory", "defeat"];
const NON_SPATIAL: readonly CueId[] = ["bell", "victory", "defeat"];
const WORK_CUE = { build: "hammer", wood: "axe", stone: "pick", food: "forage" } as const;

/** Traduce los eventos de la simulación en solicitudes de sonido; sin Web Audio. */
export class CueTranslator {
  private rng: Rng;
  private cursors = { strike: 0, death: 0, spawn: 0, work: 0, destroyed: 0 };
  private endTick: number | null = null;

  constructor(private readonly seed = 1) {
    this.rng = createRng(seed);
  }

  /** Reinicia cursores y estado del fin de partida (nueva sesión). */
  reset(): void {
    this.cursors = { strike: 0, death: 0, spawn: 0, work: 0, destroyed: 0 };
    this.endTick = null;
    this.rng = createRng(this.seed);
  }

  /** Consume siempre todos los eventos nuevos, aunque el audio no pueda sonar después. */
  process(frame: AudioFrame): CueRequest[] {
    const out: CueRequest[] = [];
    const { project } = frame;

    const emit = (cue: CueId, p: { x: number; z: number } | null, variant: number, delay = 0): void => {
      const spec = CUES[cue];
      let pan = 0;
      let gain = spec.gain;
      if (p && !NON_SPATIAL.includes(cue)) {
        const ndc = project(p.x, p.z);
        pan = panOf(ndc);
        gain *= attenuationOf(ndc);
      }
      let rate = 1;
      if (!FIXED_RATE.includes(cue)) {
        rate = 1 + this.rng.range(-0.06, 0.06);
        gain *= Math.pow(10, this.rng.range(-1, 1) / 20);
      }
      out.push({ cue, variant, pan, gain, rate, delay });
    };
    const visible = (p: { x: number; z: number }): boolean => onScreen(project(p.x, p.z));

    // Ataques: la campana no depende de la vista; el efecto de combate sí.
    let bell = false;
    const salvos = new Map<string, { index: number; base: number; visible: boolean }>();
    for (const s of frame.strikes) {
      if (s.id <= this.cursors.strike) continue;
      if (s.attackerOwner !== 0 && s.targetOwner === 0) bell = true;
      if (s.attackerKind === "tower") {
        const key = `${s.attackerId}:${s.tick}`;
        let salvo = salvos.get(key);
        if (!salvo) {
          salvo = { index: 0, base: this.rng.int(CUES.arrow.variants), visible: visible(s.from) };
          salvos.set(key, salvo);
        }
        if (salvo.visible) emit("arrow", s.from, (salvo.base + salvo.index) % CUES.arrow.variants, salvo.index * SALVO_GAP);
        salvo.index += 1;
        continue;
      }
      if (!visible(s.from)) continue;
      const cue: CueId = s.attackerKind === "soldier" ? "sword" : s.attackerKind === "archer" ? "arrow" : "blow";
      emit(cue, s.from, this.rng.int(CUES[cue].variants));
    }
    if (frame.strikes.length > 0) this.cursors.strike = Math.max(this.cursors.strike, frame.strikes[frame.strikes.length - 1]!.id);
    if (bell) emit("bell", null, 0);

    for (const d of frame.deaths) {
      if (d.seq <= this.cursors.death) continue;
      if (visible(d.pos)) emit("death", d.pos, (d.kind === "villager" ? 0 : 2) + this.rng.int(2));
    }
    this.cursors.death = lastSeq(frame.deaths, this.cursors.death);

    for (const sp of frame.spawns) {
      if (sp.seq <= this.cursors.spawn) continue;
      if (!audibleFor("door", sp.owner)) continue;
      const b = frame.state.buildings.find((x) => x.id === sp.buildingId);
      const at = b ? buildingCenter(b.cell, BALANCE.buildings[b.kind].footprint) : sp.pos;
      if (visible(at)) emit("door", at, 0);
    }
    this.cursors.spawn = lastSeq(frame.spawns, this.cursors.spawn);

    for (const w of frame.works) {
      if (w.seq <= this.cursors.work) continue;
      const cue: CueId = WORK_CUE[w.kind];
      if (visible(w.pos)) emit(cue, w.pos, this.rng.int(CUES[cue].variants));
    }
    this.cursors.work = lastSeq(frame.works, this.cursors.work);

    for (const e of frame.destroyed) {
      if (e.seq <= this.cursors.destroyed) continue;
      const footprint = BALANCE.buildings[e.kind].footprint;
      const at = buildingCenter(e.cell, footprint);
      const big = e.complete && (e.kind === "barracks" || e.kind === "townCenter");
      if (visible(at)) emit("collapse", at, big ? 1 : 0);
    }
    this.cursors.destroyed = lastSeq(frame.destroyed, this.cursors.destroyed);

    const { state } = frame;
    if (state.matchStatus === "ended" && state.outcome && state.outcome.endTick !== this.endTick) {
      this.endTick = state.outcome.endTick;
      emit(state.outcome.winner === 0 ? "victory" : "defeat", null, 0, END_DELAY);
    }
    return out;
  }
}

function lastSeq(events: readonly { seq: number }[], previous: number): number {
  return events.length > 0 ? Math.max(previous, events[events.length - 1]!.seq) : previous;
}

export const buildingCenter = (cell: { x: number; z: number }, footprint: number): { x: number; z: number } => ({
  x: cell.x + footprint / 2,
  z: cell.z + footprint / 2,
});

/** Bucles de fuego deseados: edificios de ambos bandos que arden, en pantalla; los 3 más cercanos al centro. */
export function computeFire(state: GameState, project: Projector): FireLoop[] {
  const found: { loop: FireLoop; distance: number }[] = [];
  for (const b of state.buildings) {
    const def = BALANCE.buildings[b.kind];
    const level = flameCount(b.hp, def.hp, b.complete);
    if (level === 0) continue;
    const c = buildingCenter(b.cell, def.footprint);
    const ndc = project(c.x, c.z);
    if (!onScreen(ndc)) continue;
    found.push({
      loop: { id: b.id, level, pan: panOf(ndc), gain: (CUES.fire.gain + (level - 1) * 0.0875) * attenuationOf(ndc) },
      distance: Math.hypot(ndc.x, ndc.y),
    });
  }
  found.sort((a, b) => a.distance - b.distance || a.loop.id - b.loop.id);
  return found.slice(0, MAX_FIRE_LOOPS).map((f) => f.loop);
}
