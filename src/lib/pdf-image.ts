import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "@oleafly/preview/pdf.worker?worker&url";
import { installMainThreadPdfWorker } from "@oleafly/preview/mainThreadWorker";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

// Session-wide last resort shared with PdfViewer's ladder: a worker subsystem
// wedged by WKWebView renders every fresh PDFWorker dead, so downgrade to the
// main-thread loopback worker once two real-worker attempts have timed out.
let mainThreadInstall: Promise<void> | null = null;

async function forceMainThreadWorker(): Promise<void> {
  mainThreadInstall ??= installMainThreadPdfWorker().catch((error) => {
    mainThreadInstall = null;
    throw error;
  });
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

const RENDER_TIMEOUT_MS = 30_000;

async function renderLoadedPage(
  doc: pdfjsLib.PDFDocumentProxy,
  page: number,
  scale: number,
  background?: string,
): Promise<string> {
  // Out-of-range pages must FAIL, not silently clamp: clamping made
  // page-by-page consumers render the last page over and over.
  if (page < 1 || page > doc.numPages) {
    throw new Error(`page ${page} out of range (document has ${doc.numPages})`);
  }
  const p = await doc.getPage(page);
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
      // The page may already be released after a worker failure.
    }
  }
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
      (async () => renderLoadedPage(await loadingTask.promise, page, scale, background))(),
      RENDER_TIMEOUT_MS,
      "pdf render",
    );
  } finally {
    void loadingTask.destroy().catch(() => {});
  }
}

function isWorkerFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|worker|messagehandler|transport/i.test(message);
}

/** Runs `attempt`; after a worker failure, again on a fresh worker, then
 * on the main-thread worker. */
async function withWorkerRecovery<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    resetWorker();
    if (!isWorkerFailure(error)) throw error;
    try {
      return await attempt();
    } catch (retryError) {
      resetWorker();
      try {
        await forceMainThreadWorker();
        return await attempt();
      } catch {
        resetWorker();
        throw retryError;
      }
    }
  }
}

function pdfPageToPngChain(
  bytes: Uint8Array,
  page: number,
  scale: number,
  background?: string,
): Promise<string> {
  return withWorkerRecovery(() => rasterize(bytes, page, scale, background));
}

export async function pdfPageToPng(
  bytes: Uint8Array,
  page = 1,
  scale = 2,
  background?: string,
  opts?: { overallTimeoutMs?: number },
): Promise<string> {
  const chain = pdfPageToPngChain(bytes, page, scale, background);
  return opts?.overallTimeoutMs
    ? withTimeout(chain, opts.overallTimeoutMs, "pdf thumbnail")
    : chain;
}

interface LoadedPdf {
  doc: pdfjsLib.PDFDocumentProxy;
  close: () => Promise<void>;
}

async function openPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice(), worker: await getReadyWorker() });
  const close = () => loadingTask.destroy().catch(() => {});
  try {
    const doc = await withTimeout(loadingTask.promise, RENDER_TIMEOUT_MS, "pdf load");
    return { doc, close };
  } catch (error) {
    void close();
    throw error;
  }
}

/** The same recovery as one page: a fresh worker, then the main thread. */
function openPdfWithRecovery(bytes: Uint8Array): Promise<LoadedPdf> {
  return withWorkerRecovery(() => openPdf(bytes));
}

/**
 * Renders the given 1-based `pages` of one PDF to PNG data URLs, in order,
 * one per `next()`. pdf.js loads the document once for all of them rather
 * than once per page, and the document is destroyed when the iteration
 * finishes or is stopped early (`return()`). A worker that dies part-way is
 * replaced and that page rendered again, once.
 */
export async function* renderPages(
  bytes: Uint8Array,
  pages: readonly number[],
  scale = 2,
  background?: string,
): AsyncGenerator<string, void, undefined> {
  const render = (doc: pdfjsLib.PDFDocumentProxy, page: number) =>
    withTimeout(renderLoadedPage(doc, page, scale, background), RENDER_TIMEOUT_MS, "pdf render");
  let loaded: LoadedPdf | null = null;
  try {
    for (const page of pages) {
      loaded ??= await openPdfWithRecovery(bytes);
      let png: string;
      try {
        png = await render(loaded.doc, page);
      } catch (error) {
        if (!isWorkerFailure(error)) throw error;
        await loaded.close();
        loaded = null;
        resetWorker();
        loaded = await openPdfWithRecovery(bytes);
        png = await render(loaded.doc, page);
      }
      yield png;
    }
  } finally {
    await loaded?.close();
  }
}
