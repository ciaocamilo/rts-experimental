import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameSession } from "../../src/app/session";
import { AIDirector, toCoreCommand } from "../../src/ai-client/director";
import { WorkerAIProvider } from "../../src/ai-client/provider";
import { PROTOCOL_VERSION } from "../../src/ai-client/protocol";
import { FakeWorker, decisionFor, errorFor, moveCommand } from "../helpers/fake-worker";

const SESSION = "3f2b8c1e-5a7d-4e9b-8c3a-1d2e3f4a5b6c";
const OTHER_SESSION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function harness(options: { decisionTimeoutMs?: number; initTimeoutMs?: number } = {}) {
  const workers: FakeWorker[] = [];
  const session = new GameSession(1);
  const provider = new WorkerAIProvider({
    sessionId: SESSION,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    ...options,
  });
  const director = new AIDirector(session, provider, { playerId: 1 });
  return { workers, session, provider, director, current: () => workers[workers.length - 1]! };
}
type Harness = ReturnType<typeof harness>;

const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};
const stepTicks = (h: Harness, count: number): void => {
  for (let i = 0; i < count; i++) h.session.stepOnce();
};

async function startReady(h: Harness): Promise<void> {
  h.director.start();
  h.current().ready();
  await settle();
}

/** Pide una decisión y devuelve la observación enviada al worker. */
function request(h: Harness) {
  const before = h.current().observations.length;
  h.director.update();
  expect(h.current().observations.length).toBe(before + 1);
  return h.current().lastObservation;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("planificación (§8.2, puntos 1 a 4)", () => {
  it("consulta en el tick 0, mantiene una sola pendiente y repite cada 20 ticks", async () => {
    const h = harness();
    await startReady(h);
    const first = request(h);
    expect(first.observation_tick).toBe(0);
    h.director.update();
    expect(h.current().observations).toHaveLength(1);

    h.current().emit(decisionFor(first));
    await settle();
    stepTicks(h, 19);
    h.director.update();
    expect(h.current().observations).toHaveLength(1);
    stepTicks(h, 1);
    expect(request(h).observation_tick).toBe(20);
  });

  it("no recupera ciclos omitidos cuando la respuesta llega tarde", async () => {
    const h = harness({ decisionTimeoutMs: 100_000 });
    await startReady(h);
    const first = request(h);
    stepTicks(h, 9);
    h.current().emit(decisionFor(first));
    await settle();
    stepTicks(h, 100);
    h.director.update();
    expect(h.current().observations).toHaveLength(2);
    h.director.update();
    expect(h.current().observations).toHaveLength(2);
  });

  it("agenda las órdenes para el siguiente tick y registra applied_tick y resultado", async () => {
    const h = harness();
    await startReady(h);
    const obs = request(h);
    h.current().emit(decisionFor(obs));
    await settle();
    expect(h.session.commandLog).toHaveLength(0);
    stepTicks(h, 1);
    h.director.update();
    expect(h.session.commandLog.map((e) => e.command.id)).toEqual(["1:0"]);
    expect(h.director.log[0]).toMatchObject({ requestId: 1, observationTick: 0, appliedTick: 1, outcome: "accepted" });

    stepTicks(h, 19);
    const next = request(h);
    expect(next.previous_results).toEqual([{ command_id: "1:0", accepted: true, code: null }]);
  });

  it("las órdenes sobre unidades ajenas se rechazan sin modificar el estado", async () => {
    const h = harness();
    await startReady(h);
    const obs = request(h);
    h.current().emit(decisionFor(obs, { commands: [moveCommand(obs.request_id, 0, [2])] }));
    await settle();
    stepTicks(h, 1);
    h.director.update();
    expect(h.director.log[0]).toMatchObject({ outcome: "rejected", code: "NOT_OWNER" });
    expect(h.session.state.units.find((u) => u.id === 2)).toMatchObject({ task: "idle", dest: null });
  });

  it("Train y Gather del contrato se aplican como órdenes del núcleo", async () => {
    const h = harness();
    await startReady(h);
    const obs = request(h);
    const state = h.session.state;
    const tc = state.buildings.find((b) => b.owner === 1 && b.kind === "townCenter")!;
    const node = state.resourceNodes.find((n) => n.kind === "food")!;
    const villager = state.units.find((u) => u.owner === 1 && u.kind === "villager")!;
    h.current().emit(
      decisionFor(obs, {
        commands: [
          { command_id: "1:0", type: "Train", entity_ids: [tc.id], payload: { unit_kind: "villager" } },
          { command_id: "1:1", type: "Gather", entity_ids: [villager.id], payload: { target_id: node.id } },
        ],
      }),
    );
    await settle();
    stepTicks(h, 1);
    h.director.update();
    expect(h.director.log.map((e) => e.outcome)).toEqual(["accepted", "accepted"]);
    expect(tc.queue).toHaveLength(1);
    expect(villager.job).toMatchObject({ type: "gather", nodeId: node.id });
  });

  it("toCoreCommand traduce todos los tipos del contrato", () => {
    const base = { command_id: "1:0", entity_ids: [7] };
    expect(toCoreCommand({ ...base, type: "Build", payload: { building_kind: "house", cell_x: 3, cell_z: 4 } })).toEqual({
      type: "Build",
      entityIds: [7],
      target: { x: 3, z: 4 },
      kind: "house",
    });
    expect(toCoreCommand({ ...base, type: "Train", payload: { unit_kind: "archer" } })).toEqual({ type: "Train", entityIds: [7], kind: "archer" });
    expect(toCoreCommand({ ...base, type: "CancelTraining", payload: { queue_item_id: 9 } })).toEqual({
      type: "CancelTraining",
      entityIds: [7],
      target: { entityId: 9 },
    });
    for (const type of ["Gather", "Attack", "ResumeBuild"] as const) {
      expect(toCoreCommand({ ...base, type, payload: { target_id: 5 } })).toEqual({ type, entityIds: [7], target: { entityId: 5 } });
    }
    expect(toCoreCommand({ ...base, type: "CancelBuild", payload: {} })).toEqual({ type: "CancelBuild", entityIds: [7] });
    expect(toCoreCommand({ ...base, type: "Stop", payload: {} })).toEqual({ type: "Stop", entityIds: [7] });
  });
});

describe("T-14 respuestas duplicadas, viejas o de otra sesión", () => {
  it("una respuesta duplicada no vuelve a modificar el juego", async () => {
    const h = harness();
    await startReady(h);
    const obs = request(h);
    const decision = decisionFor(obs);
    h.current().emit(decision);
    await settle();
    h.current().emit(decision);
    await settle();
    stepTicks(h, 2);
    expect(h.session.commandLog).toHaveLength(1);
    expect(h.provider.discardedMessages).toBe(1);
  });

  it("descarta respuestas de otra solicitud, sesión, generación, tick o jugador sin afectar la pendiente", async () => {
    const h = harness();
    await startReady(h);
    const obs = request(h);
    const worker = h.current();
    worker.emit(decisionFor(obs, { request_id: 99, commands: [moveCommand(99, 0)] }));
    worker.emit(decisionFor(obs, { session_id: OTHER_SESSION }));
    worker.emit(decisionFor(obs, { worker_generation: 9 }));
    worker.emit(decisionFor(obs, { observation_tick: obs.observation_tick + 3 }));
    worker.emit(decisionFor(obs, { player_id: 0 }));
    await settle();
    expect(h.provider.discardedMessages).toBe(5);
    expect(h.provider.state).toBe("busy");
    stepTicks(h, 1);
    expect(h.session.commandLog).toHaveLength(0);

    worker.emit(decisionFor(obs));
    await settle();
    expect(h.provider.state).toBe("ready");
    expect(h.director.status).toBe("ok");
  });

  it("pausar con una petición en vuelo termina el worker y rechaza su respuesta tardía", async () => {
    const h = harness();
    await startReady(h);
    const obs = request(h);
    const old = h.current();

    h.session.pause();
    h.director.suspend();
    expect(old.terminated).toBe(true);
    expect(h.provider.state).toBe("suspended");

    old.emitLate(decisionFor(obs));
    await settle();
    h.session.resume();
    stepTicks(h, 2);
    expect(h.session.commandLog).toHaveLength(0);

    h.director.resume();
    expect(h.workers).toHaveLength(2);
    expect(h.provider.generation).toBe(2);
    h.current().ready();
    await settle();
    expect(h.director.status).toBe("ok");
    const next = request(h);
    expect(next).toMatchObject({ worker_generation: 2, request_id: 2 });
  });

  it("pausar descarta las decisiones agendadas que todavía no se ejecutaron", async () => {
    const h = harness();
    await startReady(h);
    const obs = request(h);
    h.current().emit(decisionFor(obs));
    await settle();

    h.session.pause();
    h.director.suspend();
    h.session.resume();
    stepTicks(h, 2);
    expect(h.session.commandLog).toHaveLength(0);
    expect(h.director.log[0]).toMatchObject({ outcome: "discarded" });
  });

  it("finalizar la partida con una petición en vuelo no deja efectos tardíos", async () => {
    const h = harness();
    await startReady(h);
    const obs = request(h);
    const worker = h.current();
    h.director.dispose();
    expect(worker.terminated).toBe(true);
    expect(h.provider.state).toBe("stopped");
    worker.emitLate(decisionFor(obs));
    await settle();
    stepTicks(h, 2);
    expect(h.session.commandLog).toHaveLength(0);
  });

  it("una decisión caducada se descarta y una válida reinicia el contador de fallos", async () => {
    const h = harness();
    await startReady(h);
    const first = request(h);
    stepTicks(h, 11);
    h.current().emit(decisionFor(first));
    await settle();
    expect(h.session.commandLog).toHaveLength(0);
    expect(h.director).toMatchObject({ status: "degraded", failures: 1 });
    expect(h.session.paused).toBe(false);

    stepTicks(h, 9);
    const second = request(h);
    h.current().emit(decisionFor(second));
    await settle();
    expect(h.director).toMatchObject({ status: "ok", failures: 0 });
    stepTicks(h, 1);
    expect(h.session.commandLog).toHaveLength(1);
  });
});

describe("T-15 fallos, pausa y recuperación", () => {
  const expectPausedAndTerminated = (h: Harness, worker: FakeWorker): void => {
    expect(worker.terminated).toBe(true);
    expect(h.session.paused).toBe(true);
    expect(h.director.status).toBe("failed");
    expect(h.session.advance(1000)).toBe(0);
  };

  it("el timeout pausa la simulación y termina el worker", async () => {
    const h = harness();
    await startReady(h);
    request(h);
    const worker = h.current();
    await vi.advanceTimersByTimeAsync(499);
    expect(h.provider.state).toBe("busy");
    await vi.advanceTimersByTimeAsync(1);
    expect(h.provider.lastError).toMatchObject({ code: "TIMEOUT", fatal: true });
    expectPausedAndTerminated(h, worker);
  });

  it("un error del worker pausa y termina", async () => {
    const h = harness();
    await startReady(h);
    request(h);
    const worker = h.current();
    worker.onerror?.({ message: "fallo fatal de Python" });
    await settle();
    expect(h.provider.state).toBe("failed");
    expectPausedAndTerminated(h, worker);
  });

  it("messageerror pausa y termina", async () => {
    const h = harness();
    await startReady(h);
    request(h);
    const worker = h.current();
    worker.onmessageerror?.({});
    await settle();
    expect(h.provider.lastError?.code).toBe("INVALID_MESSAGE");
    expectPausedAndTerminated(h, worker);
  });

  it("un mensaje ERROR correlacionado es fatal; uno de otra solicitud se ignora", async () => {
    const h = harness();
    await startReady(h);
    const obs = request(h);
    const worker = h.current();
    worker.emit(errorFor(obs, { request_id: 77 }));
    expect(h.provider.state).toBe("busy");
    worker.emit(errorFor(obs));
    await settle();
    expect(h.provider.lastError).toMatchObject({ code: "POLICY_ERROR" });
    expectPausedAndTerminated(h, worker);
  });

  it("dos respuestas inválidas consecutivas pausan y terminan el worker", async () => {
    const h = harness();
    await startReady(h);
    const first = request(h);
    const worker = h.current();
    worker.emit({ ...decisionFor(first), extra: true });
    await settle();
    expect(h.director).toMatchObject({ status: "degraded", failures: 1 });
    expect(h.session.paused).toBe(false);

    stepTicks(h, 20);
    const second = request(h);
    worker.emit({ ...decisionFor(second), commands: "no" });
    await settle();
    expectPausedAndTerminated(h, worker);
    expect(h.session.commandLog).toHaveLength(0);
  });

  it("una respuesta inválida seguida de una válida no pausa", async () => {
    const h = harness();
    await startReady(h);
    const first = request(h);
    h.current().emit({ ...decisionFor(first), protocol_version: PROTOCOL_VERSION, extra: 1 });
    await settle();
    stepTicks(h, 20);
    const second = request(h);
    h.current().emit(decisionFor(second));
    await settle();
    stepTicks(h, 20);
    const third = request(h);
    h.current().emit({ ...decisionFor(third), extra: 1 });
    await settle();
    expect(h.session.paused).toBe(false);
    expect(h.director).toMatchObject({ status: "degraded", failures: 1 });
  });

  it("la recuperación crea un worker nuevo, usa el estado actual y no duplica órdenes", async () => {
    const h = harness();
    await startReady(h);
    const first = request(h);
    h.current().emit(decisionFor(first));
    await settle();
    stepTicks(h, 1);
    h.director.update();
    expect(h.session.commandLog.map((e) => e.command.id)).toEqual(["1:0"]);

    stepTicks(h, 19);
    const second = request(h);
    const failing = h.current();
    h.current().emit(decisionFor(second));
    await settle();
    // La orden 2:0 está agendada pero aún no se ejecutó cuando el worker cae.
    failing.onerror?.({ message: "caída" });
    await settle();
    expectPausedAndTerminated(h, failing);
    expect(h.director.log.find((e) => e.commandId === "2:0")).toMatchObject({ outcome: "discarded" });

    stepTicks(h, 0);
    const recovery = h.director.recover();
    expect(h.session.paused).toBe(true);
    expect(h.provider.generation).toBe(2);
    h.current().ready();
    await settle();
    const snapshot = h.current().lastObservation;
    expect(snapshot).toMatchObject({ worker_generation: 2, request_id: 3, observation_tick: h.session.state.tick });
    expect(h.session.paused).toBe(true);
    h.current().emit(decisionFor(snapshot));
    expect(await recovery).toBe(true);
    expect(h.director.status).toBe("recovered");
    expect(h.session.paused).toBe(true);

    h.session.resume();
    h.director.resume();
    stepTicks(h, 1);
    h.director.update();
    expect(h.session.commandLog.map((e) => e.command.id)).toEqual(["1:0", "3:0"]);
    expect(h.director.status).toBe("ok");
  });

  it("si la recuperación falla la simulación sigue en pausa", async () => {
    const h = harness();
    await startReady(h);
    request(h);
    h.current().onerror?.({ message: "caída" });
    await settle();

    const recovery = h.director.recover();
    h.current().emit({ type: "ERROR", protocol_version: 2, code: "LOAD_ERROR", message: "sin runtime" });
    expect(await recovery).toBe(false);
    expect(h.director.status).toBe("failed");
    expect(h.session.paused).toBe(true);
  });

  it("el worker que no responde READY en el límite pausa con TIMEOUT y se reintenta a mano", async () => {
    const h = harness({ initTimeoutMs: 90_000 });
    h.director.start();
    await vi.advanceTimersByTimeAsync(89_999);
    expect(h.provider.state).toBe("initializing");
    expect(h.session.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.provider.lastError?.code).toBe("TIMEOUT");
    expect(h.session.paused).toBe(true);
    expect(h.workers).toHaveLength(1);
  });

  it("un READY con versiones incompatibles falla antes de la primera consulta", async () => {
    const h = harness();
    h.director.start();
    h.current().ready({ versions: { pyodide: "0.0.1", python: "3.12.7", policy: "policy-0.0" } });
    await settle();
    expect(h.provider.lastError?.code).toBe("INCOMPATIBLE_VERSION");
    expect(h.session.paused).toBe(true);
    h.director.update();
    expect(h.current().observations).toHaveLength(0);
  });

  it("un error de carga del worker (LOAD_ERROR) falla la inicialización", async () => {
    const h = harness();
    h.director.start();
    h.current().emit({ type: "ERROR", protocol_version: 2, code: "LOAD_ERROR", message: "no se pudo cargar" });
    await settle();
    expect(h.provider.lastError?.code).toBe("LOAD_ERROR");
    expect(h.director.status).toBe("failed");
  });

  it("la simulación sigue avanzando mientras el worker se inicializa", async () => {
    const h = harness();
    h.director.start();
    expect(h.session.advance(200)).toBeGreaterThan(0);
    expect(h.session.paused).toBe(false);
  });
});
