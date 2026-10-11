import { describe, expect, it } from "vitest";
import { BALANCE, MAX_CATCHUP_STEPS, TICK_MS, validateBalance } from "../../src/content/balance";
import { MAP_LAYOUT, validateMapLayout } from "../../src/content/map";
import { FixedStepper } from "../../src/core/fixed-step";
import { hashState } from "../../src/core/hash";
import { stepSimulation } from "../../src/core/simulation";
import { createInitialState, populationOf } from "../../src/core/state";
import type { Command } from "../../src/core/types";
import { GameSession } from "../../src/app/session";

describe("escenario inicial (RF-01, §4.2)", () => {
  const state = createInitialState(7);

  it("carga recursos, población y centro por bando", () => {
    for (const p of state.players) {
      expect(p.food).toBe(200);
      expect(p.wood).toBe(200);
      expect(p.popCapacity).toBe(10);
    }
    expect(state.buildings.filter((b) => b.kind === "townCenter")).toHaveLength(2);
    expect(populationOf(state, 0)).toBe(3);
    expect(populationOf(state, 1)).toBe(3);
  });

  it("crea 16 nodos de madera, 8 de alimento y 8 de piedra por bando con 500 unidades (P3)", () => {
    expect(state.resourceNodes).toHaveLength(56);
    expect(state.resourceNodes.filter((n) => n.kind === "wood")).toHaveLength(32);
    expect(state.resourceNodes.filter((n) => n.kind === "food")).toHaveLength(16);
    expect(state.resourceNodes.filter((n) => n.kind === "stone")).toHaveLength(8);
    expect(state.resourceNodes.every((n) => n.remaining === 500)).toBe(true);
  });

  it("IDs únicos", () => {
    const ids = [...state.units, ...state.buildings, ...state.resourceNodes].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("balance y mapa validan; un balance inválido se rechaza", () => {
    expect(() => validateBalance(BALANCE)).not.toThrow();
    expect(() => validateMapLayout(MAP_LAYOUT)).not.toThrow();
    expect(() => validateBalance({ ...BALANCE, nodeAmount: Number.NaN })).toThrow();
  });
});

describe("tick reproducible (RNF-06)", () => {
  const stop = (id: string, seq: number, entity: number, player: 0 | 1 = 0): Command => ({
    id, seq, tick: 0, player, type: "Stop", entityIds: [entity],
  });

  it("misma semilla y comandos producen el mismo hash", () => {
    const run = (): string => {
      const s = createInitialState(42);
      stepSimulation(s, [stop("a", 1, 2)]);
      for (let i = 0; i < 100; i++) stepSimulation(s);
      return hashState(s);
    };
    expect(run()).toBe(run());
  });

  it("avanza un tick por paso", () => {
    const s = createInitialState(1);
    for (let i = 0; i < 10; i++) stepSimulation(s);
    expect(s.tick).toBe(10);
  });

  it("rechaza propietario ajeno, entidad inexistente, secuencia repetida y ataque de un aldeano", () => {
    const s = createInitialState(1);
    const own = s.units.find((u) => u.owner === 0)!.id;
    const enemy = s.units.find((u) => u.owner === 1)!.id;
    const { results } = stepSimulation(s, [
      stop("ok", 1, own),
      stop("foreign", 2, enemy),
      stop("ghost", 3, 9999),
      stop("dup", 1, own),
      { id: "mv", seq: 4, tick: 0, player: 0, type: "Attack", entityIds: [own], target: { entityId: enemy } },
    ]);
    const code = (id: string): unknown => {
      const r = results.find((x) => x.commandId === id)!;
      return r.accepted ? "ok" : r.code;
    };
    expect(code("ok")).toBe("ok");
    expect(code("foreign")).toBe("NOT_OWNER");
    expect(code("ghost")).toBe("UNKNOWN_ENTITY");
    expect(code("dup")).toBe("DUPLICATE_SEQUENCE");
    expect(code("mv")).toBe("INCOMPATIBLE_ENTITY");
  });

  it("una partida terminada no cambia", () => {
    const s = createInitialState(1);
    s.matchStatus = "ended";
    const before = hashState(s);
    stepSimulation(s);
    expect(hashState(s)).toBe(before);
  });
});

describe("paso fijo (§4.1)", () => {
  it("convierte tiempo real en ticks de 50 ms", () => {
    const f = new FixedStepper();
    expect(f.advance(TICK_MS * 3).steps).toBe(3);
    expect(f.advance(TICK_MS / 2).steps).toBe(0);
    expect(f.advance(TICK_MS / 2).steps).toBe(1);
  });

  it("limita a 5 pasos por fotograma y descarta el exceso", () => {
    const f = new FixedStepper();
    const r = f.advance(TICK_MS * 20 + 10);
    expect(r.steps).toBe(MAX_CATCHUP_STEPS);
    expect(r.discardedMs).toBeGreaterThan(0);
    expect(f.advance(0).steps).toBe(0);
  });

  it("ignora deltas inválidos", () => {
    const f = new FixedStepper();
    expect(f.advance(Number.NaN).steps).toBe(0);
    expect(f.advance(-5).steps).toBe(0);
  });
});

describe("sesión: pausa y reinicio (RF-01, RF-11)", () => {
  it("la pausa detiene la simulación y reanudar no recupera tiempo", () => {
    const s = new GameSession(1);
    s.advance(TICK_MS * 2);
    s.pause();
    expect(s.advance(TICK_MS * 100)).toBe(0);
    s.resume();
    expect(s.advance(TICK_MS)).toBe(1);
    expect(s.state.tick).toBe(3);
  });

  it("una sesión nueva reinicia estado y métricas", () => {
    const a = new GameSession(1);
    a.advance(TICK_MS * 100);
    a.submit({ id: "x", seq: 1, tick: 0, player: 0, type: "Stop", entityIds: [2] });
    a.stepOnce();
    const b = new GameSession(1);
    expect(b.state.tick).toBe(0);
    expect(b.commandLog).toHaveLength(0);
    expect(hashState(b.state)).toBe(hashState(new GameSession(1).state));
  });

  it("registra el tick de aplicación de los comandos", () => {
    const s = new GameSession(1);
    s.stepOnce();
    s.submit({ id: "x", seq: 1, tick: 0, player: 0, type: "Stop", entityIds: [2] });
    s.stepOnce();
    expect(s.commandLog[0]?.appliedTick).toBe(2);
    expect(s.commandLog[0]?.result.accepted).toBe(true);
  });
});
