import { describe, expect, it } from "vitest";
import { BALANCE } from "../../src/content/balance";
import { FLAME_SLOTS } from "../../src/rendering/fire";
import { flameCount } from "../../src/rendering/health";
import { DEATH_FALL_S, DEATH_LINGER_S, deathPose, deathState } from "../../src/rendering/pose";
import { buildWaterGeometry, cornerRadius, rimPoints } from "../../src/rendering/water";

describe("P2-H08 llamas por vida del edificio", () => {
  const flames = (ratio: number): number => flameCount(ratio * 1000, 1000, true);

  it("sin llamas con vida completa y justo por encima del primer umbral", () => {
    expect(flames(1)).toBe(0);
    expect(flames(0.91)).toBe(0);
  });

  it("los umbrales son inclusivos y acumulativos", () => {
    expect(flames(0.9)).toBe(1);
    expect(flames(0.76)).toBe(1);
    expect(flames(0.75)).toBe(2);
    expect(flames(0.5)).toBe(3);
    expect(flames(0.26)).toBe(3);
    expect(flames(0.25)).toBe(4);
    expect(flames(0.06)).toBe(4);
    expect(flames(0.05)).toBe(5);
    expect(flames(0.01)).toBe(5);
  });

  it("las obras y los máximos inválidos no arden", () => {
    expect(flameCount(10, 1000, false)).toBe(0);
    expect(flameCount(10, 0, true)).toBe(0);
    expect(flameCount(10, Number.NaN, true)).toBe(0);
    expect(flameCount(Number.NaN, 1000, true)).toBe(0);
  });

  it("usa los puntos de vida reales de cada tipo y hay una posición por llama", () => {
    for (const kind of ["townCenter", "house", "barracks"] as const) {
      const max = BALANCE.buildings[kind].hp;
      expect(flameCount(max, max, true)).toBe(0);
      expect(flameCount(Math.floor(max * 0.9), max, true)).toBe(1);
      expect(flameCount(1, max, true)).toBe(5);
      expect(FLAME_SLOTS[kind]).toHaveLength(5);
    }
  });
});

describe("P2-H09 cuerpos caídos", () => {
  it("cae durante la caída y queda tendido", () => {
    expect(deathState(0).fall).toBe(0);
    expect(deathState(DEATH_FALL_S / 2).fall).toBeGreaterThan(0);
    expect(deathState(DEATH_FALL_S / 2).fall).toBeLessThan(1);
    expect(deathState(DEATH_FALL_S).fall).toBeCloseTo(1, 6);
    expect(deathState(2).fall).toBe(1);
  });

  it("la caída es monótona", () => {
    let previous = -1;
    for (let age = 0; age <= DEATH_FALL_S; age += 0.01) {
      const { fall } = deathState(age);
      expect(fall).toBeGreaterThanOrEqual(previous);
      previous = fall;
    }
  });

  it("permanece hasta los 5 s y entonces se retira", () => {
    expect(deathState(DEATH_LINGER_S - 0.5)).toMatchObject({ done: false, scale: 1 });
    expect(deathState(DEATH_LINGER_S - 0.01).done).toBe(false);
    expect(deathState(DEATH_LINGER_S - 0.01).scale).toBeLessThan(0.1);
    expect(deathState(DEATH_LINGER_S).done).toBe(true);
    expect(deathState(60).done).toBe(true);
  });

  it("una edad negativa se trata como cero", () => {
    expect(deathState(-3)).toEqual(deathState(0));
  });

  it("la pose caída relaja el arco y las herramientas", () => {
    expect(deathPose(1).bowDraw).toBe(0);
    expect(deathPose(0).armLz).toBeCloseTo(0.08, 6);
    expect(Math.abs(deathPose(1).armRz)).toBeGreaterThan(Math.abs(deathPose(0).armRz));
  });
});

describe("P2-H10 agua orgánica", () => {
  const layers = [
    { offset: 0.3, alpha: 0, shade: [1, 1, 1] },
    { offset: 1.8, alpha: 0.9, shade: [0.7, 0.8, 0.9] },
  ] as const;

  it("el contorno es cerrado y no tiene esquinas de 90 grados", () => {
    const rim = rimPoints(10, 6);
    expect(rim.length).toBeGreaterThan(40);
    const r = cornerRadius(10, 6);
    // El punto de la esquina del rectángulo no pertenece al contorno redondeado.
    for (const p of rim) expect(Math.hypot(Math.abs(p.x) - 5, Math.abs(p.z) - 3)).toBeGreaterThan(r * 0.25);
  });

  it("todos los vértices quedan dentro del rectángulo lógico", () => {
    for (const [w, h] of [[10, 6], [4, 3], [30, 5]] as const) {
      const g = buildWaterGeometry(w, h, 12345, layers, { x: 0, z: 0 }, 0.1);
      const position = g.getAttribute("position");
      for (let i = 0; i < position.count; i++) {
        expect(Number.isFinite(position.getX(i))).toBe(true);
        expect(Math.abs(position.getX(i))).toBeLessThanOrEqual(w / 2 + 1e-6);
        expect(Math.abs(position.getZ(i))).toBeLessThanOrEqual(h / 2 + 1e-6);
      }
    }
  });

  it("el borde es transparente y todas las caras miran hacia arriba", () => {
    const g = buildWaterGeometry(10, 6, 99, layers, { x: 0, z: 0 }, 0.1);
    const color = g.getAttribute("color");
    expect(color.itemSize).toBe(4);
    expect(color.getW(0)).toBe(0);
    const normal = g.getAttribute("normal");
    for (let i = 0; i < normal.count; i++) expect(normal.getY(i)).toBeGreaterThan(0.99);
  });

  it("es determinista por semilla", () => {
    const a = buildWaterGeometry(10, 6, 7, layers, { x: 0, z: 0 }, 0.1).getAttribute("position").array;
    const b = buildWaterGeometry(10, 6, 7, layers, { x: 0, z: 0 }, 0.1).getAttribute("position").array;
    const c = buildWaterGeometry(10, 6, 8, layers, { x: 0, z: 0 }, 0.1).getAttribute("position").array;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });
});
