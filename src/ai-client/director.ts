import type { GameSession } from "../app/session";
import type { Command, PlayerId } from "../core/types";
import { buildObservation, toOrderResult } from "./observation";
import type { AIError, DecisionMessage, ObserveMessage, OrderResult, WireCommand } from "./protocol";
import type { ProviderState, WorkerAIProvider } from "./provider";

/** starting: inicializando · ok/degraded: operativa · failed: pausada, requiere recuperación · recovering/recovered: §8.2 punto 7. */
export type DirectorStatus = "idle" | "starting" | "ok" | "degraded" | "failed" | "recovering" | "recovered" | "stopped";

export interface AILogEntry {
  requestId: number;
  observationTick: number;
  appliedTick: number | null;
  commandId: string;
  type: WireCommand["type"];
  reasons: string[];
  outcome: "scheduled" | "accepted" | "rejected" | "discarded";
  code: string | null;
}

export interface AIExchange {
  observation: ObserveMessage;
  /** Respuesta aceptada, o null si la petición falló. */
  decision: DecisionMessage | null;
  error: string | null;
  latencyMs: number;
}

export interface DirectorOptions {
  playerId: PlayerId;
  /** Ticks activos entre consultas (§8.2, punto 1). */
  intervalTicks?: number;
  /** Antigüedad máxima de una decisión al admitirla (§8.2, punto 2). */
  maxAgeTicks?: number;
  /** Respuestas inválidas o caducadas consecutivas que pausan la partida (§8.2, punto 6). */
  maxConsecutiveFailures?: number;
  now?: () => number;
}

interface Flight {
  requestId: number;
  observation: ObserveMessage;
  controller: AbortController;
  mode: "normal" | "recovery";
  included: number;
  startedAt: number;
}

const LOG_LIMIT = 200;
const EXCHANGE_LIMIT = 40;
const LATENCY_WINDOW = 300;
const RESULT_LIMIT = 64;

/** Convierte un comando del contrato en una intención del núcleo. */
export function toCoreCommand(command: WireCommand): Pick<Command, "type" | "entityIds" | "target" | "kind"> {
  const entityIds = command.entity_ids;
  switch (command.type) {
    case "Move":
      return { type: "Move", entityIds, target: { x: command.payload.x, z: command.payload.z } };
    case "Stop":
    case "CancelBuild":
      return { type: command.type, entityIds };
    case "Gather":
    case "Attack":
    case "ResumeBuild":
      return { type: command.type, entityIds, target: { entityId: command.payload.target_id } };
    case "Build":
      return {
        type: "Build",
        entityIds,
        target: { x: command.payload.cell_x, z: command.payload.cell_z },
        kind: command.payload.building_kind,
      };
    case "Train":
      return { type: "Train", entityIds, kind: command.payload.unit_kind };
    case "CancelTraining":
      return { type: "CancelTraining", entityIds, target: { entityId: command.payload.queue_item_id } };
  }
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

/** Planifica consultas al proveedor sin bloquear el tick y aplica la política de fallos del SDD §8.2. */
export class AIDirector {
  status: DirectorStatus = "idle";
  message = "";
  failures = 0;
  readonly log: AILogEntry[] = [];
  readonly latenciesMs: number[] = [];
  readonly policyMs: number[] = [];
  /** Últimos intercambios completos, para exportar evidencia (RF-12). */
  readonly exchanges: AIExchange[] = [];
  requestsSent = 0;
  decisionsApplied = 0;
  decisionsDiscarded = 0;

  private requestSeq = 0;
  private flight: Flight | null = null;
  private nextDueTick = 0;
  private scanned = 0;
  private unreported: OrderResult[] = [];
  private readonly scheduled = new Map<string, AILogEntry>();
  private readonly seen = new Set<string>();
  private recoveryDone: ((ok: boolean) => void) | null = null;

  private readonly playerId: PlayerId;
  private readonly intervalTicks: number;
  private readonly maxAgeTicks: number;
  private readonly maxFailures: number;
  private readonly now: () => number;

  constructor(
    private readonly session: GameSession,
    private readonly provider: WorkerAIProvider,
    options: DirectorOptions,
  ) {
    this.playerId = options.playerId;
    this.intervalTicks = options.intervalTicks ?? 20;
    this.maxAgeTicks = options.maxAgeTicks ?? 10;
    this.maxFailures = options.maxConsecutiveFailures ?? 2;
    this.now = options.now ?? (() => performance.now());
    provider.onStateChange = (state, error) => this.onProviderState(state, error);
  }

  /** Crea el worker; la simulación sigue su curso mientras carga (§8.2, punto 10). */
  start(): void {
    this.status = "starting";
    this.message = "IA Python: inicializando…";
    void this.provider.launch().catch(() => undefined);
  }

  /** Se llama una vez por fotograma, después de avanzar la simulación. */
  update(): void {
    this.collectResults();
    if (this.status !== "ok" && this.status !== "degraded") return;
    if (this.session.paused || this.session.state.matchStatus === "ended") return;
    if (this.provider.state !== "ready" || this.flight) return;
    if (this.session.state.tick < this.nextDueTick) return;
    this.request("normal");
  }

  /** Pausa manual o pestaña oculta: invalida la petición pendiente y las decisiones no aplicadas. */
  suspend(): void {
    if (this.flight) {
      const flight = this.flight;
      this.flight = null;
      flight.controller.abort();
    }
    this.discardUnapplied("discarded", "SUSPENDED");
  }

  resume(): void {
    if (this.status === "failed" || this.status === "recovering" || this.status === "stopped") return;
    if (this.status === "recovered") {
      this.status = "ok";
      this.message = "IA Python: operativa";
      this.nextDueTick = this.session.state.tick + this.intervalTicks;
      return;
    }
    if (this.provider.state === "suspended") {
      this.status = "starting";
      this.message = "IA Python: reconstruyendo…";
      void this.provider.launch().catch(() => undefined);
      return;
    }
    this.nextDueTick = this.session.state.tick;
  }

  /** Recuperación manual: worker nuevo, snapshot actual con la simulación pausada y decisión válida (§8.2, punto 7). */
  recover(): Promise<boolean> {
    if (this.status !== "failed") return Promise.resolve(false);
    this.session.pause();
    this.status = "recovering";
    this.message = "IA Python: recuperando…";
    this.failures = 0;
    return new Promise<boolean>((resolve) => {
      this.recoveryDone = resolve;
      this.provider.launch().then(
        () => {
          if (this.status === "recovering") this.request("recovery");
        },
        () => undefined,
      );
    });
  }

  dispose(): void {
    this.suspend();
    this.status = "stopped";
    this.provider.onStateChange = null;
    this.provider.stop();
    this.finishRecovery(false);
  }

  get latencyP95(): number {
    return percentile(this.latenciesMs, 95);
  }

  get policyP95(): number {
    return percentile(this.policyMs, 95);
  }

  private request(mode: Flight["mode"]): void {
    const state = this.session.state;
    const requestId = ++this.requestSeq;
    const included = this.unreported.length;
    const observation = buildObservation(state, {
      sessionId: this.provider.sessionId,
      workerGeneration: this.provider.generation,
      requestId,
      playerId: this.playerId,
      previousResults: this.unreported.slice(0, RESULT_LIMIT),
    });
    const flight: Flight = {
      requestId,
      observation,
      controller: new AbortController(),
      mode,
      included: Math.min(included, RESULT_LIMIT),
      startedAt: this.now(),
    };
    this.flight = flight;
    this.nextDueTick = state.tick + this.intervalTicks;
    this.requestsSent += 1;
    this.provider.decide(observation, flight.controller.signal).then(
      (decision) => this.onDecision(flight, decision),
      (error: unknown) => this.onRejected(flight, error),
    );
  }

  private onDecision(flight: Flight, decision: DecisionMessage): void {
    if (this.flight !== flight) return;
    this.flight = null;
    const elapsed = this.now() - flight.startedAt;

    if (flight.mode === "normal") {
      const age = this.session.state.tick - flight.observation.observation_tick;
      if (age < 0 || age > this.maxAgeTicks) {
        this.decisionsDiscarded += 1;
        this.degrade(`decisión caducada (${age} ticks)`);
        return;
      }
    }

    this.latenciesMs.push(elapsed);
    this.policyMs.push(decision.metrics.policy_ms);
    this.pushExchange({ observation: flight.observation, decision, error: null, latencyMs: elapsed });
    if (this.latenciesMs.length > LATENCY_WINDOW) this.latenciesMs.shift();
    if (this.policyMs.length > LATENCY_WINDOW) this.policyMs.shift();

    this.unreported.splice(0, flight.included);
    this.schedule(decision);
    this.failures = 0;
    if (flight.mode === "recovery") {
      this.status = "recovered";
      this.message = "IA Python recuperada: pulse Reanudar";
      this.finishRecovery(true);
    } else {
      this.status = "ok";
      this.message = "IA Python: operativa";
    }
  }

  private onRejected(flight: Flight, error: unknown): void {
    if (this.flight !== flight) return;
    this.flight = null;
    this.decisionsDiscarded += 1;
    const message = error instanceof Error ? error.message : "respuesta inválida";
    this.pushExchange({ observation: flight.observation, decision: null, error: message, latencyMs: this.now() - flight.startedAt });
    if (flight.mode === "recovery") {
      this.stopAfterFailure(error instanceof Error ? error.message : "respuesta inválida durante la recuperación");
      return;
    }
    this.degrade(error instanceof Error ? error.message : "respuesta inválida");
  }

  /** Estructura inválida o respuesta caducada: se descarta; dos seguidas pausan y terminan el worker. */
  private degrade(reason: string): void {
    this.failures += 1;
    if (this.failures >= this.maxFailures) {
      this.stopAfterFailure(`${this.failures} fallos consecutivos: ${reason}`);
      return;
    }
    this.status = "degraded";
    this.message = `IA Python degradada: ${reason}`;
  }

  private stopAfterFailure(reason: string): void {
    this.provider.stop();
    this.enterFailed(reason);
  }

  private enterFailed(reason: string): void {
    this.flight = null;
    this.discardUnapplied("discarded", "WORKER_FAILED");
    this.status = "failed";
    this.message = `IA Python detenida: ${reason}`;
    this.session.pause();
    this.finishRecovery(false);
  }

  private onProviderState(state: ProviderState, error: AIError | null): void {
    if (state === "failed") {
      this.enterFailed(error ? `${error.code}: ${error.message}` : "fallo del worker");
      return;
    }
    if (state === "ready" && this.status === "starting") {
      this.status = "ok";
      this.message = "IA Python: operativa";
      this.nextDueTick = this.session.state.tick;
    }
  }

  private schedule(decision: DecisionMessage): void {
    for (const command of decision.commands) {
      const key = `${decision.worker_generation}:${decision.request_id}:${command.command_id}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);

      const entry: AILogEntry = {
        requestId: decision.request_id,
        observationTick: decision.observation_tick,
        appliedTick: null,
        commandId: command.command_id,
        type: command.type,
        reasons: decision.reason_codes,
        outcome: "scheduled",
        code: null,
      };
      this.pushLog(entry);

      const core = toCoreCommand(command);
      this.scheduled.set(command.command_id, entry);
      this.session.issue({ id: command.command_id, player: this.playerId, ...core });
    }
    this.decisionsApplied += 1;
  }

  /** Completa applied_tick y el resultado de las órdenes ya procesadas por el núcleo. */
  private collectResults(): void {
    const log = this.session.commandLog;
    for (; this.scanned < log.length; this.scanned++) {
      const applied = log[this.scanned]!;
      const entry = this.scheduled.get(applied.command.id);
      if (!entry) continue;
      this.scheduled.delete(applied.command.id);
      entry.appliedTick = applied.appliedTick;
      entry.outcome = applied.result.accepted ? "accepted" : "rejected";
      entry.code = applied.result.accepted ? null : applied.result.code;
      this.report(toOrderResult(applied.result));
    }
  }

  private report(result: OrderResult): void {
    this.unreported.push(result);
    if (this.unreported.length > RESULT_LIMIT) this.unreported.shift();
  }

  private discardUnapplied(outcome: AILogEntry["outcome"], code: string): void {
    this.collectResults();
    if (this.scheduled.size === 0) return;
    const ids = new Set(this.scheduled.keys());
    this.session.discardPending((command) => ids.has(command.id));
    for (const entry of this.scheduled.values()) {
      entry.outcome = outcome;
      entry.code = code;
    }
    this.scheduled.clear();
  }

  private pushLog(entry: AILogEntry): void {
    this.log.push(entry);
    if (this.log.length > LOG_LIMIT) this.log.shift();
  }

  private pushExchange(exchange: AIExchange): void {
    this.exchanges.push(exchange);
    if (this.exchanges.length > EXCHANGE_LIMIT) this.exchanges.shift();
  }

  private finishRecovery(ok: boolean): void {
    const done = this.recoveryDone;
    this.recoveryDone = null;
    done?.(ok);
  }
}
