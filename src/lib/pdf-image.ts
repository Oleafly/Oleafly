import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

// One worker for all one-shot rasterizations. Spawning a fresh worker per
// call is slow in WKWebView and can wedge outright, which froze the diagram
// composer's preview even after a successful compile.
let sharedWorker: pdfjsLib.PDFWorker | null = null;

function getWorker(): pdfjsLib.PDFWorker {
  if (!sharedWorker) sharedWorker = new pdfjsLib.PDFWorker();
  return sharedWorker;
}

function resetWorker() {
  try {
    sharedWorker?.destroy();
  } catch {
    /* already dead */
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
    const doc = await loadingTask.promise;
    const pageNo = Math.min(Math.max(1, page), doc.numPages);
    const p = await doc.getPage(pageNo);
    const viewport = p.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    // Fill a solid background first (for a non-transparent export); pdf.js draws
    // over it. Omitting `background` keeps the PNG transparent (standalone PDFs
    // have no page fill).
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    await p.render({ canvas, canvasContext: ctx, viewport }).promise;
    p.cleanup();
    return canvas.toDataURL("image/png");
  } finally {
    await loadingTask.destroy();
  }
}

// `scale` 2 gives a crisp thumbnail without ballooning the data URL. A wedged
// worker is detected by timeout and retried once on a fresh one.
export async function pdfPageToPng(
  bytes: Uint8Array,
  page = 1,
  scale = 2,
  background?: string,
): Promise<string> {
  try {
    return await withTimeout(rasterize(bytes, page, scale, background), 30_000, "pdf render");
  } catch {
    resetWorker();
    return await withTimeout(rasterize(bytes, page, scale, background), 30_000, "pdf render");
  }
}
