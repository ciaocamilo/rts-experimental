import type { AIDirector } from "../ai-client/director";
import type { WorkerAIProvider } from "../ai-client/provider";
import { PROTOCOL_VERSION } from "../ai-client/protocol";
import type { GameSession } from "../app/session";
import { BALANCE_VERSION, GAME_VERSION, MAP_VERSION } from "../content/versions";
import { hashState } from "../core/hash";
import type { PerfRecorder, PerfSummary } from "./recorder";

export const REPORT_SCHEMA = "rts-diagnostics-1";

/** Entorno de ejecución: solo datos técnicos necesarios para interpretar las mediciones. */
export interface EnvInfo {
  userAgent: string;
  gpu: string;
  viewport: string;
  devicePixelRatio: number;
  renderScale: number;
}

export interface ReportInput {
  session: GameSession;
  perf: PerfRecorder;
  fixture: string | null;
  env: EnvInfo;
  ai: { director: AIDirector; provider: WorkerAIProvider } | null;
  /** Errores no manejados capturados en la página. */
  errors: readonly string[];
}

export interface DiagnosticsReport {
  schema: typeof REPORT_SCHEMA;
  versions: Record<string, string | number | null>;
  seed: number;
  fixture: string | null;
  env: EnvInfo;
  match: { tick: number; status: string; outcome: unknown; stateHash: string; paused: boolean };
  entities: { units: [number, number]; buildings: [number, number]; pathQueue: number };
  loop: { overloadEvents: number; discardedMs: number; errors: readonly string[] };
  perf: PerfSummary;
  ai: unknown;
  appliedCommands: unknown[];
}

/** Informe exportable (RF-12): sin identificadores personales ni red; las órdenes bastan para reproducir con `replayMatch`. */
export function buildReport(input: ReportInput): DiagnosticsReport {
  const { session, perf, ai } = input;
  const state = session.state;
  const countBy = <T extends { owner: 0 | 1 }>(items: readonly T[]): [number, number] => [
    items.filter((i) => i.owner === 0).length,
    items.filter((i) => i.owner === 1).length,
  ];
  const ready = ai?.provider.readyInfo ?? null;
  return {
    schema: REPORT_SCHEMA,
    versions: {
      game: GAME_VERSION,
      map: MAP_VERSION,
      balance: BALANCE_VERSION,
      schema: state.schemaVersion,
      contract: PROTOCOL_VERSION,
      policy: ready?.versions.policy ?? null,
      pyodide: ready?.versions.pyodide ?? null,
      python: ready?.versions.python ?? null,
    },
    seed: state.seed,
    fixture: input.fixture,
    env: input.env,
    match: { tick: state.tick, status: state.matchStatus, outcome: state.outcome, stateHash: hashState(state), paused: session.paused },
    entities: { units: countBy(state.units), buildings: countBy(state.buildings), pathQueue: state.pathQueue.length },
    loop: { overloadEvents: session.overloadEvents, discardedMs: Math.round(session.discardedMs), errors: input.errors },
    perf: perf.summary(),
    ai: ai
      ? {
          status: ai.director.status,
          message: ai.director.message,
          sessionId: ai.provider.sessionId,
          workerGeneration: ai.provider.generation,
          loadMs: ready?.timings_ms ?? null,
          requestsSent: ai.director.requestsSent,
          decisionsApplied: ai.director.decisionsApplied,
          decisionsDiscarded: ai.director.decisionsDiscarded,
          discardedMessages: ai.provider.discardedMessages,
          latencyMsP95: ai.director.latencyP95,
          policyMsP95: ai.director.policyP95,
          log: ai.director.log,
          exchanges: ai.director.exchanges,
        }
      : null,
    appliedCommands: session.commandLog.map((entry) => ({
      appliedTick: entry.appliedTick,
      command: entry.command,
      accepted: entry.result.accepted,
      code: entry.result.accepted ? null : entry.result.code,
    })),
  };
}
