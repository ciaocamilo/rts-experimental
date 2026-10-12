import { BALANCE, type BuildingKind, type UnitKind } from "../content/balance";
import type { EntityId, GameState } from "../core/types";
import { combatLabel, describeSelection, type Selection, type SelectionInfo, type Side } from "../input/selection";

export interface PanelActions {
  build(kind: BuildingKind): void;
  train(buildingId: EntityId, kind: UnitKind): void;
  cancelTraining(buildingId: EntityId, itemId: EntityId): void;
  cancelBuild(siteId: EntityId): void;
  stop(unitIds: EntityId[]): void;
}

const HUMAN = 0;
const UNIT_NAME: Record<UnitKind, string> = { villager: "aldeano", soldier: "soldado", archer: "arquero" };
const UNIT_PLURAL: Record<UnitKind, string> = { villager: "aldeanos", soldier: "soldados", archer: "arqueros" };
const BUILDING_NAME: Record<BuildingKind, string> = { townCenter: "centro urbano", house: "casa", barracks: "cuartel", tower: "torre" };
const RESOURCES = ["food", "wood", "stone"] as const;
type Resource = (typeof RESOURCES)[number];
type Cost = { food: number; wood: number; stone: number };

/** Símbolo del bando, además del color: anillo (jugador), rombo (enemigo), hoja (naturaleza). */
const SIDE_SYMBOL: Record<Side, string> = { player: "○", enemy: "◇", nature: "♣" };

/** Color de la barra de vida por umbral, igual que las barras sobre las entidades. */
export function lifeColor(ratio: number): string {
  return ratio > 0.5 ? "#4ade80" : ratio > 0.25 ? "#facc15" : "#ef4444";
}

/** Elementos de la ficha de información; todo el texto entra por `textContent`. */
interface InfoCard {
  card: HTMLElement;
  name: HTMLElement;
  side: HTMLElement;
  vital: HTMLElement;
  vitalFill: HTMLElement;
  vitalText: HTMLElement;
  stats: HTMLElement;
  attackBox: HTMLElement;
  attackValue: HTMLElement;
  rangeBox: HTMLElement;
  rangeValue: HTMLElement;
  work: HTMLElement;
  workFill: HTMLElement;
  lines: HTMLElement;
  text: HTMLElement;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent?.append(node);
  return node;
}

/** Iconos en línea (24 × 24, `currentColor`); texto estático propio, sin datos del usuario. */
const ICONS: Record<string, string> = {
  house: '<path d="M3 12 12 4l9 8h-2.5v8h-13v-8z"/>',
  barracks: '<path d="M3 20V9l9-5 9 5v11h-6v-6H9v6z"/><path d="M12 4V1h4v2h-4" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  tower: '<path d="M7 21V8H5V3h3v2h2V3h4v2h2V3h3v5h-2v13z"/>',
  villager: '<circle cx="12" cy="7" r="3"/><path d="M5 21c0-5 3-8 7-8s7 3 7 8z"/><path d="M6 6h12" stroke="currentColor" stroke-width="2"/>',
  soldier: '<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/>',
  archer: '<path d="M6 3c8 2 12 8 12 9s-4 7-12 9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 12h15m-3-3 3 3-3 3" fill="none" stroke="currentColor" stroke-width="2"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  sword: '<g fill="none" stroke="currentColor" stroke-linecap="round"><path d="M20 4 10 14" stroke-width="2.8"/><path d="M6.5 10.5l7 7" stroke-width="2.4"/><path d="M9 15 4.5 19.5" stroke-width="3"/></g>',
  bow: '<path d="M6 3c8 2 12 8 12 9s-4 7-12 9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 12h15m-3-3 3 3-3 3" fill="none" stroke="currentColor" stroke-width="2"/>',
  cancel: '<path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="3"/>',
};

function icon(name: string, size = 22): HTMLElement {
  const span = document.createElement("span");
  span.className = "ico";
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
  return span;
}

/** Casilla de una estadística: icono y valor. */
function statBox(parent: HTMLElement, iconName: string): { box: HTMLElement; value: HTMLElement } {
  const box = el("span", "stat", parent);
  const ico = icon(iconName, 16);
  ico.className = "stat-ico";
  box.append(ico);
  return { box, value: el("b", "", box) };
}

/** Texto de un coste para la descripción accesible del botón. */
function costText(cost: Cost): string {
  const parts: string[] = [];
  if (cost.food > 0) parts.push(`${cost.food} comida`);
  if (cost.wood > 0) parts.push(`${cost.wood} madera`);
  if (cost.stone > 0) parts.push(`${cost.stone} piedra`);
  return parts.join(" + ") || "gratis";
}

/**
 * Barra de acciones (DOM): zona de información y zona de acciones. Solo traduce clics en intenciones;
 * las reglas y validaciones viven en el núcleo. La estructura se reconstruye únicamente cuando cambia,
 * para no destruir botones bajo el cursor; el estado de coste insuficiente se actualiza en el sitio.
 */
export class CommandPanel {
  private signature = "";
  private infoText = "";
  private infoKey = "";
  private readonly card: InfoCard | null;
  /** Se invoca al cambiar la entidad descrita (o con `null` si no hay ninguna) para dibujar su retrato. */
  onInfo: ((info: SelectionInfo | null) => void) | null = null;
  private readonly progress = new Map<string, HTMLElement>();
  private readonly bars = new Map<string, HTMLElement>();
  private readonly costed: { button: HTMLButtonElement; cost: Cost; short: boolean; chips: Map<Resource, HTMLElement> }[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: PanelActions,
    private readonly infoRoot: HTMLElement | null = null,
  ) {
    this.card = infoRoot ? this.buildCard(infoRoot) : null;
    root.addEventListener("click", (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
      if (!button || button.disabled) return;
      const [act, a, b] = (button.dataset["act"] ?? "").split(":");
      if (act === "build") this.actions.build(a as BuildingKind);
      else if (act === "train") this.actions.train(Number(a), b as UnitKind);
      else if (act === "cancelq") this.actions.cancelTraining(Number(a), Number(b));
      else if (act === "cancelsite") this.actions.cancelBuild(Number(a));
      else if (act === "stop") this.actions.stop((a ?? "").split(",").map(Number));
    });
  }

  refresh(state: GameState, selection: Selection, placing: BuildingKind | null, paused: boolean): void {
    const hasVillager = state.units.some((u) => u.owner === HUMAN && u.kind === "villager" && selection.units.has(u.id));
    const building = state.buildings.find((b) => b.id === selection.inspected && b.owner === HUMAN) ?? null;
    const military = state.units.filter((u) => u.owner === HUMAN && u.kind !== "villager" && selection.units.has(u.id)).map((u) => u.id);

    const signature = [
      paused ? "P" : "-",
      hasVillager ? `V:${placing ?? ""}` : "",
      military.length > 0 ? `M:${military.join(",")}` : "",
      building ? `B:${building.id}:${building.complete}:${building.queue.map((q) => q.id).join(",")}` : "",
    ].join("|");

    if (signature !== this.signature) {
      this.signature = signature;
      this.rebuild(hasVillager, military, building, placing, paused);
    }
    this.updateAffordability(state);
    this.updateProgress(building);
    this.updateInfo(state, selection);
  }

  private buildCard(infoRoot: HTMLElement): InfoCard {
    infoRoot.replaceChildren();
    const card = el("div", "info-card", infoRoot);
    card.hidden = true;
    const canvas = el("canvas", "", card);
    canvas.id = "portrait";
    canvas.width = canvas.height = 224;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Retrato de la selección");
    const data = el("div", "info-data", card);
    const name = el("div", "info-name", data);
    const side = el("div", "info-side", data);
    const vital = el("div", "info-vital", data);
    const vitalFill = el("i", "", el("span", "vbar", vital));
    const vitalText = el("span", "vtext", vital);
    const stats = el("div", "info-stats", data);
    stats.hidden = true;
    const attack = statBox(stats, "sword");
    const range = statBox(stats, "bow");
    const work = el("div", "info-vital work", data);
    const workFill = el("i", "", el("span", "vbar", work));
    work.hidden = true;
    const lines = el("div", "info-lines", data);
    const text = el("div", "info-text", infoRoot);
    return { card, name, side, vital, vitalFill, vitalText, stats, attackBox: attack.box, attackValue: attack.value, rangeBox: range.box, rangeValue: range.value, work, workFill, lines, text };
  }

  private updateInfo(state: GameState, selection: Selection): void {
    const c = this.card;
    if (!c || !this.infoRoot) return;
    const id = selection.inspected ?? (selection.units.size === 1 ? [...selection.units][0]! : null);
    const info = id === null ? null : describeSelection(state, id, HUMAN);
    if (info) {
      const key = [info.id, info.name, info.side, info.barLabel, info.ratio.toFixed(3), info.progress?.toFixed(3) ?? "", info.combat ? combatLabel(info.combat) : "", info.lines.join("|")].join("~");
      if (key === this.infoKey) {
        this.onInfo?.(info);
        return;
      }
      this.infoKey = key;
      this.infoText = "";
      this.infoRoot.classList.remove("hint");
      c.card.hidden = false;
      c.text.textContent = "";
      c.name.textContent = info.name;
      c.side.textContent = `${SIDE_SYMBOL[info.side]} ${info.sideLabel}`;
      c.side.className = `info-side ${info.side}`;
      const fill = info.barKind === "life" ? lifeColor(info.ratio) : "#c9a85a";
      c.vitalFill.style.width = `${Math.round(info.ratio * 100)}%`;
      c.vitalFill.style.background = fill;
      c.vitalText.textContent = info.barLabel;
      c.stats.hidden = info.combat === null;
      c.stats.title = info.combat ? combatLabel(info.combat) : "";
      c.attackValue.textContent = info.combat ? String(info.combat.attack) : "";
      c.rangeBox.hidden = info.combat?.range == null;
      c.rangeValue.textContent = info.combat?.range == null ? "" : String(info.combat.range).replace(".", ",");
      c.work.hidden = info.progress === null;
      if (info.progress !== null) c.workFill.style.width = `${Math.round(info.progress * 100)}%`;
      c.lines.textContent = info.lines.join("\n");
      c.card.setAttribute("aria-label", `${info.name}, ${info.sideLabel.toLowerCase()}. ${info.barLabel}${info.combat ? `. ${combatLabel(info.combat)}` : ""}`);
      this.onInfo?.(info);
      return;
    }
    let text: string;
    if (selection.units.size > 1) {
      const counts = new Map<UnitKind, number>();
      for (const u of state.units) if (selection.units.has(u.id)) counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1);
      const detail = (["villager", "soldier", "archer"] as const).filter((k) => counts.has(k)).map((k) => `${counts.get(k)} ${UNIT_PLURAL[k]}`);
      text = `${selection.units.size} unidades seleccionadas\n${detail.join(" · ")}`;
    } else text = "Seleccione unidades o un edificio propio";
    if (text === this.infoText) return;
    this.infoText = text;
    this.infoKey = "";
    c.card.hidden = true;
    c.text.textContent = text;
    this.infoRoot.classList.toggle("hint", selection.units.size === 0);
    this.onInfo?.(null);
  }

  /** Atenúa el botón y enrojece la ficha del recurso que falta, sin reconstruir ni deshabilitar. */
  private updateAffordability(state: GameState): void {
    const p = state.players[HUMAN];
    for (const entry of this.costed) {
      const missing = RESOURCES.filter((r) => entry.cost[r] > p[r]);
      const short = missing.length > 0;
      if (short !== entry.short) {
        entry.short = short;
        entry.button.classList.toggle("short", short);
      }
      for (const [r, chip] of entry.chips) {
        const isMissing = missing.includes(r);
        if (chip.classList.contains("missing") !== isMissing) chip.classList.toggle("missing", isMissing);
      }
    }
  }

  private rebuild(hasVillager: boolean, military: EntityId[], building: GameState["buildings"][number] | null, placing: BuildingKind | null, paused: boolean): void {
    this.progress.clear();
    this.bars.clear();
    this.costed.length = 0;
    this.root.replaceChildren();

    if (military.length > 0) {
      const row = this.row(`Militares (${military.length}):`);
      row.append(this.button("Detener", `stop:${military.join(",")}`, paused, "stop", undefined, "cancela la orden actual; si hay un enemigo cerca, el militar libre vuelve a atacarlo"));
    }

    if (hasVillager) {
      const row = this.row("Construir:");
      for (const kind of ["house", "barracks", "tower"] as const) {
        const b = this.button(BUILDING_NAME[kind], `build:${kind}`, paused, kind, BALANCE.buildings[kind].cost);
        if (placing === kind) b.classList.add("active");
        row.append(b);
      }
    }

    if (!building) return;
    const def = BALANCE.buildings[building.kind];
    const title = this.row(`${BUILDING_NAME[building.kind]} #${building.id}`);

    if (!building.complete) {
      const span = document.createElement("span");
      this.progress.set("site", span);
      title.append(span, this.bar("site"), this.button("Cancelar obra", `cancelsite:${building.id}`, paused, "cancel", undefined, "devuelve el 75 % del coste"));
      return;
    }
    if (def.trains.length === 0) {
      const armed = def.weapon ? BALANCE.units[def.weapon] : null;
      title.append(this.text(def.housing > 0 ? `aloja ${def.housing} unidades` : armed ? `dispara flechas (alcance ${armed.range})` : "sin producción"));
      return;
    }
    if (def.weapon) title.append(this.text(`dispara ${def.arrows ?? 1} flechas (alcance ${BALANCE.units[def.weapon].range})`));
    const train = this.row("Entrenar:");
    for (const kind of def.trains) {
      train.append(this.button(UNIT_NAME[kind], `train:${building.id}:${kind}`, paused, kind, BALANCE.units[kind].cost));
    }
    const queue = this.row(`Cola ${building.queue.length}/${BALANCE.economy.queueLimit}:`);
    building.queue.forEach((item, index) => {
      const entry = document.createElement("span");
      entry.className = "queue-item";
      const status = document.createElement("span");
      this.progress.set(`q${item.id}`, status);
      entry.append(icon(item.kind), this.text(`${UNIT_NAME[item.kind]} `), status);
      if (index === 0) {
        entry.classList.add("first");
        entry.append(this.bar(`q${item.id}`));
      }
      entry.append(this.button("", `cancelq:${building.id}:${item.id}`, paused, "cancel", undefined, "cancelar entrenamiento (reembolso completo)", "mini"));
      queue.append(entry);
    });
    if (building.queue.length === 0) queue.append(this.text("vacía"));
  }

  private updateProgress(building: GameState["buildings"][number] | null): void {
    if (!building || this.progress.size === 0) return;
    if (!building.complete) {
      const total = BALANCE.buildings[building.kind].buildTicks;
      const pct = Math.floor((100 * building.buildDone) / total);
      const span = this.progress.get("site");
      if (span) span.textContent = `obra ${pct} % · vida ${building.hp}/${BALANCE.buildings[building.kind].hp}`;
      this.setBar("site", pct);
      return;
    }
    building.queue.forEach((item, index) => {
      const span = this.progress.get(`q${item.id}`);
      if (!span) return;
      const total = BALANCE.units[item.kind].trainTicks;
      if (index > 0) span.textContent = "(en espera)";
      else if (item.remaining === 0) span.textContent = "(lista: sin salida libre)";
      else {
        const pct = Math.floor((100 * (total - item.remaining)) / total);
        span.textContent = `${pct} %`;
        this.setBar(`q${item.id}`, pct);
      }
    });
  }

  private bar(key: string): HTMLElement {
    const track = document.createElement("span");
    track.className = "bar";
    const fill = document.createElement("i");
    track.append(fill);
    this.bars.set(key, fill);
    return track;
  }

  private setBar(key: string, pct: number): void {
    const fill = this.bars.get(key);
    const width = `${Math.min(100, Math.max(0, pct))}%`;
    if (fill && fill.style.width !== width) fill.style.width = width;
  }

  private row(label: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "panel-row";
    row.append(this.text(label));
    this.root.append(row);
    return row;
  }

  private text(content: string): HTMLElement {
    const span = document.createElement("span");
    span.textContent = content;
    return span;
  }

  private button(label: string, act: string, disabled: boolean, iconName: string, cost?: Cost, title?: string, extra?: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `act${extra ? ` ${extra}` : ""}`;
    b.dataset["act"] = act;
    b.disabled = disabled;
    b.append(icon(iconName));
    if (label) {
      const body = document.createElement("span");
      body.className = "lbl";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = label;
      body.append(name);
      if (cost) {
        const costs = document.createElement("span");
        costs.className = "costs";
        const chips = new Map<Resource, HTMLElement>();
        for (const r of RESOURCES) {
          if (cost[r] <= 0) continue;
          const chip = document.createElement("span");
          chip.className = `chip ${r}`;
          chip.textContent = String(cost[r]);
          chips.set(r, chip);
          costs.append(chip);
        }
        body.append(costs);
        this.costed.push({ button: b, cost, short: false, chips });
        b.setAttribute("aria-label", `${label}: ${costText(cost)}`);
      }
      b.append(body);
    } else {
      b.setAttribute("aria-label", title ?? act);
    }
    if (title) b.title = title;
    return b;
  }
}
