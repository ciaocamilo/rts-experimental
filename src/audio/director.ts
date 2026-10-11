import type { GameSession } from "../app/session";
import { CueTranslator, computeFire, type Projector } from "./cues";
import type { AudioEngine } from "./engine";

/** Une la sesión, la vista y el motor: el audio solo lee y nunca altera la partida. */
export class AudioDirector {
  private lastDestroyed = 0;

  constructor(
    readonly engine: AudioEngine,
    private readonly translator = new CueTranslator(),
  ) {}

  /** Una vez por cuadro: consume siempre los eventos nuevos, aunque el audio esté bloqueado o silenciado. */
  update(session: GameSession, project: Projector): void {
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
    this.lastDestroyed = 0;
    this.engine.reset();
  }
}
