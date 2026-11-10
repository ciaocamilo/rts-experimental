import { describe, expect, it } from "vitest";
import { BALANCE, MAX_ACTIVE_TICKS, validateBalance } from "../../src/content/balance";
import { BATTLE_LAYOUT, battleHomeView, validateBattleLayout } from "../../src/content/map";
import { armyCounts, createBattleState, unitsSeenByEnemy, visibleEnemies, visionSources } from "../../src/core/battle";
import { armyHp } from "../../src/core/combat";
import { hashState } from "../../src/core/hash";
import { validateBattleReachability } from "../../src/core/map-check";
import { describeEnd, matchResult } from "../../src/core/result";
import { stepSimulation } from "../../src/core/simulation";
import { addUnit, maxHpOf } from "../../src/core/state";
import type { Command, GameState } from "../../src/core/types";
import { GameSession } from "../../src/app/session";
import { buildObservation } from "../../src/ai-client/observation";

function order(state: GameState, partial: Pick<Command, "type" | "entityIds" | "target" | "kind"> & { player?: 0 | 1 }): Command {
  const seq = state.lastCommandSeq + 1;
  return { id: `c${seq}`, seq, tick: state.tick, player: partial.player ?? 0, ...partial };
}

function observe(state: GameState, player: 0 | 1) {
  return buildObservation(state, { sessionId: "s", workerGeneration: 1, requestId: 1, playerId: player, previousResults: [] });
}

describe("P10 balance del comandante", () => {
  it("el balance es válido y el plantel suma 91 unidades (un 50 % más que las 61 originales, redondeando)", () => {
    expect(() => validateBalance(BALANCE)).not.toThrow();
    expect(BALANCE.battle.roster).toEqual({ cannon: 8, archer: 22, knight: 15, soldier: 45, commander: 1 });
    expect(Object.values(BALANCE.battle.roster).reduce((a, b) => a + b, 0)).toBe(91);
  });

  it("el comandante es un caballero con el cuádruple de ataque y de vida", () => {
    const c = BALANCE.units.commander;
    const k = BALANCE.units.knight;
    expect(c.damage).toBe(4 * k.damage);
    expect(c.hp).toBe(4 * k.hp);
    expect(c.speedCellsPerSec).toBe(k.speedCellsPerSec);
    expect(c.range).toBe(k.range);
    expect(c.attackIntervalTicks).toBe(k.attackIntervalTicks);
  });

  it("en batalla toda unidad militar tiene el triple de vida; en villa no cambia", () => {
    expect(BALANCE.battle.hpMultiplier).toBe(3);
    for (const kind of ["soldier", "archer", "knight", "cannon", "commander"] as const) {
      expect(maxHpOf(kind, "battle")).toBe(BALANCE.units[kind].hp * 3);
      expect(maxHpOf(kind, "village")).toBe(BALANCE.units[kind].hp);
    }
    expect(maxHpOf("villager", "battle")).toBe(BALANCE.units.villager.hp);
    const battle = createBattleState(1);
    for (const u of battle.units) expect(u.hp).toBe(maxHpOf(u.kind, "battle"));
    expect(battle.units.find((u) => u.kind === "commander")!.hp).toBe(1200);
    expect(addUnit(new GameSession(1).state, 0, "soldier", 10, 10).hp).toBe(BALANCE.units.soldier.hp);
  });

  it("la visión supera el mayor alcance de tiro y la del comandante es mucho mayor", () => {
    const longest = Math.max(...Object.values(BALANCE.units).map((u) => u.range));
    expect(BALANCE.battle.visionRadius).toBeGreaterThan(longest);
    expect(BALANCE.battle.commanderVisionRadius).toBeGreaterThanOrEqual(2 * BALANCE.battle.visionRadius);
  });

  it("el comandante ve enemigos a mayor distancia que un soldado", () => {
    const state = createBattleState(1);
    state.units = [];
    addUnit(state, 0, "commander", 20, 30);
    addUnit(state, 0, "soldier", 20, 50);
    const far = addUnit(state, 1, "soldier", 45, 30);
    const farFromSoldier = addUnit(state, 1, "soldier", 45, 50);
    const seen = visibleEnemies(state, 0).map((u) => u.id);
    expect(seen).toContain(far.id);
    expect(seen).not.toContain(farFromSoldier.id);
    expect(visionSources(state, 0).map((s) => s.r).sort()).toEqual([BALANCE.battle.visionRadius, BALANCE.battle.commanderVisionRadius].sort());
  });
});

describe("P10 mapa de batalla", () => {
  it("el diseño y la alcanzabilidad son válidos", () => {
    expect(() => validateBattleLayout(BATTLE_LAYOUT)).not.toThrow();
    expect(() => validateBattleReachability(createBattleState(1))).not.toThrow();
  });

  it("tiene montañas, valles, bosques y ríos, y simetría de giro de 180°", () => {
    const kinds = new Set(BATTLE_LAYOUT.terrain.map((t) => t.kind));
    for (const kind of ["mountain", "valley", "forest", "water", "bridge"] as const) expect(kinds.has(kind)).toBe(true);
    for (const t of BATTLE_LAYOUT.terrain) {
      expect(BATTLE_LAYOUT.terrain.some((m) => m.kind === t.kind && m.x === BATTLE_LAYOUT.width - t.x - t.w && m.z === BATTLE_LAYOUT.depth - t.z - t.h && m.w === t.w && m.h === t.h)).toBe(true);
    }
  });

  it("rechaza un diseño con una unidad sobre una montaña", () => {
    const army = BATTLE_LAYOUT.armies[0].map((s, i) => (i === 0 ? { ...s, x: 38, z: 6 } : s));
    expect(() => validateBattleLayout({ ...BATTLE_LAYOUT, armies: [army, BATTLE_LAYOUT.armies[1]] })).toThrow();
  });

  it("la cámara inicial queda sobre el ejército del jugador 0", () => {
    const home = battleHomeView(BATTLE_LAYOUT);
    expect(home.x).toBeLessThan(BATTLE_LAYOUT.width / 2);
  });
});

describe("P10 estado inicial de batalla", () => {
  const state = createBattleState(1);

  it("solo hay ejércitos: sin edificios, aldeanos, nodos ni recursos", () => {
    expect(state.mode).toBe("battle");
    expect(state.buildings).toEqual([]);
    expect(state.resourceNodes).toEqual([]);
    for (const owner of [0, 1] as const) {
      expect(armyCounts(state, owner)).toEqual({ villager: 0, soldier: 45, archer: 22, knight: 15, cannon: 8, commander: 1 });
      expect(state.players[owner].food + state.players[owner].wood + state.players[owner].stone).toBe(0);
    }
  });

  it("los ejércitos empiezan formados, quietos y fuera de la vista del rival", () => {
    expect(state.units.every((u) => u.task === "idle")).toBe(true);
    expect(visibleEnemies(state, 0)).toEqual([]);
    expect(visibleEnemies(state, 1)).toEqual([]);
    expect(unitsSeenByEnemy(state, 0).size).toBe(0);
  });

  it("es determinista y distinto al modo villa", () => {
    expect(hashState(createBattleState(1))).toBe(hashState(state));
    expect(hashState(new GameSession(1).state)).not.toBe(hashState(state));
  });
});

describe("P10 órdenes de aldea en batalla", () => {
  it.each(["Gather", "Build", "Train"] as const)("%s se rechaza con NOT_IN_MODE", (type) => {
    const state = createBattleState(1);
    const unit = state.units[0]!;
    const result = stepSimulation(state, [order(state, { type, entityIds: [unit.id], target: { x: unit.pos.x, z: unit.pos.z }, kind: "soldier" })]).results[0]!;
    expect(result).toMatchObject({ accepted: false, code: "NOT_IN_MODE" });
  });

  it("Move sí se acepta", () => {
    const state = createBattleState(1);
    const unit = state.units.find((u) => u.owner === 0 && u.kind === "soldier")!;
    const result = stepSimulation(state, [order(state, { type: "Move", entityIds: [unit.id], target: { x: unit.pos.x + 5, z: unit.pos.z } })]).results[0]!;
    expect(result.accepted).toBe(true);
  });
});

describe("P10 victoria, empate y límite de tiempo", () => {
  function duel(): GameState {
    const state = createBattleState(1);
    state.units.length = 0;
    return state;
  }

  it("aniquilar al rival da la victoria", () => {
    const state = duel();
    addUnit(state, 0, "soldier", 10, 10);
    addUnit(state, 1, "soldier", 100, 10);
    stepSimulation(state);
    expect(state.matchStatus).toBe("playing");
    state.units.find((u) => u.owner === 1)!.hp = 0;
    stepSimulation(state);
    expect(state.matchStatus).toBe("ended");
    expect(state.outcome).toMatchObject({ winner: 0, reason: "ARMY_DESTROYED" });
    expect(matchResult(state, 0)).toBe("victoria");
    expect(matchResult(state, 1)).toBe("derrota");
    expect(describeEnd(state, 0)?.reason).toContain("aniquilado");
  });

  it("al agotarse el tiempo gana quien conserva más vida", () => {
    const state = duel();
    addUnit(state, 0, "soldier", 10, 10);
    const weak = addUnit(state, 1, "soldier", 100, 10);
    weak.hp = 30;
    state.tick = MAX_ACTIVE_TICKS - 1;
    stepSimulation(state);
    expect(armyHp(state, 0)).toBeGreaterThan(armyHp(state, 1));
    expect(state.outcome).toMatchObject({ winner: 0, reason: "TIME_LIMIT" });
  });

  it("con la misma vida al agotarse el tiempo es empate", () => {
    const state = duel();
    addUnit(state, 0, "soldier", 10, 10);
    addUnit(state, 1, "soldier", 100, 10);
    state.tick = MAX_ACTIVE_TICKS - 1;
    stepSimulation(state);
    expect(state.outcome).toMatchObject({ winner: null, reason: "TIME_LIMIT" });
    expect(matchResult(state, 0)).toBe("empate");
  });
});

describe("P10 regresión del modo villa", () => {
  it("la partida de villa es determinista y conserva los ids de aldeanos, nodos y edificios de P9 (mismo hash salvo modo, versión y militares iniciales)", () => {
    const session = new GameSession(1);
    for (let i = 0; i < 1200; i++) session.stepOnce();
    const text = JSON.stringify(session.state, (key, value) => (key === "mode" || key === "schemaVersion" ? undefined : value));
    // Hash de la rama main (P9) más los 4 militares por bando de P10-1.4 (P10-R29), que se crean al final y no desplazan ids.
    expect(hashState(JSON.parse(text))).toBe("d660d762");
  });
});

describe("P10 observación para la IA", () => {
  it("declara el modo, no incluye edificios ni nodos y solo los enemigos visibles", () => {
    const state = createBattleState(1);
    const first = observe(state, 0);
    expect(first.mode).toBe("battle");
    expect(first.buildings).toEqual([]);
    expect(first.resource_nodes).toEqual([]);
    expect(first.units.every((u) => u.owner === 0)).toBe(true);
    expect(first.units).toHaveLength(91);

    const scout = state.units.find((u) => u.owner === 1 && u.kind === "knight")!;
    const mine = state.units.find((u) => u.owner === 0 && u.kind === "soldier")!;
    scout.pos = { x: mine.pos.x + 10, z: mine.pos.z };
    const second = observe(state, 0);
    expect(second.units.filter((u) => u.owner === 1).map((u) => u.id)).toEqual([scout.id]);
    expect(observe(state, 1).units.filter((u) => u.owner === 0).length).toBeGreaterThan(0);
  });
});
