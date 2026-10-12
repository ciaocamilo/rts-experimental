import { describe, expect, it } from "vitest";
import { BALANCE } from "../../src/content/balance";
import { createFixture } from "../../src/core/fixtures";
import { createInitialState } from "../../src/core/state";
import { describeSelection, SIDE_LABEL } from "../../src/input/selection";
import { framingDistance, PORTRAIT_FOV, PORTRAIT_MARGIN, portraitModelKey } from "../../src/rendering/portrait";
import { lifeColor } from "../../src/ui/command-panel";

describe("P7 ficha de selección", () => {
  const { state } = createFixture("retratos");

  it("describe una unidad propia con nombre, bando y vida", () => {
    const u = state.units.find((x) => x.owner === 0 && x.kind === "soldier")!;
    const info = describeSelection(state, u.id, 0)!;
    expect(info.name).toBe("Soldado");
    expect(info.side).toBe("player");
    expect(info.sideLabel).toBe("JUGADOR");
    expect(info.barLabel).toBe(`Vida ${u.hp} / ${BALANCE.units.soldier.hp}`);
    expect(info.ratio).toBeCloseTo(u.hp / BALANCE.units.soldier.hp, 6);
    expect(info.progress).toBeNull();
  });

  it("marca ENEMIGO a lo del rival y NATURALEZA a los recursos", () => {
    const rival = state.units.find((x) => x.owner === 1)!;
    expect(describeSelection(state, rival.id, 0)!.sideLabel).toBe(SIDE_LABEL.enemy);
    const node = state.resourceNodes[0]!;
    const info = describeSelection(state, node.id, 0)!;
    expect(info.side).toBe("nature");
    expect(info.sideLabel).toBe("NATURALEZA");
    expect(info.barKind).toBe("resource");
  });

  it("nombra los tres recursos y el estado agotado", () => {
    const names = { food: "Arbusto", wood: "Árbol", stone: "Roca" } as const;
    for (const kind of ["food", "wood", "stone"] as const) {
      const node = state.resourceNodes.find((n) => n.kind === kind)!;
      const info = describeSelection(state, node.id, 0)!;
      expect(info.name).toBe(names[kind]);
      expect(info.barLabel).toBe(`Restante ${node.remaining} / ${BALANCE.nodeAmount}`);
    }
    const spent = createInitialState(1, false);
    const node = spent.resourceNodes[0]!;
    node.remaining = 0;
    expect(describeSelection(spent, node.id, 0)!.barLabel).toBe("Agotado");
  });

  it("una obra informa su avance y cambia de aspecto con él", () => {
    const site = state.buildings.find((b) => !b.complete)!;
    const a = describeSelection(state, site.id, 0)!;
    expect(a.name).toBe("Casa");
    expect(a.progress).toBeGreaterThan(0.4);
    expect(a.progress).toBeLessThan(0.5);
    site.buildDone += BALANCE.buildings.house.buildTicks * 0.2;
    expect(describeSelection(state, site.id, 0)!.aspectKey).not.toBe(a.aspectKey);
  });

  it("una entidad inexistente no tiene ficha", () => {
    expect(describeSelection(state, 999999, 0)).toBeNull();
  });

  it("el nombre en español de todos los edificios", () => {
    const initial = createInitialState(1);
    const names = new Set(initial.buildings.map((b) => describeSelection(initial, b.id, 0)!.name));
    expect(names).toContain("Centro urbano");
    expect(names).toContain("Casa");
    expect(names).toContain("Torre");
  });

  it("clave de modelo: la vida no la cambia, el bando sí", () => {
    const own = state.units.find((x) => x.owner === 0 && x.kind === "archer")!;
    const before = portraitModelKey(describeSelection(state, own.id, 0)!);
    own.hp = 1;
    expect(portraitModelKey(describeSelection(state, own.id, 0)!)).toBe(before);
    const rival = state.units.find((x) => x.owner === 1 && x.kind === "archer")!;
    expect(portraitModelKey(describeSelection(state, rival.id, 0)!)).not.toBe(before);
  });
});

describe("P7 encuadre y barra del retrato", () => {
  it("la esfera envolvente cabe en el campo de visión con 12 % de margen", () => {
    const r = 2.5;
    const d = framingDistance(r);
    const half = Math.asin(r / d);
    expect(half).toBeLessThan((PORTRAIT_FOV * Math.PI) / 360);
    expect(Math.tan(half) / Math.tan((PORTRAIT_FOV * Math.PI) / 360)).toBeCloseTo(1 / (1 + PORTRAIT_MARGIN), 1);
  });

  it("el color de vida sigue los umbrales de las barras del mapa", () => {
    expect(lifeColor(1)).toBe("#4ade80");
    expect(lifeColor(0.5)).toBe("#facc15");
    expect(lifeColor(0.25)).toBe("#ef4444");
  });
});
