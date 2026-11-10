/** Plazo (ms) para confirmar con una segunda pulsación que se quiere abandonar la partida. */
export const EXIT_CONFIRM_MS = 3000;

export const EXIT_LABEL = "Salir al menú";
export const EXIT_CONFIRM_LABEL = "¿Salir? Pulse otra vez";

/**
 * Doble pulsación para abandonar una partida en curso: la primera pide confirmar y la segunda, dentro del plazo, sale.
 * Si la partida ya terminó no hay nada que perder y sale a la primera.
 */
export class ExitGuard {
  private armedAt: number | null = null;

  /** `true` si hay que salir ahora; `false` si solo se armó la confirmación. */
  press(now: number, matchEnded: boolean): boolean {
    if (matchEnded || (this.armedAt !== null && now - this.armedAt <= EXIT_CONFIRM_MS)) {
      this.armedAt = null;
      return true;
    }
    this.armedAt = now;
    return false;
  }

  /** ¿Está esperando confirmación en `now`? */
  armed(now: number): boolean {
    return this.armedAt !== null && now - this.armedAt <= EXIT_CONFIRM_MS;
  }

  reset(): void {
    this.armedAt = null;
  }
}
