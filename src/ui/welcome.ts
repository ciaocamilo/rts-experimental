import { GAME_CREDIT, GAME_NAME, GAME_SUBTITLE } from "../content/versions";

export interface WelcomeContent {
  title: string;
  subtitle: string;
  goal: string;
  tips: readonly string[];
  credit: string;
  startLabel: string;
  helpLabel: string;
}

/** Texto de la ventana de bienvenida; se prueba sin DOM. */
export function welcomeContent(): WelcomeContent {
  return {
    title: GAME_NAME,
    subtitle: GAME_SUBTITLE,
    goal: "Destruya el centro urbano rival antes de que caiga el suyo. Partida máxima: 30 minutos.",
    tips: [
      "Recolecte: seleccione aldeanos y haga clic derecho sobre un árbol, un arbusto o una roca.",
      "Construya y entrene desde la barra inferior; la población máxima es 50.",
      "Los centros urbanos y las torres disparan solos; los militares libres atacan a menos de 6 celdas.",
      "Cámara: WASD, el borde de la pantalla o la miniatura; la rueda acerca y aleja.",
      "Atajos: H ayuda, F pantalla completa, M silencio.",
    ],
    credit: GAME_CREDIT,
    startLabel: "Comenzar",
    helpLabel: "Ver ayuda",
  };
}

export interface WelcomeActions {
  /** Cierra la bienvenida y arranca la partida; `openHelp` pide además abrir la ayuda. */
  start(openHelp: boolean): void;
}

const TOWER =
  "<svg viewBox='0 0 24 24' width='56' height='56' aria-hidden='true' xmlns='http://www.w3.org/2000/svg'>" +
  "<path fill='#d9b45a' d='M5 21V8H3V3h4v2h2V3h6v2h2V3h4v5h-2v13z'/><path fill='#14171a' d='M10 21v-5a2 2 0 0 1 4 0v5z'/></svg>";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  parent?.append(element);
  return element;
}

/** Ventana modal de bienvenida: Intro y Esc comienzan, Tab recorre los botones y el texto entra por `textContent`. */
export class WelcomeDialog {
  private readonly startButton: HTMLButtonElement;
  private readonly helpButton: HTMLButtonElement;
  private opener: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement, private readonly actions: WelcomeActions, content: WelcomeContent = welcomeContent()) {
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "welcome-title");
    root.setAttribute("aria-describedby", "welcome-goal");
    root.replaceChildren();
    const card = node("div", "welcome-card", undefined, root);
    node("div", "welcome-crest", undefined, card).innerHTML = TOWER;
    node("h2", "welcome-title", content.title, card).id = "welcome-title";
    node("p", "welcome-subtitle", content.subtitle, card);
    node("p", "welcome-goal", content.goal, card).id = "welcome-goal";
    const list = node("ul", "welcome-tips", undefined, card);
    for (const tip of content.tips) node("li", "", tip, list);
    const buttons = node("div", "welcome-actions", undefined, card);
    this.startButton = node("button", "primary", content.startLabel, buttons);
    this.startButton.type = "button";
    this.helpButton = node("button", "", content.helpLabel, buttons);
    this.helpButton.type = "button";
    node("p", "welcome-credit", content.credit, card);
    this.startButton.addEventListener("click", () => this.actions.start(false));
    this.helpButton.addEventListener("click", () => this.actions.start(true));
    root.addEventListener("keydown", (event) => {
      if (root.hidden) return;
      if (event.key === "Escape" || (event.key === "Enter" && event.target === root)) {
        event.preventDefault();
        event.stopPropagation();
        this.actions.start(false);
      } else if (event.key === "Tab") {
        const order = [this.startButton, this.helpButton];
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

  show(): void {
    if (this.root.hidden) this.opener = document.activeElement as HTMLElement | null;
    this.root.hidden = false;
    this.startButton.focus();
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    const back = this.opener;
    this.opener = null;
    if (back && back !== document.body && document.contains(back)) back.focus();
  }
}
