const ICON_ENTER =
  "<svg viewBox='0 0 16 16' width='14' height='14' aria-hidden='true' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4'/></svg>";
const ICON_EXIT =
  "<svg viewBox='0 0 16 16' width='14' height='14' aria-hidden='true' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4'/></svg>";

export function fullscreenLabel(active: boolean): string {
  return active ? "Salir de pantalla completa (F)" : "Pantalla completa (F)";
}

/** Botón y tecla F de pantalla completa; el estado visible sale solo del evento `fullscreenchange`. */
export class FullscreenToggle {
  private readonly abort = new AbortController();

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly notify: (text: string) => void,
    private readonly doc: Document = document,
  ) {
    if (!doc.fullscreenEnabled) {
      button.hidden = true;
      return;
    }
    const opts = { signal: this.abort.signal };
    button.addEventListener("click", () => this.toggle(), opts);
    doc.addEventListener("fullscreenchange", () => this.refresh(), opts);
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "f" && event.key !== "F") return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const target = event.target;
        if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
        this.toggle();
      },
      opts,
    );
    this.refresh();
  }

  get active(): boolean {
    return this.doc.fullscreenElement !== null;
  }

  toggle(): void {
    const request = this.active ? this.doc.exitFullscreen() : this.doc.documentElement.requestFullscreen();
    request.catch(() => this.notify("No se pudo activar la pantalla completa"));
  }

  private refresh(): void {
    const active = this.active;
    const label = fullscreenLabel(active);
    this.button.innerHTML = active ? ICON_EXIT : ICON_ENTER;
    this.button.title = label;
    this.button.setAttribute("aria-label", label);
    this.button.setAttribute("aria-pressed", String(active));
  }

  dispose(): void {
    this.abort.abort();
  }
}
