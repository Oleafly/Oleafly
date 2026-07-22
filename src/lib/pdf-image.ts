import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "@oleafly/preview/pdf.worker?worker&url";
import { installMainThreadPdfWorker } from "@oleafly/preview/mainThreadWorker";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

// Session-wide last resort shared with PdfViewer's ladder: a worker subsystem
// wedged by WKWebView renders every fresh PDFWorker dead, so downgrade to the
// main-thread loopback worker once two real-worker attempts have timed out.
let mainThreadInstall: Promise<void> | null = null;

async function forceMainThreadWorker(): Promise<void> {
  if (!mainThreadInstall) {
    mainThreadInstall = installMainThreadPdfWorker().catch((error) => {
      mainThreadInstall = null;
      throw error;
    });
  }
  await mainThreadInstall;
}

let sharedWorker: pdfjsLib.PDFWorker | null = null;

// A wedged worker subsystem never resolves `worker.promise`, so a short
// handshake probe detects it in seconds instead of letting the first render
// burn its full timeout.
const WORKER_SETUP_TIMEOUT_MS = 5_000;

async function getReadyWorker(): Promise<pdfjsLib.PDFWorker> {
  if (!sharedWorker) {
    sharedWorker = new pdfjsLib.PDFWorker();
  }
  const worker = sharedWorker;
  await withTimeout(worker.promise, WORKER_SETUP_TIMEOUT_MS, "pdf worker setup");
  return worker;
}

function resetWorker(): void {
  try {
    sharedWorker?.destroy();
  } catch {
    // The worker may already have terminated after a load failure.
  }
  sharedWorker = null;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function rasterize(
  bytes: Uint8Array,
  page: number,
  scale: number,
  background?: string,
): Promise<string> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice(), worker: await getReadyWorker() });
  try {
    return await withTimeout(
      (async () => {
        const doc = await loadingTask.promise;
        const pageNo = Math.min(Math.max(1, page), doc.numPages);
        const p = await doc.getPage(pageNo);
        try {
          const viewport = p.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("no 2d context");
          await p.render({ canvas, canvasContext: ctx, viewport, background }).promise;
          return canvas.toDataURL("image/png");
        } finally {
          try {
            p.cleanup();
          } catch {
          }
        }
      })(),
      30_000,
      "pdf render",
    );
  } finally {
    void loadingTask.destroy().catch(() => {});
  }
}

export async function pdfPageToPng(
  bytes: Uint8Array,
  page = 1,
  scale = 2,
  background?: string,
): Promise<string> {
  try {
    return await rasterize(bytes, page, scale, background);
  } catch (error) {
    resetWorker();
    const message = error instanceof Error ? error.message : String(error);
    const workerFailure = /timed out|worker|messagehandler|transport/i.test(message);
    if (!workerFailure) throw error;
    try {
      return await rasterize(bytes, page, scale, background);
    } catch (retryError) {
      resetWorker();
      try {
        await forceMainThreadWorker();
        return await rasterize(bytes, page, scale, background);
      } catch {
        resetWorker();
        throw retryError;
      }
    }
  }
}
