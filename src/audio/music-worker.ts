import { renderMusic } from "./music";

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const seed = (event.data as { seed?: number } | null)?.seed ?? 7;
  try {
    const track = renderMusic(seed);
    scope.postMessage({ ok: true, ...track }, [track.left.buffer, track.right.buffer]);
  } catch (error) {
    scope.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
};
