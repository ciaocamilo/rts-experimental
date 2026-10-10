import { FixedStepper } from "../core/fixed-step";
import type { Fixture } from "../core/fixtures";
import { createInitialState } from "../core/state";
import { stepSimulation } from "../core/simulation";
import type { Command, CommandResult, GameState } from "../core/types";

export interface AppliedCommand {
  /** Número de tick resultante del paso en que se procesó el comando. */
  appliedTick: number;
  command: Command;
  result: CommandResult;
}

/** Sesión de partida sin DOM ni render: estado, pausa, paso fijo y registro de comandos. */
export class GameSession {
  state: GameState;
  paused = false;
  overloadEvents = 0;
  discardedMs = 0;
  /** Recibe el coste real de cada tick (RNF-02); no influye en la lógica. */
  tickObserver: ((ms: number) => void) | null = null;
  readonly commandLog: AppliedCommand[] = [];

  private readonly stepper = new FixedStepper();
  private pending: Command[] = [];
  private seq = 0;

  constructor(readonly seed: number, fixture?: Fixture) {
    this.state = fixture ? fixture.state : createInitialState(seed);
    for (const command of fixture?.commands ?? []) {
      this.submit(command);
      this.seq = Math.max(this.seq, command.seq);
    }
  }

  /** Crea un comando con ID y secuencia propios y lo encola para el siguiente tick. */
  issue(partial: Pick<Command, "type" | "player" | "entityIds" | "target" | "kind"> & { id?: string }): string {
    this.seq += 1;
    const id = partial.id ?? `c${this.seq}`;
    this.submit({ ...partial, id, seq: this.seq, tick: this.state.tick });
    return id;
  }

  submit(command: Command): void {
    this.pending.push(command);
  }

  /** Descarta comandos que aún no se ejecutaron (p. ej. decisiones de IA invalidadas por una pausa). */
  discardPending(predicate: (command: Command) => boolean): number {
    const before = this.pending.length;
    this.pending = this.pending.filter((command) => !predicate(command));
    return before - this.pending.length;
  }

  /** Avanza el tiempo real; la simulación solo progresa si no está en pausa ni terminó. */
  advance(deltaMs: number): number {
    if (this.paused || this.state.matchStatus === "ended") return 0;
    const { steps, discardedMs } = this.stepper.advance(deltaMs);
    if (discardedMs > 0) {
      this.overloadEvents += 1;
      this.discardedMs += discardedMs;
    }
    for (let i = 0; i < steps; i++) this.stepOnce();
    return steps;
  }

  /** Un tick exacto, sin pasar por el reloj; útil para pruebas y reproducción. */
  stepOnce(): void {
    const commands = this.pending;
    this.pending = [];
    const started = this.tickObserver ? performance.now() : 0;
    const { tick, results } = stepSimulation(this.state, commands);
    this.tickObserver?.(performance.now() - started);
    for (const command of commands) {
      const result = results.find((r) => r.commandId === command.id);
      if (result) this.commandLog.push({ appliedTick: tick, command, result });
    }
  }

  pause(): void {
    this.paused = true;
  }

  /** La reanudación es explícita y no recupera el tiempo transcurrido en pausa. */
  resume(): void {
    this.stepper.reset();
    this.paused = false;
  }

  get alpha(): number {
    return this.stepper.alpha;
  }
}
