import { describe, expect, it } from "vitest";
import { MAX_ACTIVE_TICKS, TICKS_PER_SECOND } from "../../src/content/balance";
import { describeEnd, endSummary, formatDuration } from "../../src/core/result";
import { createInitialState } from "../../src/core/state";
import type { GameState, MatchOutcome } from "../../src/core/types";
import { GAME_CREDIT, GAME_NAME } from "../../src/content/versions";
import { crestSvg } from "../../src/ui/end-dialog";
import { BRICK_TILE, BRICK_TONES, brickSvg, crenelSvg, towerSvg } from "../../src/ui/castle-bar";

function ended(outcome: Partial<MatchOutcome>): GameState {
  const state = createInitialState(1, false);
  state.matchStatus = "ended";
  state.outcome = {
    winner: 0,
    reason: "TOWN_CENTER_DESTROYED",
    endTick: 63 * TICKS_PER_SECOND,
    mainBuildings: [
      { id: 1, owner: 0, kind: "townCenter", hp: 700, maxHp: 1000, destroyed: false, complete: true, buildProgress: 1 },
      { id: 2, owner: 1, kind: "townCenter", hp: 0, maxHp: 1000, destroyed: true, complete: true, buildProgress: 1 },
    ],
    casualties: { units: [3, 9], buildings: [1, 4] },
    ...outcome,
  };
  return state;
}

describe("P7 ventana de fin", () => {
  it("duración mm:ss", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(63 * TICKS_PER_SECOND)).toBe("01:03");
    expect(formatDuration(MAX_ACTIVE_TICKS)).toBe("30:00");
  });

  it("resumen de una victoria, desde la perspectiva del jugador", () => {
    const s = endSummary(ended({}), 0)!;
    expect(s.label).toBe("victoria");
    expect(s.title).toBe("Victoria");
    expect(s.duration).toBe("01:03");
    expect(s.ownLosses).toEqual({ units: 3, buildings: 1 });
    expect(s.rivalLosses).toEqual({ units: 9, buildings: 4 });
    expect(s.centers.own).toBe("en pie (vida 700/1000)");
    expect(s.centers.rival).toBe("destruido");
  });

  it("derrota y empate por tiempo", () => {
    expect(endSummary(ended({ winner: 1 }), 0)!.title).toBe("Derrota");
    const draw = ended({ winner: null, reason: "TIME_LIMIT", endTick: MAX_ACTIVE_TICKS });
    expect(describeEnd(draw)!.title).toBe("Empate");
    expect(describeEnd(draw)!.reason).toContain("30 minutos");
    expect(endSummary(draw)!.duration).toBe("30:00");
  });

  it("sin partida terminada no hay resumen", () => {
    expect(endSummary(createInitialState(1, false))).toBeNull();
  });

  it("el escudo cambia de color y emblema según el resultado", () => {
    const v = crestSvg("victoria");
    expect(v).toContain("#2f5fb0");
    expect(crestSvg("derrota")).toContain("#8f2a24");
    expect(crestSvg("empate")).not.toBe(v);
  });
});

describe("P7 identidad y barra de castillo", () => {
  it("nombre provisional y crédito del autor", () => {
    expect(GAME_NAME).toBe("RTS Camilus");
    expect(GAME_CREDIT).toBe("Creado experimentalmente por Ing. Camilo A. Castañeda Galindo");
  });

  it("el mosaico usa ocho tonos y cubre toda la tesela", () => {
    expect(BRICK_TONES).toHaveLength(8);
    const svg = brickSvg();
    expect(svg).toContain(`width='${BRICK_TILE.width}'`);
    const used = BRICK_TONES.filter((tone) => svg.includes(`fill='${tone}'`));
    expect(used.length).toBe(8);
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(crenelSvg()).toContain("<svg");
    expect(towerSvg()).toContain("<svg");
  });
});
