import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIDirector } from "../../src/ai-client/director";
import { WorkerAIProvider } from "../../src/ai-client/provider";
import { GameSession } from "../../src/app/session";
import { Ring, PerfRecorder, percentileOf } from "../../src/diagnostics/recorder";
import { REPORT_SCHEMA, buildReport, type EnvInfo } from "../../src/diagnostics/report";
import { FakeWorker, decisionFor } from "../helpers/fake-worker";
import { replayMatch } from "../helpers/headless-match";

const SESSION = "3f2b8c1e-5a7d-4e9b-8c3a-1d2e3f4a5b6c";
const ENV: EnvInfo = { userAgent: "test", gpu: "gpu-test", viewport: "1366x768", devicePixelRatio: 1, renderScale: 1 };

function harness() {
  const workers: FakeWorker[] = [];
  const session = new GameSession(1);
  const provider = new WorkerAIProvider({
    sessionId: SESSION,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  });
  const director = new AIDirector(session, provider, { playerId: 1 });
  return { workers, session, provider, director, current: () => workers[workers.length - 1]! };
}

const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("recorder de rendimiento", () => {
  it("el búfer circular conserva solo las últimas muestras", () => {
    const ring = new Ring(3);
    for (const v of [5, 1, 4, 2, 3]) ring.push(v);
    expect(ring.length).toBe(3);
    expect(ring.sorted()).toEqual([2, 3, 4]);
  });

  it("percentil por rango superior", () => {
    const data = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentileOf(data, 50)).toBe(50);
    expect(percentileOf(data, 95)).toBe(95);
    expect(percentileOf([], 95)).toBe(0);
  });

  it("los fotogramas en pausa no entran en los FPS y se cuentan aparte", () => {
    const perf = new PerfRecorder();
    for (let i = 0; i < 100; i++) perf.recordFrame(16, false);
    perf.recordFrame(5_000, true);
    perf.recordFrame(0, false);
    perf.recordFrame(Number.NaN, false);
    const s = perf.summary();
    expect(s.frames).toBe(101);
    expect(s.pausedFrames).toBe(1);
    expect(s.pausedMs).toBe(5_000);
    expect(s.medianFps).toBeCloseTo(62.5, 1);
    expect(s.frameMsP95).toBe(16);
    expect(s.frameMsMax).toBe(16);
  });

  it("resume ticks y carga máxima", () => {
    const perf = new PerfRecorder();
    for (const ms of [1, 2, 3, 4, 100]) perf.recordTick(ms);
    perf.observeLoad(7, 100);
    perf.observeLoad(3, 120);
    const s = perf.summary();
    expect(s.ticks).toBe(5);
    expect(s.tickMsP50).toBe(3);
    expect(s.tickMsP95).toBe(100);
    expect(s.tickMsMax).toBe(100);
    expect(s.maxPathQueue).toBe(7);
    expect(s.maxUnits).toBe(120);
  });
});

describe("informe de diagnóstico (RF-12)", () => {
  it("incluye versiones, entorno, métricas y órdenes aplicadas; sin datos personales", () => {
    const h = harness();
    const perf = new PerfRecorder();
    h.session.tickObserver = (ms) => perf.recordTick(ms);
    for (let i = 0; i < 40; i++) h.session.stepOnce();
    const report = buildReport({ session: h.session, perf, fixture: null, env: ENV, ai: null, errors: [] });
    expect(report.schema).toBe(REPORT_SCHEMA);
    expect(report.versions).toMatchObject({ game: expect.any(String), map: expect.any(String), balance: expect.any(String), schema: 3 });
    expect(report.seed).toBe(1);
    expect(report.match.tick).toBe(40);
    expect(report.perf.ticks).toBe(40);
    expect(report.entities.units).toEqual([3, 3]);
    expect(report.ai).toBeNull();
    const json = JSON.stringify(report);
    expect(json).not.toMatch(/localStorage|cookie|@/);
    expect(JSON.parse(json)).toEqual(report);
  });

  it("las órdenes exportadas bastan para reproducir el hash final sin política ni worker", () => {
    const session = new GameSession(9);
    const ids = session.state.units.filter((u) => u.owner === 0).map((u) => u.id);
    session.issue({ type: "Move", player: 0, entityIds: ids, target: { x: 20, z: 20 } });
    for (let i = 0; i < 200; i++) session.stepOnce();
    const report = buildReport({ session, perf: new PerfRecorder(), fixture: null, env: ENV, ai: null, errors: [] });
    expect(report.appliedCommands.length).toBe(1);
    const log = (report.appliedCommands as { appliedTick: number; command: never }[]).map((e) => ({ appliedTick: e.appliedTick, command: e.command }));
    expect(replayMatch(9, log, report.match.tick)).toBe(report.match.stateHash);
  });

  it("con IA: guarda el intercambio observación-decisión con su latencia y los errores capturados", async () => {
    const h = harness();
    h.director.start();
    h.current().ready();
    await settle();
    h.director.update();
    h.current().emit(decisionFor(h.current().lastObservation));
    await settle();
    const report = buildReport({ session: h.session, perf: new PerfRecorder(), fixture: "objetivo", env: ENV, ai: { director: h.director, provider: h.provider }, errors: ["boom"] });
    const ai = report.ai as { exchanges: { observation: unknown; decision: unknown; error: unknown; latencyMs: number }[]; requestsSent: number };
    expect(report.fixture).toBe("objetivo");
    expect(report.loop.errors).toEqual(["boom"]);
    expect(report.versions.policy).not.toBeNull();
    expect(ai.requestsSent).toBe(1);
    expect(ai.exchanges).toHaveLength(1);
    expect(ai.exchanges[0]!.observation).toBeTruthy();
    expect(ai.exchanges[0]!.decision).toBeTruthy();
    expect(ai.exchanges[0]!.error).toBeNull();
    h.director.dispose();
  });
});

describe("T-01 diez reinicios consecutivos", () => {
  it("cada reinicio termina su worker, deja la IA detenida y no acumula temporizadores", async () => {
    const created: ReturnType<typeof harness>[] = [];
    for (let i = 0; i < 10; i++) {
      const h = harness();
      created.push(h);
      h.director.start();
      h.current().ready();
      await settle();
      h.director.update();
      for (let t = 0; t < 30; t++) h.session.stepOnce();
      h.director.dispose();
      expect(h.workers.every((w) => w.terminated)).toBe(true);
      expect(h.director.status).toBe("stopped");
    }
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(created.reduce((n, h) => n + h.workers.length, 0)).toBe(10);
  });
});
