import { describe, expect, it } from "vitest";
import { createBattleState } from "../../src/core/battle";
import { stepSimulation } from "../../src/core/simulation";
import { gallopPose, hoofHeight, strideLength } from "../../src/rendering/pose";
import type { Command, GameState } from "../../src/core/types";

function attack(state: GameState, ids: number[], targetId: number): Command {
  const seq = state.lastCommandSeq + 1;
  return { id: `a${seq}`, seq, tick: state.tick, player: 0, type: "Attack", entityIds: ids, target: { entityId: targetId } };
}

describe("P10 ajuste: el ataque no se reinicia al repetir la orden", () => {
  it("repetir Attack sobre el mismo blanco conserva el trabajo y la ruta en curso", () => {
    const state = createBattleState(1);
    const soldier = state.units.find((u) => u.owner === 0 && u.kind === "soldier")!;
    const foes = state.units.filter((u) => u.owner === 1 && u.kind === "soldier");
    stepSimulation(state, [attack(state, [soldier.id], foes[0]!.id)]);
    for (let i = 0; i < 20; i++) stepSimulation(state, []);
    const job = soldier.job;
    const path = soldier.path;
    expect(job?.type).toBe("attack");
    expect(soldier.task).toBe("moving");

    stepSimulation(state, [attack(state, [soldier.id], foes[0]!.id)]);
    expect(soldier.job).toBe(job);
    expect(soldier.path.length).toBeGreaterThan(0);
    expect(soldier.path).toBe(path);
  });

  it("un blanco distinto sí sustituye la orden", () => {
    const state = createBattleState(1);
    const soldier = state.units.find((u) => u.owner === 0 && u.kind === "soldier")!;
    const foes = state.units.filter((u) => u.owner === 1 && u.kind === "soldier");
    stepSimulation(state, [attack(state, [soldier.id], foes[0]!.id)]);
    stepSimulation(state, [attack(state, [soldier.id], foes[1]!.id)]);
    expect(soldier.job).toMatchObject({ type: "attack", targetId: foes[1]!.id });
  });
});

describe("P10 ajuste: el caballo no flota al avanzar", () => {
  it("la zancada se acorta al ir más despacio y llega al máximo a galope", () => {
    expect(strideLength(0.5)).toBeLessThan(strideLength(0.75));
    expect(strideLength(0.75)).toBeLessThan(strideLength(1));
    expect(strideLength(1)).toBeCloseTo(2.3, 5);
    expect(strideLength(0.2)).toBe(strideLength(0.5));
  });

  it("a medio paso las patas ya dan la zancada completa (la amplitud no se reduce a la mitad)", () => {
    const swing = (gait: number): number => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 100; i++) {
        const leg = gallopPose(i / 100, gait).legs[0];
        lo = Math.min(lo, leg.upper);
        hi = Math.max(hi, leg.upper);
      }
      return hi - lo;
    };
    expect(swing(0.5)).toBeCloseTo(swing(1), 5);
    expect(swing(0.5)).toBeGreaterThan(0.8);
    expect(swing(0)).toBeLessThan(0.05);
  });

  it("el casco de apoyo recorre lo que avanza el cuerpo: el cuerpo no se desliza sobre patas casi quietas", () => {
    // Recorrido horizontal del casco delantero durante el apoyo (30 % del ciclo) frente a lo que avanza el cuerpo en ese tramo.
    // Se comprueba al ritmo de la formación (la mitad de la velocidad máxima), que es donde se veía flotar.
    const reach = (leg: { upper: number; lower: number }): number => 0.26 * Math.sin(leg.upper) + 0.25 * Math.sin(leg.upper + leg.lower);
    const start = gallopPose(0.5, 0.5).legs[0];
    const end = gallopPose(0.8, 0.5).legs[0];
    const sweep = Math.abs(reach(start) - reach(end));
    const advance = 0.3 * strideLength(0.5);
    expect(sweep / advance).toBeGreaterThan(0.85);
    expect(sweep / advance).toBeLessThan(1.2);
  });

  it("ningún casco se hunde bajo el suelo al trote", () => {
    for (let i = 0; i < 200; i++) {
      const p = gallopPose(i / 200, 0.5);
      for (const leg of p.legs) expect(hoofHeight(leg, p.bob)).toBeGreaterThan(-0.06);
    }
  });
});
