import type { EndSummary, MatchResultLabel } from "../core/result";

export interface EndDialogActions {
  /** «Jugar de nuevo»: reinicia la partida. */
  restart(): void;
  /** «Ver el campo»: cierra la ventana y deja ver el campo con el resultado visible. */
  dismiss(): void;
}

const SHIELD: Record<MatchResultLabel, { fill: string; mark: string }> = {
  victoria: { fill: "#2f5fb0", mark: "<path fill='#f1d27a' d='M32 14l5 11 12 1-9 8 3 12-11-7-11 7 3-12-9-8 12-1z'/>" },
  derrota: { fill: "#8f2a24", mark: "<path d='M20 20l24 26M44 20L20 46' stroke='#e9dcb8' stroke-width='5' stroke-linecap='round' fill='none'/>" },
  empate: { fill: "#4a525a", mark: "<path fill='#d9b45a' d='M30 16h4v32h-4z'/><path fill='#d9b45a' d='M18 24h28v4H18z'/>" },
  "en curso": { fill: "#4a525a", mark: "" },
};

/** Escudo heráldico del resultado: forma común, color y emblema según victoria, derrota o empate. */
export function crestSvg(label: MatchResultLabel): string {
  const { fill, mark } = SHIELD[label];
  return (
    `<svg viewBox='0 0 64 72' width='64' height='72' aria-hidden='true' xmlns='http://www.w3.org/2000/svg'>` +
    `<path d='M32 3 58 12v22c0 17-11 28-26 35C17 62 6 51 6 34V12z' fill='${fill}' stroke='#d9b45a' stroke-width='3' stroke-linejoin='round'/>` +
    `<path d='M32 8 53 15v19c0 14-9 24-21 30' fill='none' stroke='#ffffff' stroke-opacity='.18' stroke-width='2'/>${mark}</svg>`
  );
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  parent?.append(element);
  return element;
}

/**
 * Ventana de fin de partida: diálogo modal con el resultado, el motivo y el resumen. Todo el texto entra por
 * `textContent`; Enter reinicia, Esc la cierra y el foco queda dentro mientras está abierta.
 */
export class EndDialog {
  private readonly restartButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly title: HTMLElement;
  private readonly reason: HTMLElement;
  private readonly crest: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly card: HTMLElement;
  private opener: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement, private readonly actions: EndDialogActions) {
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.replaceChildren();
    this.card = node("div", "end-card", undefined, root);
    this.crest = node("div", "end-crest", undefined, this.card);
    this.title = node("h2", "end-title", undefined, this.card);
    this.title.id = "end-title";
    this.reason = node("p", "end-reason", undefined, this.card);
    this.reason.id = "end-reason";
    this.stats = node("dl", "end-stats", undefined, this.card);
    const buttons = node("div", "end-actions", undefined, this.card);
    this.restartButton = node("button", "primary", "Jugar de nuevo", buttons);
    this.restartButton.type = "button";
    this.closeButton = node("button", "", "Ver el campo", buttons);
    this.closeButton.type = "button";
    root.setAttribute("aria-labelledby", "end-title");
    root.setAttribute("aria-describedby", "end-reason");
    this.restartButton.addEventListener("click", () => this.actions.restart());
    this.closeButton.addEventListener("click", () => this.actions.dismiss());
    root.addEventListener("keydown", (event) => {
      if (root.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.actions.dismiss();
      } else if (event.key === "Enter" && event.target === root) {
        event.preventDefault();
        event.stopPropagation();
        this.actions.restart();
      } else if (event.key === "Tab") {
        const order = [this.restartButton, this.closeButton];
        const at = order.indexOf(document.activeElement as HTMLButtonElement);
        const next = order[(at + (event.shiftKey ? order.length - 1 : 1)) % order.length]!;
        event.preventDefault();
        next.focus();
      }
    });
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(summary: EndSummary): void {
    this.card.className = `end-card ${summary.label === "en curso" ? "empate" : summary.label}`;
    this.crest.innerHTML = crestSvg(summary.label);
    this.title.textContent = summary.title;
    this.reason.textContent = `${summary.reason.charAt(0).toUpperCase()}${summary.reason.slice(1)}.`;
    this.stats.replaceChildren();
    const row = (label: string, value: string): void => {
      node("dt", "", label, this.stats);
      node("dd", "", value, this.stats);
    };
    row("Duración", summary.duration);
    row("Bajas propias", `${summary.ownLosses.units} unidades · ${summary.ownLosses.buildings} edificios`);
    row("Bajas rivales", `${summary.rivalLosses.units} unidades · ${summary.rivalLosses.buildings} edificios`);
    row("Centro urbano propio", summary.centers.own);
    row("Centro urbano rival", summary.centers.rival);
    if (this.root.hidden) this.opener = document.activeElement as HTMLElement | null;
    this.root.hidden = false;
    this.restartButton.focus();
  }

  hide(restoreFocus = false): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    if (restoreFocus && this.opener && document.contains(this.opener)) this.opener.focus();
    this.opener = null;
  }
}
