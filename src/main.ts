import { AIDirector } from "./ai-client/director";
import { WorkerAIProvider, type WorkerLike } from "./ai-client/provider";
import { GameSession } from "./app/session";
import { AudioDirector } from "./audio/director";
import { AudioEngine } from "./audio/engine";
import { loadMusicInWorker } from "./audio/music-loader";
import { loadSettings } from "./audio/settings";
import { BALANCE, TICKS_PER_SECOND, validateBalance } from "./content/balance";
import { MAP_DEPTH, MAP_LAYOUT, MAP_WIDTH, validateMapLayout } from "./content/map";
import { AUDIO_VERSION, BALANCE_VERSION, GAME_VERSION, GRAPHICS_VERSION, MAP_VERSION } from "./content/versions";
import { createFixture, type FixtureName } from "./core/fixtures";
import { hashState } from "./core/hash";
import { validateInitialReachability } from "./core/map-check";
import { describeEnd } from "./core/result";
import { createInitialState, livingOf, reservedOf } from "./core/state";
import type { Command } from "./core/types";
import { PerfRecorder } from "./diagnostics/recorder";
import { buildReport } from "./diagnostics/report";
import { CameraRig } from "./input/camera-rig";
import { InputController } from "./input/controller";
import { clearSelection, emptySelection, pruneSelection } from "./input/selection";
import { SceneView } from "./rendering/scene-view";
import { CommandPanel } from "./ui/command-panel";
import { describeResult, REJECT_TEXT, toastKind } from "./ui/messages";
import { Minimap } from "./ui/minimap";
import { ToastCenter } from "./ui/toasts";

const FIXTURES: readonly FixtureName[] = ["corridor20", "crossing", "crowd100", "skirmish", "objetivo", "defensa", "sonidos", "realismo", "rio"];

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
    const finalParam = params.get("final");
    const final = finalParam === "victoria" || finalParam === "derrota" ? finalParam : undefined;
    const created = new GameSession(1, fixtureName ? createFixture(fixtureName, { final }) : undefined);
    created.tickObserver = (ms) => perf.recordTick(ms);
    return created;
  };

  const rig = new CameraRig(MAP_WIDTH, MAP_DEPTH, { x: 16, z: MAP_DEPTH / 2 });
  // `?graphics=low` desactiva sombras, antialiasing, decoración fina y animación del agua; `?shadows=0` solo las sombras.
  const quality = params.get("graphics") === "low" ? "low" : "high";
  const view = new SceneView(el<HTMLCanvasElement>("view"), MAP_WIDTH, MAP_DEPTH, rig, quality, params.get("shadows") !== "0");
  const hud = el("hud");
  const overlay = el("overlay");
  const toasts = new ToastCenter(el("toasts"));
  const resourceBar = { food: el("res-food"), wood: el("res-wood"), stone: el("res-stone"), pop: el("res-pop") };
  const setText = (node: HTMLElement, text: string): void => {
    if (node.textContent !== text) node.textContent = text;
  };
  const logsButton = el<HTMLButtonElement>("btn-logs");
  // Los registros arrancan ocultos en cada carga; el estado no se guarda.
  let logsVisible = false;
  const setLogs = (visible: boolean): void => {
    logsVisible = visible;
    hud.classList.toggle("visible", visible);
    logsButton.setAttribute("aria-pressed", String(visible));
  };
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

  // `?audio=0` desactiva todo el audio; sin Web Audio el juego sigue sin sonido.
  const engine = params.get("audio") === "0" ? null : new AudioEngine({ settings: loadSettings(), loadMusic: () => loadMusicInWorker() });
  const audio = engine ? new AudioDirector(engine) : null;
  let audioFault = false;
  let audioPaused = false;
  const musicButton = el<HTMLButtonElement>("btn-music");
  const sfxButton = el<HTMLButtonElement>("btn-sfx");
  const refreshAudioButtons = (): void => {
    if (!engine) return;
    const { settings } = engine;
    musicButton.textContent = `Música: ${settings.music && !settings.muted ? "sí" : "no"}`;
    sfxButton.textContent = `Efectos: ${settings.sfx && !settings.muted ? "sí" : "no"}`;
  };
  if (engine) {
    refreshAudioButtons();
    // Los navegadores solo permiten audio tras un gesto del usuario.
    const unlock = (): void => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      void engine.unlock();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    musicButton.addEventListener("click", () => {
      engine.setMusic(!engine.settings.music);
      refreshAudioButtons();
    });
    sfxButton.addEventListener("click", () => {
      engine.setSfx(!engine.settings.sfx);
      refreshAudioButtons();
    });
    window.addEventListener("keydown", (event) => {
      if ((event.key === "m" || event.key === "M") && !event.ctrlKey && !event.metaKey && !event.altKey) {
        engine.toggleMuted();
        refreshAudioButtons();
      }
    });
  } else {
    musicButton.style.display = "none";
    sfxButton.style.display = "none";
  }
  const audioLine = (): string =>
    !engine
      ? "Audio: desactivado (?audio=0)"
      : audioFault
        ? "Audio: error, desactivado"
        : `Audio: ${engine.status} · voces ${engine.activeVoices} · descartados ${engine.droppedVoices} · fuego ${engine.fireLoops} · música ${engine.music}`;

  /** Aviso temporal en pantalla; el último texto también queda en el panel de registros. */
  function notify(text: string): void {
    message = text;
    toasts.show(text, toastKind(text));
  }

  const controller = new InputController(
    el<HTMLCanvasElement>("view"),
    view,
    rig,
    {
      getSession: () => session,
      selection,
      notify,
      sticky: (id, text) => toasts.showSticky(id, text),
      clearSticky: (id) => toasts.clear(id),
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
      notify("En pausa: reanude para dar órdenes");
      return;
    }
    pendingOrder = session.issue({ ...partial, player: 0 });
    message = "Orden enviada…";
  };
  const panel = new CommandPanel(el("panel"), {
    build: (kind) => {
      const { cost } = BALANCE.buildings[kind];
      const p = session.state.players[0];
      if (!session.paused && (p.food < cost.food || p.wood < cost.wood || p.stone < cost.stone)) return notify(`Orden rechazada: ${REJECT_TEXT.INSUFFICIENT_RESOURCES}`);
      controller.beginPlacement(kind);
    },
    train: (id, kind) => panelOrder({ type: "Train", entityIds: [id], kind }),
    cancelTraining: (id, item) => panelOrder({ type: "CancelTraining", entityIds: [id], target: { entityId: item } }),
    cancelBuild: (id) => panelOrder({ type: "CancelBuild", entityIds: [id] }),
    stop: (ids) => panelOrder({ type: "Stop", entityIds: ids }),
  }, el("info"));
  const minimap = new Minimap(el<HTMLCanvasElement>("minimap"), MAP_WIDTH, MAP_DEPTH, { centerOn: (x, z) => rig.centerOn(x, z) });

  const outcomeText = (): string => {
    const outcome = session.state.outcome;
    const end = describeEnd(session.state);
    if (!outcome || !end) return "";
    const centers = outcome.mainBuildings
      .map((b) => `centro ${b.owner === 0 ? "propio" : "rival"} #${b.id}: ${b.destroyed ? "destruido" : "en pie"} (vida ${b.hp}/${b.maxHp})`)
      .join(" · ");
    const lost = outcome.casualties;
    return (
      `${end.title}\n${end.reason}\n` +
      `Fin en el tick ${outcome.endTick} · ${centers}\n` +
      `Bajas propias: ${lost.units[0]} unidades, ${lost.buildings[0]} edificios · rivales: ${lost.units[1]} unidades, ${lost.buildings[1]} edificios\n` +
      `Pulse «Reiniciar» para jugar de nuevo`
    );
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
        notify(describeResult(entry.result, entry.command.type));
        pendingOrder = null;
      }
    }

    const p = s.players[0];
    const reserved = reservedOf(s, 0);
    setText(resourceBar.food, String(p.food));
    setText(resourceBar.wood, String(p.wood));
    setText(resourceBar.stone, String(p.stone));
    setText(resourceBar.pop, `${livingOf(s, 0)}${reserved > 0 ? ` (+${reserved})` : ""} / ${p.popCapacity}`);
    toasts.update();
    if (logsVisible)
      hud.textContent =
      `Tick ${s.tick}/${TICKS_PER_SECOND * 1200}  hash ${hashState(s)}\n` +
      `${message}\n` +
      `${aiLine()}\n` +
      `${perfText}\n` +
      `${audioLine()}\n` +
      `Rutas en cola ${s.pathQueue.length} · sobrecargas ${session.overloadEvents}` +
      `${fixtureName ? ` · fixture ${fixtureName}` : ""}${errors.length > 0 ? ` · errores ${errors.length}` : ""}\n` +
      `v${GAME_VERSION} · ${MAP_VERSION} · ${BALANCE_VERSION} · ${AUDIO_VERSION} · GFX: ${GRAPHICS_VERSION} · semilla ${s.seed}\n` +
      `H: ayuda · Esc: cancelar/limpiar selección`;

    panel.refresh(s, selection, controller.placing, session.paused);

    view.setSelection(selection.units, selection.inspected);
    minimap.draw(s, view.viewFootprint());
    view.sync(s, { frozen: session.paused || s.matchStatus === "ended", paused: session.paused, strikes: session.strikeLog, destroyed: session.destroyedLog });
    if (audio && engine && !audioFault) {
      // Un fallo del audio nunca detiene ni pausa la partida.
      try {
        if (session.paused !== audioPaused) {
          audioPaused = session.paused;
          engine.setPaused(audioPaused);
        }
        audio.update(session, view.projector());
      } catch (error) {
        audioFault = true;
        if (errors.length < 20) errors.push(`audio: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
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
      toasts.show(message, "error");
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
    view.reset();
    audio?.reset();
    ai = aiEnabled ? createAI(session) : null;
    ai?.director.start();
    clearSelection(selection);
    controller.cancelPlacement();
    pendingOrder = null;
    message = "";
    toasts.clearAll();
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
  setLogs(false);

  const help = el("help");
  const toggleHelp = (): void => {
    help.classList.toggle("visible");
  };
  el("btn-help").addEventListener("click", toggleHelp);
  el("help-close").addEventListener("click", toggleHelp);
  logsButton.addEventListener("click", () => setLogs(!logsVisible));
  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "h" || event.key === "H") toggleHelp();
    else if (event.key === "l" || event.key === "L") setLogs(!logsVisible);
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
    notify("Diagnóstico exportado");
  });

  window.addEventListener("error", (event) => fail(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => fail(event.reason));

  refreshOverlay();
  requestAnimationFrame(frame);
}

start();
