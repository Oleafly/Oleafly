import * as pdfjsLib from "pdfjs-dist";
import { pdfDocumentOptions } from "@oleafly/preview/pdfDocumentOptions";
import {
  destroyPdfWorker,
  forceMainThreadPdfWorker,
  waitForPdfWorker,
  withTimeout,
} from "@oleafly/preview/pdfWorkerRuntime";

let sharedWorker: pdfjsLib.PDFWorker | null = null;

const WORKER_SETUP_TIMEOUT_MS = 5_000;

async function getReadyWorker(): Promise<pdfjsLib.PDFWorker> {
  if (!sharedWorker) {
    sharedWorker = new pdfjsLib.PDFWorker();
  }
  const worker = sharedWorker;
  await waitForPdfWorker(worker, WORKER_SETUP_TIMEOUT_MS, "pdf worker setup");
  return worker;
}

function resetWorker(): void {
  if (sharedWorker) destroyPdfWorker(sharedWorker);
  sharedWorker = null;
}

const RENDER_TIMEOUT_MS = 30_000;

async function renderLoadedPage(
  doc: pdfjsLib.PDFDocumentProxy,
  page: number,
  scale: number,
  background?: string,
): Promise<string> {
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
  const loadingTask = pdfjsLib.getDocument(
    pdfDocumentOptions({ data: bytes.slice(), worker: await getReadyWorker() }),
  );
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
        await forceMainThreadPdfWorker();
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
  const loadingTask = pdfjsLib.getDocument(
    pdfDocumentOptions({ data: bytes.slice(), worker: await getReadyWorker() }),
  );
  const close = () => loadingTask.destroy().catch(() => {});
  try {
    const doc = await withTimeout(loadingTask.promise, RENDER_TIMEOUT_MS, "pdf load");
    return { doc, close };
  } catch (error) {
    void close();
    throw error;
  }
}

function openPdfWithRecovery(bytes: Uint8Array): Promise<LoadedPdf> {
  return withWorkerRecovery(() => openPdf(bytes));
}

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
