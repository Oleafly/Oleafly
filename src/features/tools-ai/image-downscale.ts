// Shrinks an image for a hosted model or Mathpix in a module worker. The
// page does the work itself only when the worker cannot (no OffscreenCanvas
// in some WebKitGTK builds, or the worker failed to start).
import { i18n } from "@/i18n";
import {
  decodeOriented,
  runDownscale,
  type DownscaleCanvas,
  type DownscaleReply,
  type DownscaleRequest,
} from "./image-downscale-core";
import type { ImageBudget, ImageInput, ToolImageMime } from "./image-input";
import { ToolsModelError } from "./tools-model";

export type Downscaler = (input: ImageInput, budget: ImageBudget) => Promise<ImageInput>;

const WORKER_TIMEOUT_MS = 60_000;

let worker: Worker | null = null;
let nextRequest = 0;
const pending = new Map<number, (reply: DownscaleReply) => void>();

function settleAll(reply: DownscaleReply): void {
  for (const [id, settle] of pending) {
    pending.delete(id);
    settle(reply);
  }
}

function downscaleWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./image-downscale.worker.ts", import.meta.url), {
      type: "module",
      name: "oleafly-image-downscale",
    });
  } catch {
    return null;
  }
  worker.onmessage = (event: MessageEvent<{ id: number; reply: DownscaleReply }>) => {
    const settle = pending.get(event.data.id);
    if (!settle) return;
    pending.delete(event.data.id);
    settle(event.data.reply);
  };
  worker.onerror = () => {
    settleAll({ error: "unsupported" });
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function inWorker(target: Worker, request: DownscaleRequest): Promise<DownscaleReply> {
  const id = ++nextRequest;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ error: "unsupported" });
    }, WORKER_TIMEOUT_MS);
    pending.set(id, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    try {
      target.postMessage({ id, request }, [request.bytes]);
    } catch {
      pending.delete(id);
      clearTimeout(timer);
      resolve({ error: "unsupported" });
    }
  });
}

function pageCanvas(width: number, height: number): DownscaleCanvas {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return {
    getContext: () => canvas.getContext("2d"),
    encode: (mime, quality) =>
      new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), mime, quality);
      }),
  };
}

function mainThreadDownscale(request: DownscaleRequest): Promise<DownscaleReply> {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") {
    return Promise.resolve({ error: "unsupported" });
  }
  return runDownscale(request, { decode: decodeOriented, canvas: pageCanvas });
}

/** A copy the worker can own: transferring detaches the buffer. */
function request(input: ImageInput, budget: ImageBudget): DownscaleRequest {
  return {
    bytes: input.bytes.slice().buffer,
    mime: input.mime,
    maxEdge: budget.maxEdge,
    maxBytes: budget.maxBytes,
    accept: [...budget.accept],
  };
}

export const downscaleImage: Downscaler = async (input, budget) => {
  const target = downscaleWorker();
  let reply: DownscaleReply = target
    ? await inWorker(target, request(input, budget))
    : { error: "unsupported" };
  if ("error" in reply && reply.error === "unsupported") {
    reply = await mainThreadDownscale(request(input, budget));
  }
  if ("error" in reply) {
    if (reply.error === "too-large") {
      throw new ToolsModelError(i18n.t(($) => $.researchTools.converterModel.errors.imageTooLarge));
    }
    throw new Error(i18n.t(($) => $.researchTools.converterErrors.imageFormat));
  }
  if (reply.unchanged) return input;
  return { bytes: new Uint8Array(reply.bytes), mime: reply.mime as ToolImageMime };
};
