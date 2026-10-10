import type {
  DecisionMessage,
  ErrorMessage,
  InitMessage,
  ObserveMessage,
  ReadyMessage,
  WireCommand,
} from "../../src/ai-client/protocol";
import { POLICY_VERSION, PYODIDE_VERSION } from "../../src/ai-client/protocol";
import type { WorkerLike } from "../../src/ai-client/provider";

/** Worker simulado: el test decide qué mensajes llegan y cuándo. */
export class FakeWorker implements WorkerLike {
  posted: unknown[] = [];
  terminated = false;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  private handler: ((event: { data: unknown }) => void) | null = null;
  private lastHandler: ((event: { data: unknown }) => void) | null = null;

  get onmessage(): ((event: { data: unknown }) => void) | null {
    return this.handler;
  }

  set onmessage(value: ((event: { data: unknown }) => void) | null) {
    this.handler = value;
    if (value) this.lastHandler = value;
  }

  postMessage(message: unknown): void {
    this.posted.push(structuredClone(message));
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    this.handler?.({ data });
  }

  /** Entrega un mensaje aunque el worker ya se haya terminado, como un evento ya encolado. */
  emitLate(data: unknown): void {
    this.lastHandler?.({ data });
  }

  get init(): InitMessage {
    return this.posted.find((m) => (m as { type: string }).type === "INIT") as InitMessage;
  }

  get observations(): ObserveMessage[] {
    return this.posted.filter((m) => (m as { type: string }).type === "OBSERVE") as ObserveMessage[];
  }

  get lastObservation(): ObserveMessage {
    const all = this.observations;
    return all[all.length - 1]!;
  }

  ready(overrides: Partial<ReadyMessage> = {}): void {
    this.emit(readyFor(this.init, overrides));
  }
}

export function readyFor(init: InitMessage, overrides: Partial<ReadyMessage> = {}): ReadyMessage {
  return {
    type: "READY",
    protocol_version: 2,
    session_id: init.session_id,
    worker_generation: init.worker_generation,
    versions: { pyodide: PYODIDE_VERSION, python: "3.12.7", policy: POLICY_VERSION },
    timings_ms: { pyodide_load: 10, policy_load: 1, total: 11 },
    ...overrides,
  };
}

export function moveCommand(requestId: number, index: number, entityIds: number[] = [6, 7, 8]): WireCommand {
  return { command_id: `${requestId}:${index}`, type: "Move", entity_ids: entityIds, payload: { x: 44.5, z: 32.5 } };
}

export function decisionFor(observation: ObserveMessage, overrides: Partial<DecisionMessage> = {}): DecisionMessage {
  return {
    type: "DECISION",
    protocol_version: 2,
    session_id: observation.session_id,
    worker_generation: observation.worker_generation,
    request_id: observation.request_id,
    observation_tick: observation.observation_tick,
    player_id: observation.player_id,
    policy_version: POLICY_VERSION,
    commands: [moveCommand(observation.request_id, 0)],
    reason_codes: ["RALLY_IDLE"],
    metrics: { policy_ms: 1, convert_ms: 0.1 },
    ...overrides,
  };
}

export function errorFor(observation: ObserveMessage, overrides: Partial<ErrorMessage> = {}): ErrorMessage {
  return {
    type: "ERROR",
    protocol_version: 2,
    session_id: observation.session_id,
    worker_generation: observation.worker_generation,
    request_id: observation.request_id,
    code: "POLICY_ERROR",
    message: "excepción en la política",
    ...overrides,
  };
}
