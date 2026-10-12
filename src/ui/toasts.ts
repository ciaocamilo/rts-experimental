export type ToastKind = "info" | "warn" | "error";

/** Duración en ms de cada tipo (P6-H02 CA03). */
export const TOAST_DURATION: Record<ToastKind, number> = { info: 2500, warn: 3500, error: 4500 };
export const TOAST_MAX = 3;
/** Un texto idéntico que llega en menos de este tiempo no se duplica: renueva el temporizador y suma un contador. */
export const TOAST_DEDUPE_MS = 1200;
/** Duración de la salida; el aviso se marca `leaving` durante este tiempo antes de retirarse. */
export const TOAST_LEAVE_MS = 300;

export interface ToastItem {
  key: number;
  /** Id del aviso fijo, o null en los temporales. */
  id: string | null;
  text: string;
  kind: ToastKind;
  count: number;
  /** Instante del último texto idéntico recibido. */
  updated: number;
  /** Instante en que se retira; `Infinity` en los avisos fijos. */
  expires: number;
}

/** Lógica pura de los avisos (sin DOM) para poder probarla con un reloj inyectado. */
export class ToastModel {
  items: ToastItem[] = [];
  private nextKey = 1;

  show(text: string, kind: ToastKind, now: number): void {
    const same = this.items.find((t) => t.id === null && t.text === text && t.kind === kind && now - t.updated < TOAST_DEDUPE_MS);
    if (same) {
      same.count += 1;
      same.updated = now;
      same.expires = now + TOAST_DURATION[kind];
      return;
    }
    this.items.push({ key: this.nextKey++, id: null, text, kind, count: 1, updated: now, expires: now + TOAST_DURATION[kind] });
    this.trim();
  }

  showSticky(id: string, text: string, now: number): void {
    const found = this.items.find((t) => t.id === id);
    if (found) {
      found.text = text;
      found.updated = now;
      return;
    }
    this.items.push({ key: this.nextKey++, id, text, kind: "info", count: 1, updated: now, expires: Infinity });
    this.trim();
  }

  clear(id: string): void {
    this.items = this.items.filter((t) => t.id !== id);
  }

  clearAll(): void {
    this.items = [];
  }

  /** Retira los avisos vencidos. */
  prune(now: number): void {
    this.items = this.items.filter((t) => t.expires > now);
  }

  private trim(): void {
    while (this.items.length > TOAST_MAX) {
      const index = this.items.findIndex((t) => t.id === null);
      this.items.splice(index === -1 ? 0 : index, 1);
    }
  }
}

/** Avisos temporales arriba al centro (DOM). Usa el reloj real: se ven también en pausa. */
export class ToastCenter {
  private readonly model = new ToastModel();
  private readonly nodes = new Map<number, HTMLElement>();

  constructor(
    private readonly root: HTMLElement,
    private readonly clock: () => number = () => performance.now(),
  ) {
    root.setAttribute("aria-live", "polite");
  }

  show(text: string, kind: ToastKind = "info"): void {
    this.model.show(text, kind, this.clock());
    this.render();
  }

  showSticky(id: string, text: string): void {
    this.model.showSticky(id, text, this.clock());
    this.render();
  }

  clear(id: string): void {
    this.model.clear(id);
    this.render();
  }

  clearAll(): void {
    this.model.clearAll();
    this.render();
  }

  /** Se llama una vez por cuadro. */
  update(): void {
    this.model.prune(this.clock());
    this.render();
  }

  private render(): void {
    const now = this.clock();
    const live = new Set<number>();
    for (const item of this.model.items) {
      live.add(item.key);
      let node = this.nodes.get(item.key);
      if (!node) {
        node = document.createElement("div");
        this.nodes.set(item.key, node);
        this.root.append(node);
      }
      node.className = `toast ${item.kind}${item.expires - now < TOAST_LEAVE_MS ? " leaving" : ""}`;
      const text = item.count > 1 ? `${item.text} ×${item.count}` : item.text;
      if (node.textContent !== text) node.textContent = text;
    }
    for (const [key, node] of this.nodes) {
      if (live.has(key)) continue;
      node.remove();
      this.nodes.delete(key);
    }
  }
}
