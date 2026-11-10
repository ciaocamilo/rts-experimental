import { beforeAll, describe, expect, it } from "vitest";
import { loadPolicyRuntime, replayMatch, runMatch, type PolicyRuntime } from "../helpers/headless-match";

const MAX_TICKS = 36_000;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

let runtime: PolicyRuntime;
beforeAll(async () => {
  runtime = await loadPolicyRuntime();
}, 120_000);

describe("P10 batallas completas en headless", () => {
  it("la IA vence a la carga ingenua en al menos 7 de 10 semillas desde cada lado, sin violaciones", () => {
    const wins = { 0: 0, 1: 0 };
    for (const seed of SEEDS) {
      for (const ai of [0, 1] as const) {
        const run = runMatch(runtime, { seed, maxTicks: MAX_TICKS, ais: [ai], naive: [ai === 0 ? 1 : 0], mode: "battle" });
        expect(run.violations).toEqual([]);
        expect(run.rejections).toEqual({});
        expect(run.session.state.outcome).not.toBeNull();
        if (run.session.state.outcome?.winner === ai) wins[ai] += 1;
      }
    }
    expect(wins[0]).toBeGreaterThanOrEqual(7);
    expect(wins[1]).toBeGreaterThanOrEqual(7);
  }, 600_000);

  it("IA contra IA termina, es reproducible y la repetición da el mismo hash", () => {
    const options = { seed: 7, maxTicks: MAX_TICKS, ais: [0, 1] as const, mode: "battle" as const };
    const a = runMatch(runtime, options);
    const b = runMatch(runtime, options);
    expect(a.violations).toEqual([]);
    expect(a.rejections).toEqual({});
    expect(a.session.state.outcome).not.toBeNull();
    expect(b.hash).toBe(a.hash);
    expect(b.session.state.tick).toBe(a.session.state.tick);
    const log = a.session.commandLog;
    expect(replayMatch(7, log, a.session.state.tick, undefined, "battle")).toBe(a.hash);
  }, 300_000);

  it("la IA no emite más de 8 comandos por decisión ni órdenes de edificios", () => {
    const run = runMatch(runtime, { seed: 4, maxTicks: 3000, ais: [0, 1], mode: "battle" });
    expect(run.decisions).toBeGreaterThan(0);
    for (const entry of run.decisionLog) expect(entry.commands.length).toBeLessThanOrEqual(8);
    const allowed = new Set(["Move", "Attack", "Stop"]);
    expect(Object.keys(run.commandsByType).every((type) => allowed.has(type))).toBe(true);
  }, 120_000);
});
