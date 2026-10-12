import type { GameSession } from "../app/session";
import { BALANCE, type BuildingKind } from "../content/balance";
import { currentGrid } from "../core/obstacles";
import { previewPlacement } from "../core/placement";
import type { Command } from "../core/types";
import type { SceneView } from "../rendering/scene-view";
import { REJECT_TEXT } from "../ui/messages";
import { type CameraRig, EDGE_SPEED_FACTOR, edgePan, type PanKeys } from "./camera-rig";
import { type CursorKind, cursorCss, cursorFor, resolveRightClick, selectionCaps } from "./cursors";
import { boxSelect, clearSelection, clickSelect, type Selection } from "./selection";

const HUMAN = 0 as const;
const DRAG_THRESHOLD_PX = 5;
/** Intervalo máximo entre reevaluaciones del cursor con el ratón quieto (cambios de selección o unidades en movimiento). */
const CURSOR_REFRESH_SEC = 0.1;
const BUILDING_NAME: Record<BuildingKind, string> = { townCenter: "centro urbano", house: "casa", barracks: "cuartel", tower: "torre" };

const KEY_MAP: Record<string, keyof PanKeys> = {
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
};

export interface InputHooks {
  getSession(): GameSession;
  selection: Selection;
  /** Aviso temporal; el tipo se deduce del texto si no se indica. */
  notify(text: string): void;
  /** Aviso fijo con id (se retira con clearSticky). */
  sticky(id: string, text: string): void;
  clearSticky(id: string): void;
  /** Id de la última orden enviada, para informar su resultado. */
  onOrder(commandId: string): void;
}

/** Traduce ratón y teclado en selección, cámara y órdenes; solo escucha sobre el canvas y la ventana. */
export class InputController {
  private readonly keys: PanKeys = { up: false, down: false, left: false, right: false };
  private edge: PanKeys = { up: false, down: false, left: false, right: false };
  private readonly abort = new AbortController();
  private drag: { x: number; y: number; shift: boolean; active: boolean } | null = null;
  private placement: BuildingKind | null = null;
  private pointer: { x: number; y: number } | null = null;
  private hover: { x: number; y: number } | null = null;
  private cursorDirty = false;
  private cursorClock = 0;
  private cursorKind: CursorKind | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly view: SceneView,
    private readonly rig: CameraRig,
    private readonly hooks: InputHooks,
    private readonly dragBox: HTMLElement,
  ) {
    const opts = { signal: this.abort.signal };
    window.addEventListener("keydown", (e) => this.onKey(e, true), opts);
    window.addEventListener("keyup", (e) => this.onKey(e, false), opts);
    window.addEventListener("blur", () => this.resetKeys(), opts);
    window.addEventListener("blur", () => this.leaveCanvas(), opts);
    window.addEventListener("pointermove", (e) => this.onEdge(e), opts);
    document.documentElement.addEventListener("mouseleave", () => this.clearEdge(), opts);
    canvas.addEventListener("pointerdown", (e) => this.onDown(e), opts);
    canvas.addEventListener("pointermove", (e) => this.onMove(e), opts);
    canvas.addEventListener("pointerleave", () => this.leaveCanvas(), opts);
    canvas.addEventListener("pointerup", (e) => this.onUp(e), opts);
    canvas.addEventListener("pointercancel", () => this.cancelDrag(), opts);
    canvas.addEventListener("contextmenu", (e) => this.onContext(e), opts);
    canvas.addEventListener("wheel", (e) => this.onWheel(e), { ...opts, passive: false });
  }

  update(dtSec: number): void {
    const e = this.edge;
    const k = this.keys;
    const mouse = this.drag?.active ? null : e;
    const edgeActive = !!(mouse && (mouse.up || mouse.down || mouse.left || mouse.right));
    this.rig.pan(dtSec, { up: k.up || !!mouse?.up, down: k.down || !!mouse?.down, left: k.left || !!mouse?.left, right: k.right || !!mouse?.right }, edgeActive ? EDGE_SPEED_FACTOR : 1);
    this.updateCursor(dtSec);
    if (!this.placement) return;
    if (!this.ownVillagers().length) {
      this.cancelPlacement();
      this.hooks.notify("Colocación cancelada: no quedan aldeanos seleccionados");
    } else {
      this.updateGhost();
    }
  }

  /** Edificio que se está colocando, o null. */
  get placing(): BuildingKind | null {
    return this.placement;
  }

  beginPlacement(kind: BuildingKind): void {
    if (this.hooks.getSession().paused) return this.hooks.notify("En pausa: reanude para dar órdenes");
    if (!this.ownVillagers().length) return this.hooks.notify("Seleccione al menos un aldeano para construir");
    this.placement = kind;
    this.hooks.sticky("placement", `Colocando ${BUILDING_NAME[kind]}: clic izquierdo confirma · Esc o clic derecho cancela`);
    this.updateGhost();
  }

  cancelPlacement(): void {
    this.placement = null;
    this.hooks.clearSticky("placement");
    this.view.hideGhost();
  }

  private ownVillagers(): number[] {
    const sel = this.hooks.selection;
    return this.hooks
      .getSession()
      .state.units.filter((u) => u.owner === HUMAN && u.kind === "villager" && sel.units.has(u.id))
      .map((u) => u.id);
  }

  /** Esquina mínima de la huella centrada bajo el cursor, o null fuera del mapa. */
  private placementCell(): { x: number; z: number } | null {
    if (!this.placement || !this.pointer) return null;
    const p = this.view.groundPoint(this.pointer.x, this.pointer.y);
    if (!p) return null;
    const w = BALANCE.buildings[this.placement].footprint;
    return { x: Math.round(p.x - w / 2), z: Math.round(p.z - w / 2) };
  }

  private updateGhost(): void {
    if (!this.placement) return;
    const cell = this.placementCell();
    if (!cell) return this.view.hideGhost();
    const state = this.hooks.getSession().state;
    const code = previewPlacement(state, currentGrid(state), HUMAN, this.placement, cell.x, cell.z);
    this.view.showGhost(this.placement, cell.x, cell.z, code === null);
  }

  private confirmPlacement(e: PointerEvent): void {
    const kind = this.placement;
    if (!kind) return;
    this.pointer = { x: e.clientX, y: e.clientY };
    const session = this.hooks.getSession();
    if (session.paused) return this.hooks.notify("En pausa: reanude para dar órdenes");
    const cell = this.placementCell();
    if (!cell) return this.hooks.notify("Ubicación fuera del mapa");
    const state = session.state;
    const code = previewPlacement(state, currentGrid(state), HUMAN, kind, cell.x, cell.z);
    if (code) return this.hooks.notify(`Ubicación rechazada: ${REJECT_TEXT[code]}`);
    this.order({ type: "Build", entityIds: this.ownVillagers(), kind, target: cell });
    if (!e.shiftKey) this.cancelPlacement();
  }

  private order(partial: Omit<Command, "id" | "tick" | "seq" | "player">): void {
    const id = this.hooks.getSession().issue({ ...partial, player: HUMAN });
    this.hooks.onOrder(id);
  }

  /** El cursor anuncia lo que haría el clic derecho; se reevalúa al mover el ratón y, con el ratón quieto, a 10 Hz como máximo. */
  private updateCursor(dtSec: number): void {
    this.cursorClock += dtSec;
    if (!this.cursorDirty && this.cursorClock < CURSOR_REFRESH_SEC) return;
    this.cursorDirty = false;
    this.cursorClock = 0;
    const session = this.hooks.getSession();
    const state = session.state;
    let kind: CursorKind | null = null;
    if (this.hover && !this.placement && !this.drag?.active && !session.paused && state.matchStatus !== "ended") {
      const action = resolveRightClick(state, this.view.pickEntities(this.hover.x, this.hover.y), HUMAN);
      kind = cursorFor(action, selectionCaps(state, this.hooks.selection, HUMAN));
    }
    if (kind === this.cursorKind) return;
    this.cursorKind = kind;
    this.canvas.style.cursor = kind ? cursorCss(kind) : "";
  }

  private leaveCanvas(): void {
    this.hover = null;
    this.cursorDirty = true;
  }

  dispose(): void {
    this.abort.abort();
  }

  private resetKeys(): void {
    this.keys.up = this.keys.down = this.keys.left = this.keys.right = false;
    this.clearEdge();
  }

  private clearEdge(): void {
    this.edge = { up: false, down: false, left: false, right: false };
  }

  /** Solo el ratón sobre el canvas desplaza; sobre la interfaz (paneles, botones, ayuda) se detiene. */
  private onEdge(e: PointerEvent): void {
    if (e.pointerType !== "mouse" || e.target !== this.canvas) return this.clearEdge();
    const r = this.canvas.getBoundingClientRect();
    this.edge = edgePan(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const dir = KEY_MAP[e.code];
    if (dir) {
      this.keys[dir] = down;
      e.preventDefault();
    } else if (down && e.code === "Escape") {
      if (this.placement) {
        this.cancelPlacement();
        this.hooks.notify("Colocación cancelada");
      } else {
        clearSelection(this.hooks.selection);
      }
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.rig.zoomBy(e.deltaY);
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (this.placement) return this.confirmPlacement(e);
    this.canvas.setPointerCapture(e.pointerId);
    this.drag = { x: e.clientX, y: e.clientY, shift: e.shiftKey, active: false };
  }

  private onMove(e: PointerEvent): void {
    this.pointer = { x: e.clientX, y: e.clientY };
    this.hover = this.pointer;
    this.cursorDirty = true;
    const d = this.drag;
    if (!d) return;
    if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) >= DRAG_THRESHOLD_PX) d.active = true;
    if (!d.active) return;
    const s = this.dragBox.style;
    s.display = "block";
    s.left = `${Math.min(d.x, e.clientX)}px`;
    s.top = `${Math.min(d.y, e.clientY)}px`;
    s.width = `${Math.abs(e.clientX - d.x)}px`;
    s.height = `${Math.abs(e.clientY - d.y)}px`;
  }

  private cancelDrag(): void {
    this.drag = null;
    this.dragBox.style.display = "none";
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.button !== 0) return;
    this.cancelDrag();
    const state = this.hooks.getSession().state;
    if (!d.active) {
      clickSelect(this.hooks.selection, state, this.view.pickEntity(e.clientX, e.clientY), d.shift, HUMAN);
      return;
    }
    const x0 = Math.min(d.x, e.clientX);
    const x1 = Math.max(d.x, e.clientX);
    const y0 = Math.min(d.y, e.clientY);
    const y1 = Math.max(d.y, e.clientY);
    const inside = state.units
      .filter((u) => {
        const p = this.view.screenPosition(u.pos.x, 0.45, u.pos.z);
        return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      })
      .map((u) => u.id);
    boxSelect(this.hooks.selection, state, inside, d.shift, HUMAN);
  }

  private onContext(e: MouseEvent): void {
    e.preventDefault();
    if (this.placement) {
      this.cancelPlacement();
      return this.hooks.notify("Colocación cancelada");
    }
    const session = this.hooks.getSession();
    const sel = this.hooks.selection;
    if (session.paused) return this.hooks.notify("En pausa: reanude para dar órdenes");
    if (sel.units.size === 0) return this.hooks.notify("No hay unidades propias seleccionadas");

    // Se ignoran las unidades propias que tapan al objetivo (p. ej. aldeanos sobre un árbol).
    const action = resolveRightClick(session.state, this.view.pickEntities(e.clientX, e.clientY), HUMAN);
    if (action?.kind === "gather") return this.order({ type: "Gather", entityIds: [...sel.units], target: { entityId: action.node.id } });
    if (action?.kind === "resume") return this.order({ type: "ResumeBuild", entityIds: [...sel.units], target: { entityId: action.site.id } });
    if (action?.kind === "attack") return this.order({ type: "Attack", entityIds: [...sel.units], target: { entityId: action.target.id } });

    const point = this.view.groundPoint(e.clientX, e.clientY);
    if (!point) return this.hooks.notify("Destino fuera del mapa");
    this.order({ type: "Move", entityIds: [...sel.units], target: point });
    this.view.showMarker(point.x, point.z);
  }
}
