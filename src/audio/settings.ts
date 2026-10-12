export interface AudioSettings {
  music: boolean;
  sfx: boolean;
  /** Silencio total (tecla `M`); no pierde las preferencias individuales. */
  muted: boolean;
}

export const SETTINGS_KEY = "rts-audio-v1";

export const DEFAULT_SETTINGS: Readonly<AudioSettings> = { music: true, sfx: true, muted: false };

type Store = Pick<Storage, "getItem" | "setItem">;

/** Almacenamiento del navegador o null si no existe o su acceso lanza. */
export function browserStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Lee las preferencias; cualquier fallo o dato inválido devuelve el valor por defecto sin lanzar. */
export function loadSettings(store: Store | null = browserStore()): AudioSettings {
  try {
    const raw = store?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const data = JSON.parse(raw) as Partial<Record<keyof AudioSettings, unknown>>;
    const pick = (key: keyof AudioSettings): boolean => (typeof data[key] === "boolean" ? (data[key] as boolean) : DEFAULT_SETTINGS[key]);
    return { music: pick("music"), sfx: pick("sfx"), muted: pick("muted") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AudioSettings, store: Store | null = browserStore()): void {
  try {
    store?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento: las preferencias solo duran la sesión.
  }
}
