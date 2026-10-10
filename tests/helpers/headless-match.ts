/// <reference types="node" />
import path from "node:path";
import { loadPyodide } from "pyodide";
import { toCoreCommand } from "../../src/ai-client/director";
import { buildObservation, toOrderResult } from "../../src/ai-client/observation";
import type { DecisionMessage, OrderResult } from "../../src/ai-client/protocol";
import { checkDecisionSemantics, validateMessage } from "../../src/ai-client/validate";
import { POLICY_FILES } from "../../src/ai-worker/policy-bundle";
import { GameSession } from "../../src/app/session";
import { hashState } from "../../src/core/hash";
import { populationOf } from "../../src/core/state";
import type { Command, GameState, PlayerId } from "../../src/core/types";

const SESSION = "3f2b8c1e-5a7d-4e9b-8c3a-1d2e3f4a5b6c";
const ROOT = path.resolve(__dirname, "..", "..");
const POLICY_DIR = "/home/pyodide/rts_policy/policy";
const DECISION_TICKS = 20;

export interface PolicyRuntime {
  handle(observationJson: string): string;
}

/** Carga la política real de Python en Pyodide, igual que el worker del navegador. */
export async function loadPolicyRuntime(): Promise<PolicyRuntime> {
  const pyodide = await loadPyodide({ indexURL: path.join(ROOT, "node_modules", "pyodide") + path.sep });
  pyodide.FS.mkdirTree(POLICY_DIR);
  for (const [name, source] of Object.entries(POLICY_FILES)) pyodide.FS.writeFile(`${POLICY_DIR}/${name}`, source);
  pyodide.runPython("import sys\nif '/home/pyodide/rts_policy' not in sys.path:\n    sys.path.insert(0, '/home/pyodide/rts_policy')");
  pyodide.runPython("import policy.entry as _entry");
  return { handle: pyodide.runPython("_entry.handle_observe") as (text: string) => string };
}

export interface MatchOptions {
  seed: number;
  maxTicks: number;
  /** Jugadores gobernados por la política; el resto permanece pasivo. */
  ais: readonly PlayerId[];
  /** Modifica el estado inicial; debe aplicarse igual al reproducir. */
  setup?: (state: GameState) => void;
}

export interface MatchRun {
  session: GameSession;
  decisions: number;
  commandsByType: Record<string, number>;
  rejections: Record<string, number>;
  violations: string[];
  /** Primer tick en que cada jugador emitió una orden Attack. */
  firstAttackTick: Record<number, number | undefined>;
  /** Tick en que se aplicó la última orden de cada jugador, para comprobar la reproducción. */
  decisionLog: { tick: number; player: PlayerId; requestId: number; commands: DecisionMessage["commands"] }[];
  hash: string;
}

/** Partida sin navegador: consulta a la política cada 20 ticks y aplica sus órdenes en el tick siguiente. */
export function runMatch(runtime: PolicyRuntime, options: MatchOptions): MatchRun {
  const session = new GameSession(options.seed);
  options.setup?.(session.state);
  // Cada jugador numera sus peticiones en un rango propio para que los command_id no choquen.
  const requestIds: Record<number, number> = { 0: 0, 1: 100_000_000 };
  const unreported: Record<number, OrderResult[]> = { 0: [], 1: [] };
  const owner = new Map<string, PlayerId>();
  const run: MatchRun = {
    session,
    decisions: 0,
    commandsByType: {},
    rejections: {},
    violations: [],
    firstAttackTick: {},
    decisionLog: [],
    hash: "",
  };
  let scanned = 0;

  while (session.state.tick < options.maxTicks && session.state.matchStatus === "playing") {
    const tick = session.state.tick;
    if (tick % DECISION_TICKS === 0) {
      for (const player of options.ais) {
        const requestId = ++requestIds[player]!;
        const results = unreported[player]!.splice(0, 64);
        const observation = buildObservation(session.state, {
          sessionId: SESSION,
          workerGeneration: 1,
          requestId,
          playerId: player,
          previousResults: results,
        });
        const checked = validateMessage(observation);
        if (!checked.ok) run.violations.push(`observación inválida en ${tick}: ${checked.detail}`);
        const outcome = JSON.parse(runtime.handle(JSON.stringify(observation))) as { ok: boolean; decision?: DecisionMessage; message?: string };
        if (!outcome.ok || !outcome.decision) {
          run.violations.push(`política falló en ${tick}: ${outcome.message ?? "sin detalle"}`);
          continue;
        }
        const decision = outcome.decision;
        const wire = validateMessage({ ...decision, metrics: { policy_ms: 0, convert_ms: 0 } });
        if (!wire.ok) run.violations.push(`decisión inválida en ${tick}: ${wire.detail}`);
        const semantic = checkDecisionSemantics(decision);
        if (semantic) run.violations.push(`decisión incoherente en ${tick}: ${semantic}`);

        run.decisions += 1;
        run.decisionLog.push({ tick, player, requestId, commands: decision.commands });
        for (const command of decision.commands) {
          const id = command.command_id;
          owner.set(id, player);
          run.commandsByType[command.type] = (run.commandsByType[command.type] ?? 0) + 1;
          if (command.type === "Attack" && run.firstAttackTick[player] === undefined) run.firstAttackTick[player] = tick;
          session.issue({ id, player, ...toCoreCommand(command) });
        }
      }
    }

    session.stepOnce();
    for (; scanned < session.commandLog.length; scanned++) {
      const applied = session.commandLog[scanned]!;
      const player = owner.get(applied.command.id);
      if (player === undefined) continue;
      if (!applied.result.accepted) run.rejections[applied.result.code] = (run.rejections[applied.result.code] ?? 0) + 1;
      unreported[player]!.push(toOrderResult(applied.result));
    }

    for (const p of session.state.players) {
      if (p.food < 0 || p.wood < 0) run.violations.push(`recursos negativos de ${p.id} en ${session.state.tick}`);
      if (populationOf(session.state, p.id) > p.popCapacity) run.violations.push(`población sobre capacidad de ${p.id} en ${session.state.tick}`);
    }
  }

  run.hash = hashState(session.state);
  return run;
}

/** Reproduce una partida a partir del registro de comandos, sin política ni worker. */
export function replayMatch(seed: number, log: readonly { appliedTick: number; command: Command }[], ticks: number, setup?: (state: GameState) => void): string {
  const session = new GameSession(seed);
  setup?.(session.state);
  let next = 0;
  while (session.state.tick < ticks && session.state.matchStatus === "playing") {
    while (next < log.length && log[next]!.appliedTick === session.state.tick + 1) {
      session.submit(log[next]!.command);
      next += 1;
    }
    session.stepOnce();
  }
  return hashState(session.state);
}
