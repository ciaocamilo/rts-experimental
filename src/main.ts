import { AIDirector } from "./ai-client/director";
import { WorkerAIProvider, type WorkerLike } from "./ai-client/provider";
import { GameSession } from "./app/session";
import { BALANCE, TICKS_PER_SECOND, validateBalance } from "./content/balance";
import { MAP_LAYOUT, MAP_SIZE, validateMapLayout } from "./content/map";
import { BALANCE_VERSION, GAME_VERSION, MAP_VERSION } from "./content/versions";
import { createFixture, type FixtureName } from "./core/fixtures";
import { hashState } from "./core/hash";
import { validateInitialReachability } from "./core/map-check";
import { createInitialState, livingOf, reservedOf } from "./core/state";
import type { Command } from "./core/types";
import { PerfRecorder } from "./diagnostics/recorder";
import { buildReport } from "./diagnostics/report";
import { CameraRig } from "./input/camera-rig";
import { InputController } from "./input/controller";
import { clearSelection, describeEntity, emptySelection, pruneSelection } from "./input/selection";
import { SceneView } from "./rendering/scene-view";
import { CommandPanel } from "./ui/command-panel";
import { describeResult } from "./ui/messages";

const FIXTURES: readonly FixtureName[] = ["corridor20", "crossing", "crowd100", "skirmish", "objetivo"];

function supported(): boolean {
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") return false;
  return document.createElement("canvas").getContext("webgl2") !== null;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta #${id}`);
  return node as T;
}

function newSessionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function createAI(session: GameSession): { provider: WorkerAIProvider; director: AIDirector } {
  const provider = new WorkerAIProvider({
    sessionId: newSessionId(),
    createWorker: () => new Worker(new URL("./ai-worker/worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike,
  });
  return { provider, director: new AIDirector(session, provider, { playerId: 1 }) };
}

function start(): void {
  if (!supported()) {
    el("unsupported").style.display = "flex";
    return;
  }

  validateBalance(BALANCE);
  validateMapLayout(MAP_LAYOUT);
  validateInitialReachability(createInitialState(0));

  const params = new URLSearchParams(location.search);
  const fixtureParam = params.get("fixture");
  const fixtureName = FIXTURES.find((f) => f === fixtureParam);
  const aiEnabled = params.get("ai") !== "0" && (!fixtureName || fixtureName === "objetivo");
  let perf = new PerfRecorder();
  const errors: string[] = [];
  const newSession = (): GameSession => {
    const created = new GameSession(1, fixtureName ? createFixture(fixtureName) : undefined);
    created.tickObserver = (ms) => perf.recordTick(ms);
    return created;
  };

  const rig = new CameraRig(MAP_SIZE);
  const view = new SceneView(el<HTMLCanvasElement>("view"), MAP_SIZE, rig);
  const hud = el("hud");
  const overlay = el("overlay");
  const pauseButton = el<HTMLButtonElement>("btn-pause");
  const selection = emptySelection();
  let session = newSession();
  let ai = aiEnabled ? createAI(session) : null;
  ai?.director.start();
  let message = "";
  let pendingOrder: string | null = null;
  let lastTime: number | null = null;
  let overlayKey = "";
  let perfText = "";
  let perfAt = -Infinity;

  const controller = new InputController(
    el<HTMLCanvasElement>("view"),
    view,
    rig,
    {
      getSession: () => session,
      selection,
      message: (text) => {
        message = text;
      },
      onOrder: (id) => {
        pendingOrder = id;
        message = "Orden enviada…";
      },
    },
    el("drag-box"),
  );

  /** Orden desde el panel: mismo canal y mensajes que las órdenes del ratón. */
  const panelOrder = (partial: Pick<Command, "type" | "entityIds" | "target" | "kind">): void => {
    if (session.paused) {
      message = "En pausa: reanude para dar órdenes";
      return;
    }
    pendingOrder = session.issue({ ...partial, player: 0 });
    message = "Orden enviada…";
  };
  const panel = new CommandPanel(el("panel"), {
    build: (kind) => controller.beginPlacement(kind),
    train: (id, kind) => panelOrder({ type: "Train", entityIds: [id], kind }),
    cancelTraining: (id, item) => panelOrder({ type: "CancelTraining", entityIds: [id], target: { entityId: item } }),
    cancelBuild: (id) => panelOrder({ type: "CancelBuild", entityIds: [id] }),
    stop: (ids) => panelOrder({ type: "Stop", entityIds: ids }),
  });

  const outcomeText = (): string => {
    const outcome = session.state.outcome;
    if (!outcome) return "";
    const title = outcome.winner === null ? "Empate" : outcome.winner === 0 ? "Victoria" : "Derrota";
    const why = outcome.reason === "TIME_LIMIT" ? "se agotó el tiempo de la partida" : outcome.winner === null ? "ambos centros urbanos cayeron a la vez" : outcome.winner === 0 ? "el centro urbano rival fue destruido" : "su centro urbano fue destruido";
    return `${title}\n${why}\nPulse «Reiniciar» para jugar de nuevo`;
  };

  const refreshOverlay = (): void => {
    const status = ai?.director.status;
    const ended = outcomeText();
    const key = `${session.paused}|${status}|${ended}`;
    if (key === overlayKey) return;
    overlayKey = key;
    const visible = ended !== "" || session.paused;
    overlay.classList.toggle("visible", visible);
    if (ended !== "") overlay.textContent = ended;
    else if (!session.paused) overlay.textContent = "";
    else if (status === "failed") overlay.textContent = `IA Python no disponible: ${ai?.director.message ?? ""}\nSimulación pausada. Pulse «Recuperar IA».`;
    else if (status === "recovering") overlay.textContent = "Recuperando la IA…";
    else if (status === "recovered") overlay.textContent = "IA recuperada — pulse Reanudar";
    else overlay.textContent = "Pausa — pulse Reanudar";
    pauseButton.disabled = status === "recovering" || ended !== "";
    pauseButton.textContent = status === "failed" ? "Recuperar IA" : status === "recovering" ? "Recuperando…" : session.paused ? "Reanudar" : "Pausar";
  };

  const aiLine = (): string => {
    if (!ai) return "IA Python: desactivada";
    const { provider, director } = ai;
    const total = provider.readyInfo?.timings_ms.total;
    const last = director.log[director.log.length - 1];
    return (
      `${director.message} · worker ${provider.state} gen ${provider.generation}` +
      `${total !== undefined ? ` · carga ${total.toFixed(0)} ms` : ""}` +
      ` · p95 ${director.latencyP95.toFixed(0)} ms (política ${director.policyP95.toFixed(1)})` +
      ` · enviadas ${director.requestsSent} aplicadas ${director.decisionsApplied}` +
      ` descartadas ${director.decisionsDiscarded + provider.discardedMessages}` +
      `${last ? `\nÚltima orden IA: ${last.type} [${last.reasons.join(",")}] ${last.outcome}${last.code ? ` (${last.code})` : ""}` : ""}`
    );
  };

  const step = (now: number): void => {
    const delta = lastTime === null ? 0 : now - lastTime;
    lastTime = now;
    perf.recordFrame(delta, session.paused);
    controller.update(Math.min(delta, 100) / 1000);
    session.advance(delta);
    ai?.director.update();
    refreshOverlay();

    const s = session.state;
    perf.observeLoad(s.pathQueue.length, s.units.length);
    if (now - perfAt > 500) {
      perfAt = now;
      const m = perf.summary();
      perfText = `FPS (mediana) ${m.medianFps.toFixed(0)} · cuadro p95 ${m.frameMsP95.toFixed(1)} ms · tick p95 ${m.tickMsP95.toFixed(2)} ms · pausa ${(m.pausedMs / 1000).toFixed(0)} s`;
    }
    pruneSelection(selection, s);

    if (pendingOrder !== null) {
      const entry = [...session.commandLog].reverse().find((e) => e.command.id === pendingOrder);
      if (entry) {
        message = describeResult(entry.result, entry.command.type);
        pendingOrder = null;
      }
    }

    const p = s.players[0];
    const selected = selection.units.size;
    const inspected = selection.inspected !== null ? describeEntity(s, selection.inspected) : "";
    const first = selected === 1 ? describeEntity(s, [...selection.units][0]!) : "";
    const living = livingOf(s, 0);
    const reserved = reservedOf(s, 0);
    hud.textContent =
      `Tick ${s.tick}/${TICKS_PER_SECOND * 1200}  hash ${hashState(s)}\n` +
      `Jugador: alimento ${p.food}  madera ${p.wood}  población ${living}${reserved > 0 ? ` (+${reserved} en cola)` : ""}/${p.popCapacity}\n` +
      `Selección: ${selected} unidad(es) ${first}${inspected ? `  Inspección: ${inspected}` : ""}\n` +
      `${message}\n` +
      `${aiLine()}\n` +
      `${perfText}\n` +
      `Rutas en cola ${s.pathQueue.length} · sobrecargas ${session.overloadEvents}` +
      `${fixtureName ? ` · fixture ${fixtureName}` : ""}${errors.length > 0 ? ` · errores ${errors.length}` : ""}\n` +
      `v${GAME_VERSION} · ${MAP_VERSION} · ${BALANCE_VERSION} · semilla ${s.seed}\n` +
      `H: ayuda · Esc: cancelar/limpiar selección`;

    panel.refresh(s, selection, controller.placing, session.paused);

    view.setSelection(selection.units, selection.inspected);
    view.sync(s);
    view.render();
  };

  /** Un fallo en un fotograma no detiene el bucle: pausa la partida y permite reiniciar (RNF-04). */
  const fail = (error: unknown): void => {
    const text = error instanceof Error ? error.message : String(error);
    if (errors.length < 20) errors.push(text);
    if (errors.length === 1) {
      session.pause();
      ai?.director.suspend();
      message = `Error inesperado: ${text}. Partida pausada; puede reiniciar.`;
      refreshOverlay();
    }
  };

  const frame = (now: number): void => {
    try {
      step(now);
    } catch (error) {
      fail(error);
    } finally {
      requestAnimationFrame(frame);
    }
  };

  pauseButton.addEventListener("click", () => {
    const director = ai?.director;
    if (director?.status === "failed") {
      void director.recover().then(refreshOverlay);
    } else if (director?.status === "recovering") {
      return;
    } else if (session.paused) {
      session.resume();
      director?.resume();
    } else {
      session.pause();
      director?.suspend();
    }
    refreshOverlay();
  });
  el("btn-restart").addEventListener("click", () => {
    ai?.director.dispose();
    perf = new PerfRecorder();
    errors.length = 0;
    session = newSession();
    ai = aiEnabled ? createAI(session) : null;
    ai?.director.start();
    clearSelection(selection);
    controller.cancelPlacement();
    pendingOrder = null;
    message = "";
    refreshOverlay();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      session.pause();
      if (ai && ai.director.status !== "recovering") ai.director.suspend();
      refreshOverlay();
    }
  });
  window.addEventListener("resize", () => view.resize());

  const help = el("help");
  const toggleHelp = (): void => {
    help.classList.toggle("visible");
  };
  el("btn-help").addEventListener("click", toggleHelp);
  el("help-close").addEventListener("click", toggleHelp);
  window.addEventListener("keydown", (event) => {
    if ((event.key === "h" || event.key === "H") && !event.ctrlKey && !event.metaKey && !event.altKey) toggleHelp();
  });

  el("btn-export").addEventListener("click", () => {
    const report = buildReport({
      session,
      perf,
      fixture: fixtureName ?? null,
      env: { userAgent: navigator.userAgent, gpu: view.gpuInfo(), viewport: `${window.innerWidth}x${window.innerHeight}`, devicePixelRatio: window.devicePixelRatio, renderScale: 1 },
      ai,
      errors,
    });
    const url = URL.createObjectURL(new Blob([JSON.stringify(report)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `rts-diagnostico-tick${session.state.tick}.json`;
    link.click();
    URL.revokeObjectURL(url);
    message = "Diagnóstico exportado";
  });

  window.addEventListener("error", (event) => fail(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => fail(event.reason));

  refreshOverlay();
  requestAnimationFrame(frame);
}

start();
