import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "@oleafly/preview/pdf.worker?worker&url";
import { installMainThreadPdfWorker } from "@oleafly/preview/mainThreadWorker";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const WORKER_SETUP_TIMEOUT_MS = 5_000;
const LOAD_TIMEOUT_MS = 30_000;

export interface SlideBox {
  readonly width: number;
  readonly height: number;
}

export interface SlideDocument {
  readonly numPages: number;
  render(page: number, canvas: HTMLCanvasElement, box: SlideBox, pixelRatio: number): Promise<boolean>;
  destroy(): void;
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${milliseconds}ms`)), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

interface LoadedDocument {
  readonly document: pdfjsLib.PDFDocumentProxy;
  readonly task: pdfjsLib.PDFDocumentLoadingTask;
  readonly worker: pdfjsLib.PDFWorker;
}

async function loadWithWorker(bytes: Uint8Array): Promise<LoadedDocument> {
  const worker = new pdfjsLib.PDFWorker();
  let task: pdfjsLib.PDFDocumentLoadingTask | null = null;
  try {
    await withTimeout(worker.promise, WORKER_SETUP_TIMEOUT_MS, "pdf worker setup");
    task = pdfjsLib.getDocument({ data: bytes.slice(), worker });
    const document = await withTimeout(task.promise, LOAD_TIMEOUT_MS, "pdf load");
    return { document, task, worker };
  } catch (error) {
    void task?.destroy().catch(() => {});
    worker.destroy();
    throw error;
  }
}

async function loadDocument(bytes: Uint8Array): Promise<LoadedDocument> {
  try {
    return await loadWithWorker(bytes);
  } catch {
    await installMainThreadPdfWorker();
    return loadWithWorker(bytes);
  }
}

export async function openSlideDocument(bytes: Uint8Array): Promise<SlideDocument> {
  const { document, task: loading, worker } = await loadDocument(bytes);
  const tasks = new WeakMap<HTMLCanvasElement, pdfjsLib.RenderTask>();
  let destroyed = false;
  return {
    numPages: document.numPages,
    async render(pageNumber, canvas, box, pixelRatio) {
      if (destroyed || pageNumber < 1 || pageNumber > document.numPages) return false;
      tasks.get(canvas)?.cancel();
      const page = await document.getPage(pageNumber);
      const natural = page.getViewport({ scale: 1 });
      const fit = Math.max(0.01, Math.min(box.width / natural.width, box.height / natural.height));
      const viewport = page.getViewport({ scale: fit * pixelRatio });
      const scratch = window.document.createElement("canvas");
      scratch.width = Math.max(1, Math.floor(viewport.width));
      scratch.height = Math.max(1, Math.floor(viewport.height));
      const context = scratch.getContext("2d");
      if (!context) return false;
      const task = page.render({ canvas: scratch, canvasContext: context, viewport, background: "#ffffff" });
      tasks.set(canvas, task);
      try {
        await task.promise;
      } catch {
        return false;
      } finally {
        if (tasks.get(canvas) === task) tasks.delete(canvas);
      }
      if (destroyed) return false;
      canvas.width = scratch.width;
      canvas.height = scratch.height;
      canvas.style.width = `${Math.round(viewport.width / pixelRatio)}px`;
      canvas.style.height = `${Math.round(viewport.height / pixelRatio)}px`;
      canvas.getContext("2d")?.drawImage(scratch, 0, 0);
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      void loading.destroy().catch(() => {});
      worker.destroy();
    },
  };
}
