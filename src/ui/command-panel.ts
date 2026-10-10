import { BALANCE, type BuildingKind, type UnitKind } from "../content/balance";
import type { EntityId, GameState } from "../core/types";
import type { Selection } from "../input/selection";

export interface PanelActions {
  build(kind: BuildingKind): void;
  train(buildingId: EntityId, kind: UnitKind): void;
  cancelTraining(buildingId: EntityId, itemId: EntityId): void;
  cancelBuild(siteId: EntityId): void;
  stop(unitIds: EntityId[]): void;
}

const HUMAN = 0;
const UNIT_NAME: Record<UnitKind, string> = { villager: "aldeano", soldier: "soldado", archer: "arquero" };
const BUILDING_NAME: Record<BuildingKind, string> = { townCenter: "centro urbano", house: "casa", barracks: "cuartel" };

function costText(cost: { food: number; wood: number }): string {
  const parts: string[] = [];
  if (cost.food > 0) parts.push(`${cost.food} alimento`);
  if (cost.wood > 0) parts.push(`${cost.wood} madera`);
  return parts.join(" + ") || "gratis";
}

/**
 * Panel de órdenes (DOM). Solo traduce clics en intenciones; las reglas y validaciones viven en el núcleo.
 * La estructura se reconstruye únicamente cuando cambia, para no destruir botones bajo el cursor.
 */
export class CommandPanel {
  private signature = "";
  private readonly progress = new Map<string, HTMLElement>();

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: PanelActions,
  ) {
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
    this.updateProgress(building);
  }

  private rebuild(hasVillager: boolean, military: EntityId[], building: GameState["buildings"][number] | null, placing: BuildingKind | null, paused: boolean): void {
    this.progress.clear();
    this.root.replaceChildren();
    this.root.style.display = hasVillager || military.length > 0 || building ? "flex" : "none";

    if (military.length > 0) {
      const row = this.row(`Militares (${military.length}):`);
      row.append(this.button("Detener", `stop:${military.join(",")}`, paused, "cancela la orden actual; si hay un enemigo cerca, el militar libre vuelve a atacarlo"));
    }

    if (hasVillager) {
      const row = this.row("Construir:");
      for (const kind of ["house", "barracks"] as const) {
        const def = BALANCE.buildings[kind];
        const b = this.button(`${BUILDING_NAME[kind]} · ${costText(def.cost)}`, `build:${kind}`, paused);
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
      title.append(span, this.button("cancelar obra (devuelve 75 %)", `cancelsite:${building.id}`, paused));
      return;
    }
    if (def.trains.length === 0) {
      title.append(this.text(def.housing > 0 ? `aloja ${def.housing} unidades` : "sin producción"));
      return;
    }
    const train = this.row("Entrenar:");
    for (const kind of def.trains) {
      const u = BALANCE.units[kind];
      train.append(this.button(`${UNIT_NAME[kind]} · ${costText(u.cost)}`, `train:${building.id}:${kind}`, paused));
    }
    const queue = this.row(`Cola ${building.queue.length}/${BALANCE.economy.queueLimit}:`);
    building.queue.forEach((item, index) => {
      const entry = document.createElement("span");
      entry.className = "queue-item";
      const status = document.createElement("span");
      this.progress.set(`q${item.id}`, status);
      entry.append(this.text(`${UNIT_NAME[item.kind]} `), status, this.button("✕", `cancelq:${building.id}:${item.id}`, paused, "cancelar entrenamiento (reembolso completo)"));
      queue.append(entry);
      if (index === 0) entry.classList.add("first");
    });
    if (building.queue.length === 0) queue.append(this.text("vacía"));
  }

  private updateProgress(building: GameState["buildings"][number] | null): void {
    if (!building || this.progress.size === 0) return;
    if (!building.complete) {
      const total = BALANCE.buildings[building.kind].buildTicks;
      const span = this.progress.get("site");
      if (span) span.textContent = `obra ${Math.floor((100 * building.buildDone) / total)} % · vida ${building.hp}/${BALANCE.buildings[building.kind].hp}`;
      return;
    }
    building.queue.forEach((item, index) => {
      const span = this.progress.get(`q${item.id}`);
      if (!span) return;
      const total = BALANCE.units[item.kind].trainTicks;
      if (index > 0) span.textContent = "(en espera)";
      else if (item.remaining === 0) span.textContent = "(lista: sin salida libre)";
      else span.textContent = `${Math.floor((100 * (total - item.remaining)) / total)} %`;
    });
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

  private button(label: string, act: string, disabled: boolean, title?: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.dataset["act"] = act;
    b.disabled = disabled;
    if (title) b.title = title;
    return b;
  }
}
