import type { ErrorCode, ErrorMessage, InitMessage, ObserveMessage, ReadyMessage, Versions } from "../ai-client/protocol";
import { PROTOCOL_VERSION } from "../ai-client/protocol";
import { validateMessage } from "../ai-client/validate";

/** Subconjunto de la API de Pyodide que usa el puente. */
export interface PyodideLike {
  version: string;
  runPython(code: string): unknown;
  FS: { mkdirTree(path: string): void; writeFile(path: string, data: string): void };
}

export interface HostDeps {
  post(message: unknown): void;
  loadPyodide(): Promise<PyodideLike>;
  /** Módulos de la política y esquema, por nombre de archivo. */
  files: Readonly<Record<string, string>>;
  now(): number;
}

interface Initialized {
  init: InitMessage;
  handleObserve: (text: string) => string;
}

const POLICY_DIR = "/home/pyodide/rts_policy/policy";

function brief(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text.split("\n")[0]!.slice(0, 200);
}

/** Lógica del worker independiente de `self`, para ejecutarla igual en el navegador y en pruebas. */
export class WorkerHost {
  private ready: Initialized | null = null;
  private initializing = false;

  constructor(private readonly deps: HostDeps) {}

  async handle(data: unknown): Promise<void> {
    const type = typeof data === "object" && data !== null ? (data as { type?: unknown }).type : undefined;
    if (type === "OBSERVE") return this.observe(data);
    if (type !== "INIT") return this.error("INVALID_MESSAGE", "mensaje no admitido por el worker");

    const checked = validateMessage(data);
    if (!checked.ok) return this.error(checked.code, checked.detail);
    if (checked.message.type !== "INIT") return this.error("INVALID_MESSAGE", "se esperaba INIT");
    return this.init(checked.message);
  }

  private async init(init: InitMessage): Promise<void> {
    if (this.ready || this.initializing) return this.error("INVALID_MESSAGE", "el worker ya recibió INIT", init);
    this.initializing = true;
    const ids = { session_id: init.session_id, worker_generation: init.worker_generation };
    try {
      const started = this.deps.now();
      const pyodide = await this.deps.loadPyodide();
      const pyodideLoaded = this.deps.now();
      if (pyodide.version !== init.expected.pyodide) {
        return this.error("INCOMPATIBLE_VERSION", `Pyodide ${pyodide.version}, se esperaba ${init.expected.pyodide}`, ids);
      }

      pyodide.FS.mkdirTree(POLICY_DIR);
      for (const [name, source] of Object.entries(this.deps.files)) pyodide.FS.writeFile(`${POLICY_DIR}/${name}`, source);
      pyodide.runPython("import sys\nif '/home/pyodide/rts_policy' not in sys.path:\n    sys.path.insert(0, '/home/pyodide/rts_policy')");
      const info = JSON.parse(String(pyodide.runPython("import policy.entry as _entry\n_entry.runtime_info()"))) as {
        python: string;
        policy: string;
      };
      const handleObserve = pyodide.runPython("_entry.handle_observe") as (text: string) => string;
      const versions: Versions = { pyodide: pyodide.version, python: info.python, policy: info.policy };
      if (!versions.python.startsWith(init.expected.python) || versions.policy !== init.expected.policy) {
        return this.error("INCOMPATIBLE_VERSION", `Python ${versions.python} / política ${versions.policy} no esperadas`, ids);
      }

      this.ready = { init, handleObserve };
      const done = this.deps.now();
      const ready: ReadyMessage = {
        type: "READY",
        protocol_version: PROTOCOL_VERSION,
        ...ids,
        versions,
        timings_ms: { pyodide_load: pyodideLoaded - started, policy_load: done - pyodideLoaded, total: done - started },
      };
      this.deps.post(ready);
    } catch (error) {
      this.error("LOAD_ERROR", brief(error), ids);
    } finally {
      this.initializing = false;
    }
  }

  private observe(data: unknown): void {
    const message = data as Partial<ObserveMessage>;
    const ids = {
      ...(typeof message.session_id === "string" ? { session_id: message.session_id } : {}),
      ...(typeof message.worker_generation === "number" ? { worker_generation: message.worker_generation } : {}),
      ...(typeof message.request_id === "number" ? { request_id: message.request_id } : {}),
    };
    const ready = this.ready;
    if (!ready) return this.error("INVALID_MESSAGE", "el worker no está inicializado", ids);
    if (message.session_id !== ready.init.session_id || message.worker_generation !== ready.init.worker_generation) {
      return this.error("INVALID_MESSAGE", "sesión o generación distintas de INIT", ids);
    }

    const t0 = this.deps.now();
    const text = JSON.stringify(data);
    const t1 = this.deps.now();
    let raw: string;
    try {
      raw = ready.handleObserve(text);
    } catch (error) {
      return this.error("POLICY_ERROR", brief(error), ids);
    }
    const t2 = this.deps.now();

    let outcome: { ok: boolean; decision?: Record<string, unknown>; code?: ErrorCode; message?: string };
    try {
      outcome = JSON.parse(raw) as typeof outcome;
    } catch {
      return this.error("POLICY_ERROR", "respuesta de la política ilegible", ids);
    }
    if (!outcome.ok || !outcome.decision) return this.error(outcome.code ?? "POLICY_ERROR", outcome.message ?? "sin detalle", ids);
    this.deps.post({ ...outcome.decision, metrics: { policy_ms: t2 - t1, convert_ms: t1 - t0 } });
  }

  private error(
    code: ErrorCode,
    message: string,
    ids: { session_id?: string; worker_generation?: number; request_id?: number } = {},
  ): void {
    const error: ErrorMessage = {
      type: "ERROR",
      protocol_version: PROTOCOL_VERSION,
      ...(ids.session_id !== undefined ? { session_id: ids.session_id } : {}),
      ...(ids.worker_generation !== undefined ? { worker_generation: ids.worker_generation } : {}),
      ...(ids.request_id !== undefined ? { request_id: ids.request_id } : {}),
      code,
      message: message.slice(0, 200),
    };
    this.deps.post(error);
  }
}
