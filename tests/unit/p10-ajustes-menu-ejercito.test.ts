import { describe, expect, it } from "vitest";
import { MAP_LAYOUT, MAP_WIDTH, validateMapLayout, type MapLayout } from "../../src/content/map";
import { armyCounts, createBattleState } from "../../src/core/battle";
import { createInitialState } from "../../src/core/state";
import { EXIT_CONFIRM_MS, ExitGuard } from "../../src/ui/exit-guard";

describe("P10-R29 militares iniciales en el modo villa", () => {
  const state = createInitialState(3);

  it("cada bando empieza con un soldado, un arquero, un caballero y un cañón además de sus aldeanos", () => {
    for (const owner of [0, 1] as const) {
      const mine = state.units.filter((u) => u.owner === owner);
      const count = (kind: string): number => mine.filter((u) => u.kind === kind).length;
      expect(count("villager")).toBe(4);
      expect(count("soldier")).toBe(1);
      expect(count("archer")).toBe(1);
      expect(count("knight")).toBe(1);
      expect(count("cannon")).toBe(1);
      expect(mine).toHaveLength(8);
    }
  });

  it("los puestos son simétricos y los ids de aldeanos, nodos y edificios no cambian (los militares van al final)", () => {
    const [a, b] = MAP_LAYOUT.startArmy;
    a.forEach((u, i) => {
      expect(b[i]).toMatchObject({ kind: u.kind, z: u.z });
      expect(b[i]!.x).toBeCloseTo(MAP_WIDTH - u.x, 6);
    });
    const military = state.units.filter((u) => u.kind !== "villager");
    const lastOther = Math.max(...state.buildings.map((x) => x.id), ...state.resourceNodes.map((x) => x.id), ...state.units.filter((u) => u.kind === "villager").map((u) => u.id));
    expect(Math.min(...military.map((u) => u.id))).toBeGreaterThan(lastOther);
  });

  it("el mapa rechaza un militar inicial sobre un edificio o sin simétrico", () => {
    const onTower: MapLayout = { ...MAP_LAYOUT, startArmy: [[{ kind: "soldier", x: 19.5, z: 27.5 }, ...MAP_LAYOUT.startArmy[0].slice(1)], MAP_LAYOUT.startArmy[1]] };
    expect(() => validateMapLayout(onTower)).toThrow(/celda ocupada/);
    const skewed: MapLayout = { ...MAP_LAYOUT, startArmy: [MAP_LAYOUT.startArmy[0], MAP_LAYOUT.startArmy[1].map((u) => ({ ...u, z: u.z + 0.5 }))] };
    expect(() => validateMapLayout(skewed)).toThrow(/sin simétrico/);
    expect(() => validateMapLayout(MAP_LAYOUT)).not.toThrow();
  });

  it("el modo batalla no cambia: 91 unidades por bando", () => {
    const battle = createBattleState(1);
    for (const owner of [0, 1] as const) {
      expect(Object.values(armyCounts(battle, owner)).reduce((a, b) => a + b, 0)).toBe(91);
    }
  });
});

describe("P10-R28 botón «Salir al menú»", () => {
  it("una partida en curso pide confirmar con una segunda pulsación dentro del plazo", () => {
    const guard = new ExitGuard();
    expect(guard.press(1000, false)).toBe(false);
    expect(guard.armed(1000 + EXIT_CONFIRM_MS)).toBe(true);
    expect(guard.press(1000 + EXIT_CONFIRM_MS, false)).toBe(true);
    expect(guard.armed(1000 + EXIT_CONFIRM_MS)).toBe(false);
  });

  it("si vence el plazo hay que volver a confirmar", () => {
    const guard = new ExitGuard();
    guard.press(0, false);
    expect(guard.armed(EXIT_CONFIRM_MS + 1)).toBe(false);
    expect(guard.press(EXIT_CONFIRM_MS + 1, false)).toBe(false);
    expect(guard.press(EXIT_CONFIRM_MS + 2, false)).toBe(true);
  });

  it("con la partida terminada sale a la primera y reset() cancela la confirmación", () => {
    const guard = new ExitGuard();
    expect(guard.press(5, true)).toBe(true);
    guard.press(10, false);
    guard.reset();
    expect(guard.armed(11)).toBe(false);
    expect(guard.press(12, false)).toBe(false);
  });
});
