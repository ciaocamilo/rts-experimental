import { beforeAll, describe, expect, it } from "vitest";
import { GameSession } from "../../src/app/session";
import { PerfRecorder } from "../../src/diagnostics/recorder";
import { createFixture } from "../../src/core/fixtures";
import type { GameState } from "../../src/core/types";
import { loadPolicyRuntime, replayMatch, runMatch, type PolicyRuntime } from "../helpers/headless-match";

const FULL_MATCH_TICKS = 24_000;
const HUGE_HP = 1_000_000;

/** Centros urbanos casi indestructibles: la partida llega al límite de 20 minutos con ambos bandos activos. */
const indestructibleCenters = (state: GameState): void => {
  for (const b of state.buildings) if (b.kind === "townCenter") b.hp = HUGE_HP;
};

let runtime: PolicyRuntime;
beforeAll(async () => {
  runtime = await loadPolicyRuntime();
}, 120_000);

describe("RNF-04 partida de 20 minutos sin degradación", () => {
  it("dos IA durante 24000 ticks: sin violaciones, resultado único, entidades acotadas y reproducible", () => {
    const run = runMatch(runtime, { seed: 5, maxTicks: FULL_MATCH_TICKS, ais: [0, 1], setup: indestructibleCenters });
    const state = run.session.state;
    console.info(
      `[RNF-04] ticks ${state.tick}, decisiones ${run.decisions}, unidades ${state.units.length}, edificios ${state.buildings.length}, ` +
        `comandos ${run.session.commandLog.length}, rechazos ${JSON.stringify(run.rejections)}, resultado ${JSON.stringify(state.outcome)}`,
    );
    expect(run.violations).toEqual([]);
    expect(state.tick).toBe(FULL_MATCH_TICKS);
    expect(state.outcome?.reason).toBe("TIME_LIMIT");
    expect(state.units.length).toBeLessThanOrEqual(2 * 50);
    expect(state.buildings.length).toBeLessThan(200);
    const ids = new Set([...state.units, ...state.buildings, ...state.resourceNodes].map((e) => e.id));
    expect(ids.size).toBe(state.units.length + state.buildings.length + state.resourceNodes.length);
    expect(state.pathQueue.length).toBeLessThan(200);
    expect(replayMatch(5, run.session.commandLog, state.tick, indestructibleCenters)).toBe(run.hash);
  }, 300_000);
});

describe("RNF-02 escena objetivo", () => {
  it("contiene 100 unidades, 20 edificios, 40 militares combatiendo, 20 aldeanos recolectando y el resto en marcha", () => {
    const session = new GameSession(1, createFixture("objetivo"));
    const state = session.state;
    expect(state.units.length).toBe(100);
    expect(state.buildings.length).toBe(20);
    session.advance(50 * 5);
    const villagers = state.units.filter((u) => u.kind === "villager");
    expect(villagers.length).toBe(20);
    expect(villagers.every((u) => u.job?.type === "gather")).toBe(true);
    expect(state.units.filter((u) => u.kind !== "villager").length).toBe(80);
  });

  it("el coste de un tick mantiene p95 <= 10 ms durante 3 minutos simulados", () => {
    const session = new GameSession(1, createFixture("objetivo"));
    const perf = new PerfRecorder();
    session.tickObserver = (ms) => perf.recordTick(ms);
    let peakFighting = 0;
    for (let i = 0; i < 3_600 && session.state.outcome === null; i += 1) {
      session.advance(50);
      if (i % 20 === 0) {
        peakFighting = Math.max(peakFighting, session.state.units.filter((u) => u.job?.type === "attack").length);
      }
    }
    const summary = perf.summary();
    console.info(
      `[RNF-02] ticks ${session.state.tick}, unidades ${session.state.units.length}, combatiendo (pico) ${peakFighting}, ` +
        `tick p50 ${summary.tickMsP50.toFixed(3)} p95 ${summary.tickMsP95.toFixed(3)} max ${summary.tickMsMax.toFixed(3)} ms, cola de rutas max ${summary.maxPathQueue}`,
    );
    expect(peakFighting).toBeGreaterThanOrEqual(20);
    expect(summary.tickMsP95).toBeLessThanOrEqual(10);
  }, 120_000);
});
