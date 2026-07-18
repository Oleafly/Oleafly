import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "@openleaf/preview/pdf.worker?worker&url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

let sharedWorker: pdfjsLib.PDFWorker | null = null;

function getWorker(): pdfjsLib.PDFWorker {
  if (!sharedWorker) {
    const port = new Worker(workerSrc, {
      type: "module",
      name: "openleaf-pdf-raster",
    });
    sharedWorker = pdfjsLib.PDFWorker.create({ port });
  }
  return sharedWorker;
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
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice(), worker: getWorker() });
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
          if (background) {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          await p.render({ canvas, canvasContext: ctx, viewport }).promise;
          return canvas.toDataURL("image/png");
        } finally {
          try {
            p.cleanup();
          } catch {
          }
        }
      })(),
      5_000,
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
      throw retryError;
    }
  }
}
