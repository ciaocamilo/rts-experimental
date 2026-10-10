/// <reference types="node" />
import { execFileSync } from "node:child_process";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPyodide } from "pyodide";
import fixtureFile from "../../contracts/worker-v2/fixtures.json";
import { AIDirector } from "../../src/ai-client/director";
import { buildObservation } from "../../src/ai-client/observation";
import { POLICY_VERSION, PYODIDE_VERSION, type DecisionMessage, type ObserveMessage } from "../../src/ai-client/protocol";
import { WorkerAIProvider, type WorkerLike } from "../../src/ai-client/provider";
import { GameSession } from "../../src/app/session";
import { WorkerHost, type PyodideLike } from "../../src/ai-worker/host";
import { POLICY_FILES } from "../../src/ai-worker/policy-bundle";
import { createInitialState } from "../../src/core/state";

const SESSION = "3f2b8c1e-5a7d-4e9b-8c3a-1d2e3f4a5b6c";
const ROOT = path.resolve(__dirname, "..", "..");

/** Worker en memoria que ejecuta el mismo `WorkerHost` del navegador sobre Pyodide real. */
class LoopbackWorker implements WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  terminated = false;
  private readonly host: WorkerHost;

  constructor(pyodide: PyodideLike) {
    this.host = new WorkerHost({
      post: (message) => {
        const data = structuredClone(message);
        setTimeout(() => this.onmessage?.({ data }), 0);
      },
      loadPyodide: async () => pyodide,
      files: POLICY_FILES,
      now: () => performance.now(),
    });
  }

  postMessage(message: unknown): void {
    const data = structuredClone(message);
    setTimeout(() => void this.host.handle(data), 0);
  }

  terminate(): void {
    this.terminated = true;
    this.onmessage = null;
  }
}

let pyodide: Awaited<ReturnType<typeof loadPyodide>>;
let loadMs = 0;

beforeAll(async () => {
  const started = performance.now();
  pyodide = await loadPyodide({ indexURL: path.join(ROOT, "node_modules", "pyodide") + path.sep });
  loadMs = performance.now() - started;
}, 120_000);

function newProvider(): { provider: WorkerAIProvider; workers: LoopbackWorker[] } {
  const workers: LoopbackWorker[] = [];
  const provider = new WorkerAIProvider({
    sessionId: SESSION,
    createWorker: () => {
      const worker = new LoopbackWorker(pyodide as unknown as PyodideLike);
      workers.push(worker);
      return worker;
    },
    decisionTimeoutMs: 5_000,
    initTimeoutMs: 60_000,
  });
  return { provider, workers };
}

function sampleObservation(requestId = 1): ObserveMessage {
  return buildObservation(createInitialState(1), {
    sessionId: SESSION,
    workerGeneration: 1,
    requestId,
    playerId: 1,
    previousResults: [],
  });
}

const stripMetrics = (decision: DecisionMessage): Omit<DecisionMessage, "metrics"> => {
  const { metrics: _metrics, ...rest } = decision;
  return rest;
};

describe("Pyodide real en Node (T-13, T-16 parcial, T-17 inicio)", () => {
  it("carga la política y publica READY con las versiones esperadas", async () => {
    const { provider, workers } = newProvider();
    const ready = await provider.launch();
    expect(ready.versions).toMatchObject({ pyodide: PYODIDE_VERSION, policy: POLICY_VERSION });
    expect(ready.versions.python.startsWith("3.12")).toBe(true);
    expect(provider.state).toBe("ready");
    expect(workers).toHaveLength(1);
    provider.stop();
    console.info(
      `[T-17 indicativo] loadPyodide en Node: ${loadMs.toFixed(0)} ms; ` +
        `READY.timings_ms: ${JSON.stringify(ready.timings_ms)}`,
    );
  }, 60_000);

  it("los fixtures compartidos dan el mismo resultado en Python dentro de Pyodide", async () => {
    const { provider } = newProvider();
    await provider.launch();
    pyodide.FS.writeFile("/tmp/fixtures.json", JSON.stringify(fixtureFile.cases));
    const raw = pyodide.runPython(`
import json
from policy import contract

SENTINELS = {"__NaN__": float("nan"), "__Infinity__": float("inf")}

def revive(value):
    if isinstance(value, str) and value in SENTINELS:
        return SENTINELS[value]
    if isinstance(value, list):
        return [revive(item) for item in value]
    if isinstance(value, dict):
        return {key: revive(item) for key, item in value.items()}
    return value

with open("/tmp/fixtures.json", encoding="utf-8") as handle:
    cases = json.load(handle)
out = []
for case in cases:
    code, _detail = contract.validate_message(revive(case["message"]))
    out.append([case["name"], code])
json.dumps(out)
`) as string;
    const results = JSON.parse(raw) as [string, string | null][];
    expect(results).toHaveLength(fixtureFile.cases.length);
    for (const [index, [name, code]] of results.entries()) {
      const expected = fixtureFile.cases[index]!;
      expect(name).toBe(expected.name);
      expect(code, name).toBe(expected.valid ? null : (expected as { code: string }).code);
    }
    provider.stop();
  }, 60_000);

  it("devuelve una decisión válida y determinista para la misma observación", async () => {
    const first = newProvider();
    const second = newProvider();
    await first.provider.launch();
    await second.provider.launch();
    const a = await first.provider.decide(sampleObservation());
    const b = await second.provider.decide(sampleObservation());
    expect(stripMetrics(a)).toEqual(stripMetrics(b));
    expect(a.commands.length).toBeGreaterThan(0);
    expect(a.commands[0]).toMatchObject({ command_id: "1:0", type: "Gather" });
    first.provider.stop();
    second.provider.stop();
  }, 60_000);

  it("coincide con la política ejecutada en CPython para la misma observación", async () => {
    const observation = sampleObservation();
    let cpython: string;
    try {
      cpython = execFileSync(
        "python",
        ["-c", "import sys\nfrom policy import entry\nsys.stdout.write(entry.handle_observe(sys.stdin.read()))"],
        { cwd: path.join(ROOT, "python"), input: JSON.stringify(observation), encoding: "utf-8" },
      );
    } catch (error) {
      console.warn(`[T-16 parcial] CPython no disponible, comparación omitida: ${String(error).split("\n")[0]}`);
      return;
    }
    const { provider } = newProvider();
    await provider.launch();
    const viaPyodide = await provider.decide(observation);
    provider.stop();
    const outcome = JSON.parse(cpython) as { ok: boolean; decision: DecisionMessage };
    expect(outcome.ok).toBe(true);
    expect(stripMetrics(viaPyodide)).toEqual(outcome.decision);
  }, 60_000);

  it("una excepción de la política llega como POLICY_ERROR fatal y se puede recuperar con otro worker", async () => {
    const { provider, workers } = newProvider();
    await provider.launch();
    pyodide.runPython("import policy.entry as e, policy.policy as p\n_orig = p.decide\np.decide = lambda o: 1 / 0");
    try {
      await expect(provider.decide(sampleObservation())).rejects.toMatchObject({ code: "POLICY_ERROR" });
      expect(provider.state).toBe("failed");
      expect(workers[0]!.terminated).toBe(true);
    } finally {
      pyodide.runPython("p.decide = _orig");
    }
    const relaunched = await provider.launch();
    expect(relaunched.worker_generation).toBe(2);
    const decision = await provider.decide({ ...sampleObservation(3), worker_generation: 2 });
    expect(decision.worker_generation).toBe(2);
    provider.stop();
  }, 60_000);

  it("integración completa: la IA pone a sus aldeanos a recolectar y entrena un aldeano", async () => {
    const session = new GameSession(1);
    const { provider } = newProvider();
    const director = new AIDirector(session, provider, { playerId: 1 });
    director.start();
    const waitFor = async (predicate: () => boolean, ms = 10_000): Promise<void> => {
      const limit = performance.now() + ms;
      while (!predicate()) {
        if (performance.now() > limit) throw new Error(`timeout esperando (estado ${director.status}: ${director.message})`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };
    await waitFor(() => director.status === "ok");
    director.update();
    await waitFor(() => provider.state === "ready");
    for (let i = 0; i < 100; i++) session.stepOnce();
    director.update();
    const types = director.log.map((entry) => entry.type);
    expect(types).toContain("Gather");
    expect(types).toContain("Train");
    expect(director.log.every((entry) => entry.outcome === "accepted")).toBe(true);
    const villagers = session.state.units.filter((u) => u.owner === 1 && u.kind === "villager");
    expect(villagers.every((u) => u.job?.type === "gather")).toBe(true);
    expect(session.state.buildings.find((b) => b.owner === 1 && b.kind === "townCenter")!.queue.length).toBeGreaterThan(0);
    expect(director.latencyP95).toBeGreaterThanOrEqual(0);
    console.info(
      `[T-17 indicativo] 1ª decisión: latencia p95 ${director.latencyP95.toFixed(1)} ms, política p95 ${director.policyP95.toFixed(1)} ms`,
    );
    director.dispose();
  }, 60_000);

  it("mide la latencia de 100 decisiones consecutivas (indicativo)", async () => {
    const { provider } = newProvider();
    await provider.launch();
    const latencies: number[] = [];
    const policy: number[] = [];
    for (let i = 1; i <= 100; i++) {
      const t0 = performance.now();
      const decision = await provider.decide(sampleObservation(i));
      latencies.push(performance.now() - t0);
      policy.push(decision.metrics.policy_ms);
    }
    const p95 = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
    console.info(
      `[T-17 indicativo] 100 decisiones (Node, Pyodide ${PYODIDE_VERSION}): ida y vuelta p95 ${p95(latencies).toFixed(1)} ms, política p95 ${p95(policy).toFixed(2)} ms`,
    );
    expect(provider.state).toBe("ready");
    provider.stop();
  }, 60_000);
});
