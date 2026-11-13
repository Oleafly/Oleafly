import "@/lib/polyfills";
import { createLayoutEngine, FRAME_MS, type LayoutRequest, type LayoutUpdate } from "./note-graph-layout";

interface LayoutScope {
  postMessage(message: LayoutUpdate, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<LayoutRequest>) => void) | null;
}

const scope = self as unknown as LayoutScope;

const engine = createLayoutEngine(
  (update) => scope.postMessage(update, [update.positions.buffer]),
  {
    set: (callback) => setTimeout(callback, FRAME_MS),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
);

scope.onmessage = (event) => engine.handle(event.data);
