import { beforeAll, describe, expect, it } from "vitest";
import { loadPolicyRuntime, replayMatch, runMatch, type MatchRun, type PolicyRuntime } from "../helpers/headless-match";

const TWELVE_MINUTES = 14_400;
const FORBIDDEN_REJECTIONS = [
  "INSUFFICIENT_RESOURCES",
  "POPULATION_LIMIT",
  "QUEUE_FULL",
  "NOT_COMPLETE",
  "NOT_OWNER",
  "INCOMPATIBLE_ENTITY",
  "DUPLICATE_SEQUENCE",
  "UNKNOWN_ENTITY",
] as const;

let runtime: PolicyRuntime;
beforeAll(async () => {
  runtime = await loadPolicyRuntime();
}, 120_000);

const countOf = (run: MatchRun, player: 0 | 1, kind: string, complete = true): number =>
  run.session.state.buildings.filter((b) => b.owner === player && b.kind === kind && (!complete || b.complete)).length;

describe("T-08 partida completa de la IA sin intervención humana", () => {
  let run: MatchRun;
  beforeAll(() => {
    run = runMatch(runtime, { seed: 1, maxTicks: TWELVE_MINUTES, ais: [1] });
    const state = run.session.state;
    console.info(
      `[T-08] ticks ${state.tick}, decisiones ${run.decisions}, comandos ${JSON.stringify(run.commandsByType)}, ` +
        `rechazos ${JSON.stringify(run.rejections)}, primer ataque ${run.firstAttackTick[1]}, resultado ${JSON.stringify(state.outcome)}`,
    );
  }, 120_000);

  it("no infringe reglas: sin recursos negativos, población sobre capacidad ni decisiones inválidas", () => {
    expect(run.violations).toEqual([]);
  });

  it("recorre el ciclo económico: recolecta, entrena aldeanos, construye casa y cuartel y entrena militares", () => {
    expect(run.commandsByType.Gather).toBeGreaterThan(0);
    expect(run.commandsByType.Train).toBeGreaterThan(5);
    expect(run.commandsByType.Build).toBeGreaterThanOrEqual(2);
    const buildings = run.session.state.buildings.filter((b) => b.owner === 1);
    expect(buildings.some((b) => b.kind === "house")).toBe(true);
    expect(buildings.some((b) => b.kind === "barracks" && b.complete)).toBe(true);
    expect(run.session.state.units.filter((u) => u.owner === 1 && u.kind === "villager").length).toBeGreaterThanOrEqual(10);
  });

  it("lanza la primera expedición antes de los 12 minutos", () => {
    expect(run.firstAttackTick[1]).toBeDefined();
    expect(run.firstAttackTick[1]!).toBeLessThan(TWELVE_MINUTES);
  });

  it("no emite órdenes que la simulación rechace por recursos, población, cola o propiedad", () => {
    for (const code of FORBIDDEN_REJECTIONS) expect(run.rejections[code] ?? 0, code).toBe(0);
  });

  it("el jugador pasivo no recibe órdenes de la política", () => {
    expect(run.session.commandLog.every((entry) => entry.command.player === 1)).toBe(true);
  });
});

describe("T-10 reproducibilidad y T-16 determinismo de la política", () => {
  it("la misma semilla y la misma política producen el mismo hash final y las mismas decisiones", () => {
    const a = runMatch(runtime, { seed: 7, maxTicks: 4_000, ais: [1] });
    const b = runMatch(runtime, { seed: 7, maxTicks: 4_000, ais: [1] });
    expect(a.violations).toEqual([]);
    expect(a.hash).toBe(b.hash);
    expect(a.decisionLog).toEqual(b.decisionLog);
    expect(a.decisions).toBeGreaterThan(100);
  }, 120_000);

  it("reproducir solo el registro de comandos, sin política ni worker, da el mismo hash", () => {
    const run = runMatch(runtime, { seed: 3, maxTicks: 6_000, ais: [1] });
    expect(run.session.commandLog.length).toBeGreaterThan(20);
    expect(replayMatch(3, run.session.commandLog, run.session.state.tick)).toBe(run.hash);
  }, 120_000);

  it("una orden distinta en el registro cambia el hash (la prueba detecta divergencias)", () => {
    const run = runMatch(runtime, { seed: 3, maxTicks: 2_000, ais: [1] });
    const altered = run.session.commandLog.slice(1);
    expect(replayMatch(3, altered, run.session.state.tick)).not.toBe(run.hash);
  }, 120_000);

  it("dos IA enfrentadas cumplen las reglas y la partida es reproducible", () => {
    const run = runMatch(runtime, { seed: 5, maxTicks: 24_000, ais: [0, 1] });
    const state = run.session.state;
    console.info(
      `[T-08/T-12 IA vs IA] ticks ${state.tick}, decisiones ${run.decisions}, comandos ${JSON.stringify(run.commandsByType)}, ` +
        `rechazos ${JSON.stringify(run.rejections)}, ataques ${JSON.stringify(run.firstAttackTick)}, resultado ${JSON.stringify(state.outcome)}, ` +
        `militares ${[0, 1].map((p) => state.units.filter((u) => u.owner === p && u.kind !== "villager").length)}, ` +
        `cuarteles ${countOf(run, 0, "barracks")}/${countOf(run, 1, "barracks")}`,
    );
    expect(run.violations).toEqual([]);
    for (const code of FORBIDDEN_REJECTIONS) expect(run.rejections[code] ?? 0, code).toBe(0);
    expect(replayMatch(5, run.session.commandLog, state.tick)).toBe(run.hash);
  }, 240_000);
});
