import type { MusicTrack } from "./music";

/** Genera la música en un Worker dedicado para no bloquear el hilo del cuadro. */
export function loadMusicInWorker(seed = 7): Promise<MusicTrack> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === "undefined") {
      reject(new Error("Worker no disponible"));
      return;
    }
    const worker = new Worker(new URL("./music-worker.ts", import.meta.url), { type: "module" });
    const finish = (): void => worker.terminate();
    worker.onmessage = (event: MessageEvent<{ ok: boolean; message?: string } & Partial<MusicTrack>>) => {
      finish();
      const d = event.data;
      if (d.ok && d.left && d.right && d.sampleRate) resolve({ left: d.left, right: d.right, sampleRate: d.sampleRate });
      else reject(new Error(d.message ?? "Fallo al generar la música"));
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "Fallo del worker de música"));
    };
    worker.postMessage({ seed });
  });
}
