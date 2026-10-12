import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CUES } from "../../src/audio/voices";
import { BALANCE } from "../../src/content/balance";
import { MAP_DEPTH, MAP_LAYOUT, MAP_WIDTH, homeView } from "../../src/content/map";
import { BALANCE_VERSION, GAME_CREDIT, GAME_NAME, GAME_SUBTITLE } from "../../src/content/versions";
import { addUnit, createInitialState, rollGender } from "../../src/core/state";
import { stepSimulation } from "../../src/core/simulation";
import type { GameState } from "../../src/core/types";
import { CameraRig, INITIAL_ZOOM, ZOOM_MAX, ZOOM_MIN } from "../../src/input/camera-rig";
import { CURSOR_HOTSPOT, CURSOR_SIZE, cursorCss, cursorFor, cursorSvg, resolveRightClick, selectionCaps, type CursorKind } from "../../src/input/cursors";
import { portraitModelKey } from "../../src/rendering/portrait";
import { computePose } from "../../src/rendering/pose";
import { combatLabel, combatStats, describeSelection, emptySelection } from "../../src/input/selection";
import { BRICK_BUTTON_TILE, BRICK_BUTTON_TONES, brickButtonSvg } from "../../src/ui/castle-bar";
import { fullscreenLabel } from "../../src/ui/fullscreen";
import { welcomeContent } from "../../src/ui/welcome";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

function fresh(): GameState {
  return createInitialState(1);
}

function luminance(hex: string, factor = 1): number {
  const channel = (i: number): number => {
    const v = Math.min(255, parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * factor) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string, factorA = 1): number {
  const [hi, lo] = [luminance(a, factorA), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("P8 vida de centros urbanos y torres", () => {
  it("el balance duplica la vida y el estado inicial la refleja en ambos bandos", () => {
    expect(BALANCE_VERSION).toBe("balance-0.7");
    expect(BALANCE.buildings.townCenter.hp).toBe(3000);
    expect(BALANCE.buildings.tower.hp).toBe(1600);
    const state = createInitialState(1);
    for (const owner of [0, 1] as const) {
      const centers = state.buildings.filter((b) => b.owner === owner && b.kind === "townCenter");
      const towers = state.buildings.filter((b) => b.owner === owner && b.kind === "tower");
      expect(centers.length).toBeGreaterThan(0);
      expect(towers.length).toBeGreaterThan(0);
      for (const b of centers) expect(b.hp).toBe(3000);
      for (const b of towers) expect(b.hp).toBe(1600);
    }
  });
});

describe("P8 aldeano: daño y sonidos", () => {
  it("el aldeano golpea con 5 y sigue siendo el más débil de los combatientes", () => {
    expect(BALANCE.units.villager.damage).toBe(5);
    expect(BALANCE.units.villager.damage).toBeLessThan(BALANCE.units.archer.damage);
    expect(BALANCE.units.villager.damage).toBeLessThan(BALANCE.units.soldier.damage);
  });

  it("el puñetazo y la creación de unidades se oyen más fuerte que antes", () => {
    expect(CUES.blow.gain).toBeGreaterThan(0.6);
    expect(CUES.door.gain).toBeGreaterThanOrEqual(1.3);
  });
});

describe("P8 cámara inicial", () => {
  it("arranca con zoom dentro de los límites, centrada en el centro urbano del jugador", () => {
    expect(INITIAL_ZOOM).toBeGreaterThan(1);
    expect(INITIAL_ZOOM).toBe(3);
    expect(ZOOM_MAX).toBeGreaterThan(5.5);
    expect(INITIAL_ZOOM).toBeLessThanOrEqual(ZOOM_MAX);
    const home = homeView(MAP_LAYOUT);
    const tc = MAP_LAYOUT.townCenters[0];
    expect(home.x).toBeGreaterThan(tc.x);
    expect(home.z).toBeGreaterThan(tc.z);
    const rig = new CameraRig(MAP_WIDTH, MAP_DEPTH, { ...home, zoom: INITIAL_ZOOM });
    expect([rig.x, rig.z, rig.zoom]).toEqual([home.x, home.z, INITIAL_ZOOM]);
  });

  it("reset restituye posición y zoom, y limita al mapa y a los zoom permitidos", () => {
    const rig = new CameraRig(MAP_WIDTH, MAP_DEPTH);
    rig.zoomBy(-2000);
    rig.centerOn(100, 50);
    rig.reset({ x: 20, z: 30, zoom: INITIAL_ZOOM });
    expect([rig.x, rig.z, rig.zoom]).toEqual([20, 30, INITIAL_ZOOM]);
    rig.reset({ x: -5, z: MAP_DEPTH + 40, zoom: 99 });
    expect(rig.x).toBe(0);
    expect(rig.z).toBe(MAP_DEPTH);
    expect(rig.zoom).toBe(ZOOM_MAX);
    rig.reset({ x: 1, z: 1 });
    expect(rig.zoom).toBe(1);
    expect(ZOOM_MIN).toBeLessThan(1);
  });
});

describe("P8 ataque y alcance en la ficha", () => {
  const state = createInitialState(1);
  const info = (id: number) => describeSelection(state, id, 0)!;

  it("las unidades muestran el ataque y el alcance de su balance", () => {
    const villager = state.units.find((u) => u.kind === "villager")!;
    expect(info(villager.id).combat).toEqual({ attack: BALANCE.units.villager.damage, range: null });
    const soldier = { ...villager, id: 9001, kind: "soldier" as const };
    const archer = { ...villager, id: 9002, kind: "archer" as const };
    const armed = { ...state, units: [...state.units, soldier, archer] } as GameState;
    expect(describeSelection(armed, soldier.id, 0)!.combat).toEqual({ attack: 10, range: null });
    expect(describeSelection(armed, archer.id, 0)!.combat).toEqual({ attack: 8, range: 5 });
  });

  it("torre y centro urbano completos atacan; casa, cuartel, recursos y obras no", () => {
    const own = (kind: string) => state.buildings.find((b) => b.owner === 0 && b.kind === kind)!;
    expect(info(own("tower").id).combat).toEqual({ attack: 8, range: 5 });
    expect(info(own("townCenter").id).combat).toEqual({ attack: 24, range: 5 });
    expect(info(own("house").id).combat).toBeNull();
    const site = { ...own("tower"), id: 9003, complete: false, buildDone: 10 };
    const building = { ...state, buildings: [...state.buildings, site] } as GameState;
    expect(describeSelection(building, site.id, 0)!.combat).toBeNull();
    expect(info(state.resourceNodes[0]!.id).combat).toBeNull();
  });

  it("el texto sale del balance y la ficha lo muestra bajo la vida", () => {
    expect(combatStats("archer")).toEqual({ attack: BALANCE.units.archer.damage, range: BALANCE.units.archer.range });
    expect(combatLabel({ attack: 10, range: null })).toBe("Ataque 10");
    expect(combatLabel({ attack: 8, range: 5 })).toBe("Ataque 8, alcance 5");
    expect(html).toContain("#info .info-stats");
    const panel = readFileSync(new URL("../../src/ui/command-panel.ts", import.meta.url), "utf8");
    expect(panel.indexOf('"vtext"')).toBeLessThan(panel.indexOf('"info-stats"'));
    expect(panel.indexOf('"info-stats"')).toBeLessThan(panel.indexOf('"info-lines"'));
  });
});

describe("P8 cursores de acción", () => {
  const state = fresh();
  const villager = state.units.find((u) => u.owner === 0 && u.kind === "villager")!;
  const foeUnit = state.units.find((u) => u.owner === 1)!;
  const foeBuilding = state.buildings.find((b) => b.owner === 1)!;
  const ownBuilding = state.buildings.find((b) => b.owner === 0)!;
  const nodeOf = (kind: "wood" | "food" | "stone") => state.resourceNodes.find((n) => n.kind === kind)!;
  const villagers = { villagers: true, military: false };
  const military = { villagers: false, military: true };
  const nobody = { villagers: false, military: false };

  it("cada recurso se asocia a su cursor y exige aldeanos", () => {
    const expected: Record<"wood" | "food" | "stone", CursorKind> = { wood: "chop", food: "forage", stone: "mine" };
    for (const kind of ["wood", "food", "stone"] as const) {
      const action = resolveRightClick(state, [nodeOf(kind).id], 0);
      expect(action?.kind).toBe("gather");
      expect(cursorFor(action, villagers)).toBe(expected[kind]);
      expect(cursorFor(action, military)).toBeNull();
      expect(cursorFor(action, nobody)).toBeNull();
    }
  });

  it("un recurso agotado no muestra cursor", () => {
    const node = { ...nodeOf("wood"), remaining: 0 };
    expect(cursorFor({ kind: "gather", node }, villagers)).toBeNull();
  });

  it("el cursor de ataque exige unidades que ataquen (militares o aldeanos) y un objetivo enemigo vivo", () => {
    for (const target of [foeUnit.id, foeBuilding.id]) {
      const action = resolveRightClick(state, [target], 0);
      expect(action?.kind).toBe("attack");
      expect(cursorFor(action, military)).toBe("attack");
      expect(cursorFor(action, villagers)).toBe("attack");
      expect(cursorFor(action, nobody)).toBeNull();
    }
    expect(cursorFor({ kind: "attack", target: { ...foeBuilding, hp: 0 } }, military)).toBeNull();
  });

  it("lo propio, el suelo y las obras terminadas no dan acción; las unidades propias que tapan se ignoran", () => {
    expect(resolveRightClick(state, [], 0)).toBeNull();
    expect(resolveRightClick(state, [villager.id], 0)).toBeNull();
    expect(resolveRightClick(state, [ownBuilding.id], 0)).toBeNull();
    expect(resolveRightClick(state, [villager.id, nodeOf("wood").id], 0)?.kind).toBe("gather");
    expect(cursorFor(null, villagers)).toBeNull();
  });

  it("una obra propia sin terminar se reanuda y no cambia el cursor", () => {
    const site = { ...ownBuilding, complete: false };
    const withSite = { ...state, buildings: [...state.buildings, site] } as GameState;
    const action = resolveRightClick(withSite, [site.id], 0);
    expect(action?.kind).toBe("resume");
    expect(cursorFor(action, villagers)).toBeNull();
  });

  it("selectionCaps distingue aldeanos y militares de la selección propia", () => {
    const selection = emptySelection();
    expect(selectionCaps(state, selection, 0)).toEqual(nobody);
    selection.units.add(villager.id);
    expect(selectionCaps(state, selection, 0)).toEqual(villagers);
    selection.units.clear();
    selection.units.add(foeUnit.id);
    expect(selectionCaps(state, selection, 0)).toEqual(nobody);
    const army = { ...state, units: state.units.map((u) => (u.id === villager.id ? { ...u, kind: "soldier" as const } : u)) } as GameState;
    const picked = emptySelection();
    picked.units.add(villager.id);
    expect(selectionCaps(army, picked, 0)).toEqual(military);
  });

  it("las imágenes son SVG de 32 × 32 con punto activo dentro y reserva", () => {
    for (const kind of ["chop", "forage", "mine", "attack"] as const) {
      const svg = cursorSvg(kind);
      expect(svg).toContain(`width='${CURSOR_SIZE}' height='${CURSOR_SIZE}'`);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      const { x, y } = CURSOR_HOTSPOT[kind];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(CURSOR_SIZE);
      expect(y).toBeLessThan(CURSOR_SIZE);
      const css = cursorCss(kind);
      expect(css.startsWith('url("data:image/svg+xml,')).toBe(true);
      expect(css).toContain(`") ${x} ${y}, `);
      expect(css).toMatch(/, (pointer|crosshair)$/);
      expect(css).not.toContain("<");
    }
  });
});

describe("P8 botones de ladrillo", () => {
  it("el texto crema mantiene contraste mínimo 4,5:1 sobre cada tono, también al pasar el ratón", () => {
    expect(BRICK_BUTTON_TONES).toHaveLength(8);
    for (const tone of BRICK_BUTTON_TONES) {
      expect(contrast("#f6e7c8", tone)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tone, "#f6e7c8", 1.08)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("la tesela tiene el tamaño declarado en la hoja de estilos y usa todos los tonos", () => {
    const svg = brickButtonSvg();
    expect(svg).toContain(`width='${BRICK_BUTTON_TILE.width}' height='${BRICK_BUTTON_TILE.height}'`);
    expect(html).toContain(`${BRICK_BUTTON_TILE.width}px ${BRICK_BUTTON_TILE.height}px`);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(new Set(BRICK_BUTTON_TONES.filter((tone) => svg.includes(tone))).size).toBeGreaterThanOrEqual(4);
  });
});

describe("P8 pantalla completa y bienvenida", () => {
  it("las etiquetas del botón cambian con el estado", () => {
    expect(fullscreenLabel(false)).toBe("Pantalla completa (F)");
    expect(fullscreenLabel(true)).toBe("Salir de pantalla completa (F)");
  });

  it("la bienvenida usa el nombre, el subtítulo y el crédito, sin casilla de «no volver a mostrar»", () => {
    const content = welcomeContent();
    expect(content.title).toBe(GAME_NAME);
    expect(content.subtitle).toBe(GAME_SUBTITLE);
    expect(content.credit).toBe(GAME_CREDIT);
    expect(content.tips.length).toBeGreaterThanOrEqual(4);
    expect(content.startLabel).toBe("Comenzar");
    const all = JSON.stringify(content).toLowerCase();
    expect(all).not.toContain("volver a mostrar");
    expect(html.toLowerCase()).not.toContain("volver a mostrar");
    expect(html).not.toMatch(/type="checkbox"/);
  });
});

describe("P8 identidad en index.html", () => {
  it("título de pestaña, icono y ventanas", () => {
    expect(html).toContain("<title>RTS Camilus - Juego experimental</title>");
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/);
    const favicon = readFileSync(new URL("../../public/favicon.svg", import.meta.url), "utf8");
    expect(favicon.startsWith("<svg") || favicon.startsWith("<?xml")).toBe(true);
    expect(html).toMatch(/<div id="welcome"[^>]*hidden/);
    expect(html).toMatch(/<button id="btn-fullscreen"/);
  });

  it("la ayuda arranca cerrada", () => {
    expect(html).toMatch(/<div id="help">/);
    expect(html).not.toMatch(/<div id="help" class="visible">/);
  });
});

describe("P8 aldeanas", () => {
  it("cada bando empieza con dos aldeanos y dos aldeanas", () => {
    const state = createInitialState(1);
    for (const owner of [0, 1] as const) {
      const villagers = state.units.filter((u) => u.owner === owner && u.kind === "villager");
      expect(villagers).toHaveLength(BALANCE.start.villagers);
      expect(villagers.filter((u) => u.gender === "male")).toHaveLength(2);
      expect(villagers.filter((u) => u.gender === "female")).toHaveLength(2);
    }
  });

  it("el sorteo depende solo de semilla e id y reparte aproximadamente mitad y mitad", () => {
    expect(rollGender(7, 12)).toBe(rollGender(7, 12));
    let female = 0;
    const total = 2000;
    for (let id = 1; id <= total; id++) if (rollGender(3, id) === "female") female++;
    expect(female / total).toBeGreaterThan(0.45);
    expect(female / total).toBeLessThan(0.55);
    const seeds = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => rollGender(seed, 20)));
    expect(seeds.size).toBe(2);
  });

  it("los aldeanos entrenados en el centro urbano salen con el género sorteado; los militares son hombres", () => {
    const state = createInitialState(9);
    state.players[0]!.food = 5000;
    state.players[0]!.wood = 5000;
    const tc = state.buildings.find((b) => b.owner === 0 && b.kind === "townCenter")!;
    const firstId = state.nextEntityId;
    stepSimulation(state, [{ id: "t", seq: 1, tick: 0, player: 0, type: "Train", entityIds: [tc.id], kind: "villager" }]);
    for (let i = 0; i < 1200 && state.units.every((u) => u.id < firstId); i++) stepSimulation(state);
    const born = state.units.find((u) => u.id >= firstId)!;
    expect(born.kind).toBe("villager");
    expect(born.gender).toBe(rollGender(9, born.id));
    expect(addUnit(state, 0, "soldier", 20, 20).gender).toBe("male");
  });

  it("la ficha y el retrato distinguen a la aldeana", () => {
    const state = createInitialState(1);
    const male = state.units.find((u) => u.owner === 0 && u.gender === "male")!;
    const female = state.units.find((u) => u.owner === 0 && u.gender === "female")!;
    const a = describeSelection(state, male.id, 0)!;
    const b = describeSelection(state, female.id, 0)!;
    expect(a.name).toBe("Aldeano");
    expect(b.name).toBe("Aldeana");
    expect(b.gender).toBe("female");
    expect(b.aspectKey).not.toBe(a.aspectKey);
    expect(portraitModelKey(b)).not.toBe(portraitModelKey(a));
    expect(b.combat).toEqual(a.combat);
  });
});

describe("P8 aldeanos en combate", () => {
  const dummyWorld = (): GameState => {
    const state = createInitialState(1);
    state.units.length = 0;
    return state;
  };

  it("el aldeano ordenado a atacar golpea al enemigo y su pose de golpe no es la de reposo ni la de trabajo", () => {
    const state = dummyWorld();
    const villager = addUnit(state, 0, "villager", 20, 20);
    const enemy = addUnit(state, 1, "soldier", 21, 20);
    enemy.hp = 1000;
    stepSimulation(state, [{ id: "c1", seq: 1, tick: state.tick, player: 0, type: "Attack", entityIds: [villager.id], target: { entityId: enemy.id } }]);
    for (let i = 0; i < 120; i++) stepSimulation(state);
    expect(enemy.hp).toBeLessThan(1000);
    expect(enemy.hp % BALANCE.units.villager.damage).toBe(1000 % BALANCE.units.villager.damage);

    const rest = computePose({ role: "villager", t: 0, walking: false, work: null, carrying: false, combatPhase: null });
    const swing = (p: number) => computePose({ role: "villager", t: 0, walking: false, work: "wood", carrying: false, combatPhase: p });
    expect(swing(0).armRx).not.toBeCloseTo(rest.armRx, 1);
    expect(swing(0.3).armRx).toBeGreaterThan(0);
    expect(swing(0.3).torsoPitch).toBeGreaterThan(0.2);
    // El golpe domina sobre un trabajo anterior: no sigue talando.
    expect(swing(0.3).armLx).toBe(-0.7);
  });
});

describe("P8 cámara: borde inferior de la pantalla", () => {
  it("el desplazamiento hacia abajo usa el borde de la pantalla y la barra inferior lo permite", () => {
    const controller = readFileSync(new URL("../../src/input/controller.ts", import.meta.url), "utf8");
    expect(controller).toContain("window.innerHeight");
    expect(controller).toContain("#bottom-bar");
  });
});
