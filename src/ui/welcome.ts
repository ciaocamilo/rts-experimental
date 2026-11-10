import { GAME_CREDIT, GAME_NAME, GAME_SUBTITLE } from "../content/versions";
import type { GameMode } from "../core/types";

export interface WelcomeModeContent {
  id: GameMode;
  label: string;
  blurb: string;
  goal: string;
  tips: readonly string[];
}

export interface WelcomeContent {
  title: string;
  subtitle: string;
  /** Objetivo y consejos del modo villa (el modo por defecto). */
  goal: string;
  tips: readonly string[];
  modes: readonly WelcomeModeContent[];
  credit: string;
  startLabel: string;
  helpLabel: string;
}

const VILLAGE_TIPS = [
  "Recolecta recursos: seleccione aldeanos y haga clic derecho sobre un árbol, un arbusto o una roca.",
  "Construye y entrena desde la barra inferior; la población máxima es 50. Cada bando empieza con un soldado, un arquero, un caballero y un cañón.",
  "Los centros urbanos y las torres disparan solos; los militares libres atacan a menos de 6 celdas.",
  "Cámara: WASD, el borde de la pantalla o la miniatura; la rueda acerca y aleja.",
  "Atajos: H ayuda, F pantalla completa, M silencio.",
] as const;

const BATTLE_TIPS = [
  "Sin edificios ni aldeanos: cada bando tiene 5 cañones, 15 arqueros, 10 caballeros, 30 soldados y un comandante.",
  "El comandante tiene el doble de ataque y de vida que un caballero, y la IA rival lo pone a liderar a sus tropas.",
  "Los ejércitos empiezan fuera de alcance: solo ves al rival a menos de 14 celdas de tus unidades.",
  "Atajos: E selecciona todo el ejército, C el comandante, doble clic en una unidad elige las cercanas del mismo tipo, Esc limpia la selección; clic derecho mueve o ataca.",
  "Cámara: WASD, el borde de la pantalla o la miniatura; H ayuda, F pantalla completa, M silencio.",
] as const;

/** Texto de la ventana de bienvenida; se prueba sin DOM. */
export function welcomeContent(): WelcomeContent {
  return {
    title: GAME_NAME,
    subtitle: GAME_SUBTITLE,
    goal: "Destruye el centro urbano rival antes de que caiga el tuyo. Tiempo límite de la partida: 30 minutos.",
    tips: VILLAGE_TIPS,
    modes: [
      {
        id: "village",
        label: "Modo villa",
        blurb: "Recolecta, construye y entrena",
        goal: "Destruye el centro urbano rival antes de que caiga el tuyo. Tiempo límite de la partida: 30 minutos.",
        tips: VILLAGE_TIPS,
      },
      {
        id: "battle",
        label: "Modo batalla",
        blurb: "Solo ejércitos: aniquila al rival",
        goal: "Aniquila al ejército rival. Si pasan 30 minutos, gana quien conserve más vida.",
        tips: BATTLE_TIPS,
      },
    ],
    credit: GAME_CREDIT,
    startLabel: "Comenzar",
    helpLabel: "Ver ayuda",
  };
}

export interface WelcomeActions {
  /** Cierra la bienvenida y arranca la partida en el modo elegido; `openHelp` pide además abrir la ayuda. */
  start(mode: GameMode, openHelp: boolean): void;
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

/** Ventana modal de inicio: elegir modo (villa o batalla), Intro y Esc comienzan, Tab recorre los botones y el texto entra por `textContent`. */
export class WelcomeDialog {
  private readonly startButton: HTMLButtonElement;
  private readonly helpButton: HTMLButtonElement;
  private readonly modeButtons = new Map<GameMode, HTMLButtonElement>();
  private readonly goal: HTMLElement;
  private readonly list: HTMLElement;
  private selected: GameMode;
  private opener: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: WelcomeActions,
    private readonly content: WelcomeContent = welcomeContent(),
    initial: GameMode = "village",
  ) {
    this.selected = initial;
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
    const modes = node("div", "welcome-modes", undefined, card);
    modes.setAttribute("role", "radiogroup");
    modes.setAttribute("aria-label", "Modo de juego");
    for (const mode of content.modes) {
      const button = node("button", "welcome-mode", undefined, modes);
      button.type = "button";
      button.setAttribute("role", "radio");
      node("strong", "", mode.label, button);
      node("span", "", mode.blurb, button);
      button.addEventListener("click", () => this.select(mode.id));
      this.modeButtons.set(mode.id, button);
    }
    this.goal = node("p", "welcome-goal", content.goal, card);
    this.goal.id = "welcome-goal";
    this.list = node("ul", "welcome-tips", undefined, card);
    const buttons = node("div", "welcome-actions", undefined, card);
    this.startButton = node("button", "primary", content.startLabel, buttons);
    this.startButton.type = "button";
    this.helpButton = node("button", "", content.helpLabel, buttons);
    this.helpButton.type = "button";
    node("p", "welcome-credit", content.credit, card);
    this.select(initial);
    this.startButton.addEventListener("click", () => this.actions.start(this.selected, false));
    this.helpButton.addEventListener("click", () => this.actions.start(this.selected, true));
    root.addEventListener("keydown", (event) => {
      if (root.hidden) return;
      if (event.key === "Escape" || (event.key === "Enter" && event.target === root)) {
        event.preventDefault();
        event.stopPropagation();
        this.actions.start(this.selected, false);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const ids = content.modes.map((m) => m.id);
        const at = ids.indexOf(this.selected);
        event.preventDefault();
        this.select(ids[(at + (event.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length]!);
        this.modeButtons.get(this.selected)?.focus();
      } else if (event.key === "Tab") {
        const order = [...this.modeButtons.values(), this.startButton, this.helpButton];
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

  get mode(): GameMode {
    return this.selected;
  }

  /** Marca el modo elegido y muestra su objetivo y sus consejos. */
  select(mode: GameMode): void {
    const info = this.content.modes.find((m) => m.id === mode);
    if (!info) return;
    this.selected = mode;
    for (const [id, button] of this.modeButtons) {
      button.classList.toggle("selected", id === mode);
      button.setAttribute("aria-checked", String(id === mode));
    }
    this.goal.textContent = info.goal;
    this.list.replaceChildren();
    for (const tip of info.tips) node("li", "", tip, this.list);
  }

  show(mode: GameMode = this.selected): void {
    this.select(mode);
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
