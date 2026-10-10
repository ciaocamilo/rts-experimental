import { PROTOCOL_VERSION, PYODIDE_VERSION } from "../ai-client/protocol";
import { WorkerHost, type PyodideLike } from "./host";
import { POLICY_FILES } from "./policy-bundle";

interface WorkerScope {
  postMessage(message: unknown): void;
  location: { href: string };
  onmessage: ((event: { data: unknown }) => void) | null;
}
const scope = self as unknown as WorkerScope;

const baseUrl = new URL(`${import.meta.env.BASE_URL}vendor/pyodide/${PYODIDE_VERSION}/`, scope.location.href).href;

const host = new WorkerHost({
  post: (message) => scope.postMessage(message),
  files: POLICY_FILES,
  now: () => performance.now(),
  loadPyodide: async () => {
    const module = (await import(/* @vite-ignore */ `${baseUrl}pyodide.mjs`)) as {
      loadPyodide(options: { indexURL: string }): Promise<PyodideLike>;
    };
    return module.loadPyodide({ indexURL: baseUrl });
  },
});

scope.onmessage = (event) => {
  void host.handle(event.data);
};

// Pyodide puede dejar pendiente su promesa de carga cuando falla la descarga del WASM y solo emite un rechazo sin capturar.
self.addEventListener("unhandledrejection", (event) => {
  const reason = (event as PromiseRejectionEvent).reason as unknown;
  const text = reason instanceof Error ? reason.message : String(reason);
  scope.postMessage({
    type: "ERROR",
    protocol_version: PROTOCOL_VERSION,
    code: "LOAD_ERROR",
    message: text.split("\n")[0]!.slice(0, 200),
  });
});
