import {
  AIError,
  MAX_COMMANDS,
  POLICY_VERSION,
  PROTOCOL_VERSION,
  PYODIDE_VERSION,
  PYTHON_VERSION_PREFIX,
  type DecisionMessage,
  type ErrorCode,
  type InitMessage,
  type ObserveMessage,
  type ReadyMessage,
  type Versions,
} from "./protocol";
import { checkDecisionSemantics, validateMessage } from "./validate";

/** `suspended`: worker terminado por invalidación; se recrea al reanudar (§8.2, punto 8). */
export type ProviderState = "stopped" | "initializing" | "ready" | "busy" | "failed" | "suspended";

/** Subconjunto de Worker que usa el proveedor; permite inyectar workers simulados. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
}

/** Contrato conceptual del SDD §7.3: la política decide a partir de una observación. */
export interface AIProvider {
  decide(observation: ObserveMessage, signal?: AbortSignal): Promise<DecisionMessage>;
}

export interface ProviderOptions {
  createWorker: () => WorkerLike;
  sessionId: string;
  expected?: Versions;
  decisionTimeoutMs?: number;
  initTimeoutMs?: number;
}

interface Pending {
  observation: ObserveMessage;
  resolve: (decision: DecisionMessage) => void;
  reject: (error: AIError) => void;
  timer: ReturnType<typeof setTimeout>;
  detach: () => void;
}

/** Un único worker persistente por partida; recrearlo incrementa la generación. */
export class WorkerAIProvider implements AIProvider {
  state: ProviderState = "stopped";
  generation = 0;
  lastError: AIError | null = null;
  readyInfo: ReadyMessage | null = null;
  /** Mensajes del worker descartados por no corresponder a la petición vigente. */
  discardedMessages = 0;
  workersCreated = 0;
  /** Se invoca de forma síncrona en cada cambio de estado. */
  onStateChange: ((state: ProviderState, error: AIError | null) => void) | null = null;

  private worker: WorkerLike | null = null;
  private pending: Pending | null = null;
  private initTimer: ReturnType<typeof setTimeout> | null = null;
  private initWaiter: { resolve: (ready: ReadyMessage) => void; reject: (error: AIError) => void } | null = null;
  private readonly expected: Versions;
  private readonly decisionTimeoutMs: number;
  private readonly initTimeoutMs: number;

  constructor(private readonly options: ProviderOptions) {
    this.expected = options.expected ?? { pyodide: PYODIDE_VERSION, python: PYTHON_VERSION_PREFIX, policy: POLICY_VERSION };
    this.decisionTimeoutMs = options.decisionTimeoutMs ?? 500;
    this.initTimeoutMs = options.initTimeoutMs ?? 90_000;
  }

  get sessionId(): string {
    return this.options.sessionId;
  }

  /** Crea un worker nuevo (generación siguiente) y espera READY compatible. Sin reintentos automáticos. */
  launch(): Promise<ReadyMessage> {
    this.disposeWorker(new AIError("ABORTED", "worker sustituido", false));
    this.generation += 1;
    this.readyInfo = null;
    this.lastError = null;

    const waiter = new Promise<ReadyMessage>((resolve, reject) => {
      this.initWaiter = { resolve, reject };
    });
    // La caída se informa por onStateChange; evita un rechazo sin manejar si nadie espera el resultado.
    waiter.catch(() => undefined);

    let worker: WorkerLike;
    try {
      worker = this.options.createWorker();
    } catch (error) {
      this.fail(new AIError("LOAD_ERROR", `no se pudo crear el worker: ${describe(error)}`, true));
      return waiter;
    }
    this.worker = worker;
    this.workersCreated += 1;
    worker.onmessage = (event) => this.onMessage(worker, event.data);
    worker.onerror = (event) => this.onWorkerFault(worker, "POLICY_ERROR", event);
    worker.onmessageerror = (event) => this.onWorkerFault(worker, "INVALID_MESSAGE", event);

    this.setState("initializing");
    this.initTimer = setTimeout(
      () => this.failIfCurrent(worker, new AIError("TIMEOUT", "la inicialización del worker superó el límite", true)),
      this.initTimeoutMs,
    );

    const init: InitMessage = {
      type: "INIT",
      protocol_version: PROTOCOL_VERSION,
      session_id: this.sessionId,
      worker_generation: this.generation,
      expected: this.expected,
      config: { max_commands: MAX_COMMANDS },
    };
    worker.postMessage(init);
    return waiter;
  }

  decide(observation: ObserveMessage, signal?: AbortSignal): Promise<DecisionMessage> {
    if (this.state !== "ready" || !this.worker) {
      return Promise.reject(new AIError("INVALID_MESSAGE", `el proveedor no está listo (${this.state})`, false));
    }
    if (observation.session_id !== this.sessionId || observation.worker_generation !== this.generation) {
      return Promise.reject(new AIError("STALE_RESPONSE", "la observación no corresponde a la sesión o generación vigentes", false));
    }
    const checked = validateMessage(observation);
    if (!checked.ok) return Promise.reject(new AIError(checked.code, checked.detail, false));
    if (signal?.aborted) return Promise.reject(new AIError("ABORTED", "petición cancelada", false));

    return new Promise<DecisionMessage>((resolve, reject) => {
      const onAbort = (): void => this.abortPending();
      signal?.addEventListener("abort", onAbort, { once: true });
      const worker = this.worker!;
      this.pending = {
        observation,
        resolve,
        reject,
        timer: setTimeout(
          () => this.failIfCurrent(worker, new AIError("TIMEOUT", "la decisión superó el tiempo límite", true)),
          this.decisionTimeoutMs,
        ),
        detach: () => signal?.removeEventListener("abort", onAbort),
      };
      this.setState("busy");
      worker.postMessage(observation);
    });
  }

  /** Finaliza la partida: termina el worker y descarta pendientes. */
  stop(): void {
    this.disposeWorker(new AIError("ABORTED", "proveedor detenido", false));
    this.lastError = null;
    this.setState("stopped");
  }

  private abortPending(): void {
    if (!this.pending) return;
    // Terminar el worker es el único mecanismo que interrumpe Python bloqueado.
    this.disposeWorker(new AIError("ABORTED", "petición invalidada", false));
    this.setState("suspended");
  }

  private onMessage(worker: WorkerLike, raw: unknown): void {
    if (worker !== this.worker) return;
    const checked = validateMessage(raw);

    if (this.state === "initializing") return this.onInitMessage(worker, checked);

    if (!checked.ok) {
      if (this.pending) this.rejectPending(new AIError(checked.code, checked.detail, checked.code === "INCOMPATIBLE_VERSION"));
      else this.discardedMessages += 1;
      if (checked.code === "INCOMPATIBLE_VERSION") this.fail(new AIError(checked.code, checked.detail, true));
      else this.finishRequest();
      return;
    }

    const message = checked.message;
    if (message.type === "ERROR") {
      const matches =
        message.session_id === this.sessionId &&
        message.worker_generation === this.generation &&
        (message.request_id === undefined || message.request_id === this.pending?.observation.request_id);
      if (matches) this.fail(new AIError(message.code, message.message, true));
      else this.discardedMessages += 1;
      return;
    }

    const current = this.pending;
    if (message.type !== "DECISION" || !current) {
      this.discardedMessages += 1;
      return;
    }
    const sent = current.observation;
    const correlated =
      message.session_id === this.sessionId &&
      message.worker_generation === this.generation &&
      message.request_id === sent.request_id &&
      message.observation_tick === sent.observation_tick &&
      message.player_id === sent.player_id;
    if (!correlated) {
      this.discardedMessages += 1;
      return;
    }
    const semantic = checkDecisionSemantics(message);
    if (semantic) {
      this.rejectPending(new AIError("INVALID_MESSAGE", semantic, false));
      this.finishRequest();
      return;
    }
    this.clearPending();
    this.setState("ready");
    current.resolve(message);
  }

  private onInitMessage(worker: WorkerLike, checked: ReturnType<typeof validateMessage>): void {
    if (!checked.ok) return this.failIfCurrent(worker, new AIError(checked.code, checked.detail, true));
    const message = checked.message;
    if (message.type === "ERROR") {
      return this.failIfCurrent(worker, new AIError(message.code, message.message, true));
    }
    if (message.type !== "READY" || message.session_id !== this.sessionId || message.worker_generation !== this.generation) {
      this.discardedMessages += 1;
      return;
    }
    const { versions } = message;
    const compatible =
      versions.pyodide === this.expected.pyodide &&
      versions.python.startsWith(this.expected.python) &&
      versions.policy === this.expected.policy;
    if (!compatible) {
      return this.failIfCurrent(
        worker,
        new AIError("INCOMPATIBLE_VERSION", `versiones del worker ${versions.pyodide}/${versions.python}/${versions.policy}`, true),
      );
    }
    this.clearInitTimer();
    this.readyInfo = message;
    this.setState("ready");
    this.initWaiter?.resolve(message);
    this.initWaiter = null;
  }

  private onWorkerFault(worker: WorkerLike, code: ErrorCode, event: unknown): void {
    const fatalCode: ErrorCode = this.state === "initializing" ? "LOAD_ERROR" : code;
    this.failIfCurrent(worker, new AIError(fatalCode, `fallo del worker: ${describe(event)}`, true));
  }

  private failIfCurrent(worker: WorkerLike, error: AIError): void {
    if (worker === this.worker) this.fail(error);
  }

  private fail(error: AIError): void {
    this.disposeWorker(error);
    this.lastError = error;
    this.setState("failed");
  }

  /** Termina el worker, cancela temporizadores y rechaza lo pendiente con `reason`. */
  private disposeWorker(reason: AIError): void {
    const worker = this.worker;
    this.worker = null;
    this.clearInitTimer();
    if (this.pending) this.rejectPending(reason);
    if (this.initWaiter) {
      this.initWaiter.reject(reason);
      this.initWaiter = null;
    }
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
  }

  private rejectPending(error: AIError): void {
    const done = this.pending;
    if (!done) return;
    this.clearPending();
    done.reject(error);
  }

  private finishRequest(): void {
    if (this.state === "busy") this.setState("ready");
  }

  private clearPending(): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.detach();
    this.pending = null;
  }

  private clearInitTimer(): void {
    if (this.initTimer !== null) clearTimeout(this.initTimer);
    this.initTimer = null;
  }

  private setState(state: ProviderState): void {
    this.state = state;
    this.onStateChange?.(state, this.lastError);
  }
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && value !== null && "message" in value) return String((value as { message: unknown }).message);
  return "sin detalle";
}
