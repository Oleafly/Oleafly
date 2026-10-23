// Sizing attached images for a model: keep small files as they are,
// downscale large ones to fit 2,048 px, and make a small thumbnail. The
// work runs in a module worker; WebKitGTK builds without OffscreenCanvas
// use the main thread.
import { AttachmentError } from "@/lib/attachments-intake";
import { mimeForPath } from "@/lib/image-mime";
import { logError } from "@/lib/log";

export interface ImageNormalizeResult {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  thumbnailUrl: string;
}

export interface ImageJob {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
  detectAlpha: boolean;
  /** False keeps the original bytes; only the thumbnail is made. */
  encode: boolean;
}

export type ImageJobResult = { bytes?: ArrayBuffer; mime?: string; thumbnailUrl: string };

const KEEP_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const ALPHA_TYPES = new Set(["image/png", "image/gif", "image/webp", "image/avif"]);
const KEEP_BYTES = 5 * 1024 * 1024;
const WORKER_TIMEOUT_MS = 30_000;
/** The worker holds its module and canvases while it lives; it goes after this long without a job. */
const WORKER_IDLE_MS = 60_000;
export const ENCODE_QUALITY = 0.85;
export const THUMB_QUALITY = 0.7;

/** The size that fits inside `maxEdge` on its long edge; never upscaled. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest <= 0) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Small PNG, JPEG, WebP and GIF files go to the model byte for byte. */
export function keepsOriginal(
  input: { mime: string; size: number; width: number; height: number },
  maxEdge: number,
  keepBytes: number = KEEP_BYTES,
): boolean {
  return (
    KEEP_TYPES.has(input.mime) &&
    input.size <= keepBytes &&
    Math.max(input.width, input.height) <= maxEdge
  );
}

/** True when any pixel is not fully opaque. */
export function hasTransparency(data: Uint8ClampedArray): boolean {
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) return true;
  }
  return false;
}

let worker: Worker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let nextJob = 0;
const jobs = new Map<
  number,
  { resolve: (value: ImageJobResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
>();

function failAll(error: Error): void {
  for (const [id, job] of jobs) {
    clearTimeout(job.timer);
    job.reject(error);
    jobs.delete(id);
  }
}

function stopWorker(): void {
  clearTimeout(idleTimer);
  idleTimer = undefined;
  worker?.terminate();
  worker = null;
}

/** With no job left, the worker leaves after a while. */
function stopWorkerWhenIdle(): void {
  clearTimeout(idleTimer);
  if (jobs.size > 0) return;
  idleTimer = setTimeout(() => {
    if (jobs.size === 0) stopWorker();
  }, WORKER_IDLE_MS);
}

function imageWorker(): Worker | null {
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./image-normalize.worker.ts", import.meta.url), {
      type: "module",
      name: "oleafly-image-normalize",
    });
  } catch {
    return null;
  }
  worker.onmessage = (event: MessageEvent) => {
    const data = event.data as { id: number; ok: boolean; error?: string } & ImageJobResult;
    const job = jobs.get(data.id);
    if (!job) return;
    jobs.delete(data.id);
    clearTimeout(job.timer);
    if (data.ok) job.resolve({ bytes: data.bytes, mime: data.mime, thumbnailUrl: data.thumbnailUrl });
    else job.reject(new Error(data.error ?? "image worker failed"));
    stopWorkerWhenIdle();
  };
  worker.onerror = () => {
    failAll(new Error("image worker crashed"));
    stopWorker();
  };
  return worker;
}

function runInWorker(target: Worker, job: ImageJob): Promise<ImageJobResult> {
  const id = ++nextJob;
  clearTimeout(idleTimer);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // A worker that did not answer is stuck, and the jobs queued behind it
      // would wait just as long: drop it, and the next image gets a new one.
      jobs.delete(id);
      reject(new Error("image worker timed out"));
      failAll(new Error("image worker timed out"));
      stopWorker();
    }, WORKER_TIMEOUT_MS);
    jobs.set(id, { resolve, reject, timer });
    target.postMessage({ id, ...job }, [job.bitmap]);
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("could not encode the image"))),
      type,
      quality,
    );
  });
}

async function encodeOnMainThread(job: ImageJob): Promise<ImageJobResult> {
  try {
    const thumb = document.createElement("canvas");
    thumb.width = job.thumbWidth;
    thumb.height = job.thumbHeight;
    const thumbContext = thumb.getContext("2d");
    if (!thumbContext) throw new Error("no 2d context");
    thumbContext.fillStyle = "#ffffff";
    thumbContext.fillRect(0, 0, thumb.width, thumb.height);
    thumbContext.drawImage(job.bitmap, 0, 0, thumb.width, thumb.height);
    const thumbnailUrl = thumb.toDataURL("image/jpeg", THUMB_QUALITY);
    if (!job.encode) return { thumbnailUrl };

    const canvas = document.createElement("canvas");
    canvas.width = job.width;
    canvas.height = job.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(job.bitmap, 0, 0, job.width, job.height);
    const alpha =
      job.detectAlpha && hasTransparency(context.getImageData(0, 0, job.width, job.height).data);
    let blob: Blob;
    if (alpha) {
      blob = await canvasBlob(canvas, "image/png");
    } else {
      blob = await canvasBlob(canvas, "image/webp", ENCODE_QUALITY);
      if (blob.type !== "image/webp") blob = await canvasBlob(canvas, "image/jpeg", ENCODE_QUALITY);
    }
    return { bytes: await blob.arrayBuffer(), mime: blob.type, thumbnailUrl };
  } finally {
    job.bitmap.close();
  }
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    // HEIC and TIFF on WebView2, for example.
    throw new AttachmentError("unreadableImage");
  }
}

async function rasterizeSvg(
  file: File,
  maxEdge: number,
  thumbEdge: number,
): Promise<ImageNormalizeResult> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new AttachmentError("unreadableImage");
    }
    const natural = {
      width: image.naturalWidth || 1024,
      height: image.naturalHeight || 1024,
    };
    const size = fitWithin(natural.width, natural.height, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new AttachmentError("unreadableImage");
    context.drawImage(image, 0, 0, size.width, size.height);
    const blob = await canvasBlob(canvas, "image/png");
    const thumbSize = fitWithin(size.width, size.height, thumbEdge);
    const thumb = document.createElement("canvas");
    thumb.width = thumbSize.width;
    thumb.height = thumbSize.height;
    const thumbContext = thumb.getContext("2d");
    if (thumbContext) {
      thumbContext.fillStyle = "#ffffff";
      thumbContext.fillRect(0, 0, thumb.width, thumb.height);
      thumbContext.drawImage(canvas, 0, 0, thumb.width, thumb.height);
    }
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mime: "image/png",
      width: size.width,
      height: size.height,
      thumbnailUrl: thumb.toDataURL("image/jpeg", THUMB_QUALITY),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function normalizeImage(
  file: File,
  options: { maxEdge: number; thumbEdge: number },
): Promise<ImageNormalizeResult> {
  const mime = (file.type || mimeForPath(file.name) || "").toLowerCase();
  if (mime === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
    return rasterizeSvg(file, options.maxEdge, options.thumbEdge);
  }
  let bitmap = await decode(file);
  const { width, height } = bitmap;
  const keep = keepsOriginal({ mime, size: file.size, width, height }, options.maxEdge);
  const target = fitWithin(width, height, options.maxEdge);
  const thumb = fitWithin(width, height, options.thumbEdge);
  const job = (source: ImageBitmap): ImageJob => ({
    bitmap: source,
    width: target.width,
    height: target.height,
    thumbWidth: thumb.width,
    thumbHeight: thumb.height,
    detectAlpha: ALPHA_TYPES.has(mime),
    encode: !keep,
  });

  let result: ImageJobResult | null = null;
  const offThread = imageWorker();
  if (offThread) {
    try {
      result = await runInWorker(offThread, job(bitmap));
    } catch (error) {
      void logError("image worker", error);
      // The bitmap went to the worker; decode again for the fallback.
      bitmap = await decode(file);
    }
  }
  result ??= await encodeOnMainThread(job(bitmap));

  if (keep || !result.bytes) {
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      mime,
      width,
      height,
      thumbnailUrl: result.thumbnailUrl,
    };
  }
  return {
    bytes: new Uint8Array(result.bytes),
    mime: result.mime ?? "image/png",
    width: target.width,
    height: target.height,
    thumbnailUrl: result.thumbnailUrl,
  };
}
