import type { GameSession } from "../app/session";
import { BirdScheduler } from "./ambient";
import { CueTranslator, computeFire, type CueRequest, type Projector } from "./cues";
import type { AudioEngine } from "./engine";
import type { CueId } from "./voices";

/** Cues cuya aparición en pantalla indica un combate visible: las aves callan un rato. */
const COMBAT_CUES: readonly CueId[] = ["sword", "arrow", "arrowHit", "blow", "death", "collapse"];

/** Une la sesión, la vista y el motor: el audio solo lee y nunca altera la partida. */
export class AudioDirector {
  private lastDestroyed = 0;
  /** Árboles decorativos donde pueden cantar las aves; los aporta la vista. */
  trees: () => readonly { x: number; z: number }[] = () => [];

  constructor(
    readonly engine: AudioEngine,
    private readonly translator = new CueTranslator(),
    private readonly birds = new BirdScheduler(),
  ) {}

  /** Una vez por cuadro: consume siempre los eventos nuevos, aunque el audio esté bloqueado o silenciado. `dt` son segundos de reloj de pared. */
  update(session: GameSession, project: Projector, dt = 0): void {
    const { state } = session;
    const requests = this.translator.process({
      state,
      strikes: session.strikeLog,
      deaths: session.deathLog,
      spawns: session.spawnLog,
      works: session.workLog,
      destroyed: session.destroyedLog,
      project,
    });
    for (const request of requests) this.engine.play(request);

    const { settings } = this.engine;
    const bird: CueRequest | null = this.birds.update({
      dt,
      active: state.matchStatus !== "ended" && !session.paused && settings.sfx && !settings.muted,
      combatVisible: requests.some((r) => COMBAT_CUES.includes(r.cue)),
      trees: this.trees(),
      project,
    });
    if (bird) this.engine.play(bird);

    // Un edificio destruido corta su fuego más rápido para dar paso al derrumbe.
    const fast = new Set<number>();
    for (const event of session.destroyedLog) {
      if (event.seq <= this.lastDestroyed) continue;
      fast.add(event.id);
      this.lastDestroyed = event.seq;
    }
    this.engine.syncFire(state.matchStatus === "ended" ? [] : computeFire(state, project), fast);
  }

  /** Nueva sesión: los contadores de eventos vuelven a empezar y se cortan efectos y fuego; la música sigue. */
  reset(): void {
    this.translator.reset();
    this.birds.reset();
    this.lastDestroyed = 0;
    this.engine.reset();
  }
}
