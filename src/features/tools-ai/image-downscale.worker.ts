// Shrinks and re-encodes one image for a hosted model or Mathpix off the
// main thread. The rules live in image-downscale-core.ts. Engines without
// OffscreenCanvas (some WebKitGTK builds) answer "unsupported" and the page
// does the work itself.
import "@/lib/polyfills";
import {
  decodeOriented,
  runDownscale,
  type DownscaleCanvas,
  type DownscaleReply,
  type DownscaleRequest,
} from "./image-downscale-core";

interface DownscaleMessage {
  id: number;
  request: DownscaleRequest;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<DownscaleMessage>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const workerScope = self as unknown as WorkerScope;

function offscreenCanvas(width: number, height: number): DownscaleCanvas {
  const canvas = new OffscreenCanvas(width, height);
  return {
    getContext: () => canvas.getContext("2d"),
    encode: (mime, quality) => canvas.convertToBlob({ type: mime, quality }).catch(() => null),
  };
}

function reply(id: number, result: DownscaleReply): void {
  if ("bytes" in result) workerScope.postMessage({ id, reply: result }, [result.bytes]);
  else workerScope.postMessage({ id, reply: result });
}

async function handle({ id, request }: DownscaleMessage): Promise<void> {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
    reply(id, { error: "unsupported" });
    return;
  }
  try {
    reply(id, await runDownscale(request, { decode: decodeOriented, canvas: offscreenCanvas }));
  } catch {
    reply(id, { error: "unsupported" });
  }
}

workerScope.onmessage = (event) => {
  void handle(event.data);
};
