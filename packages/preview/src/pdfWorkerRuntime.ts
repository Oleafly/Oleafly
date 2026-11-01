import * as pdfjsLib from "pdfjs-dist";
import { installMainThreadPdfWorker } from "./mainThreadWorker";
import workerSrc from "./pdf.worker?worker&url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

let mainThreadInstall: Promise<void> | null = null;

export async function forceMainThreadPdfWorker(): Promise<void> {
  mainThreadInstall ??= installMainThreadPdfWorker().catch((error) => {
    mainThreadInstall = null;
    throw error;
  });
  await mainThreadInstall;
}

export function pendingMainThreadPdfWorker(): Promise<void> | null {
  return mainThreadInstall;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function destroyPdfWorker(worker: pdfjsLib.PDFWorker): void {
  try {
    worker.destroy();
  } catch {
    return;
  }
}

export async function waitForPdfWorker(
  worker: pdfjsLib.PDFWorker,
  timeoutMs: number,
  what: string,
  signal?: AbortSignal,
): Promise<void> {
  let rejectAborted: ((reason: DOMException) => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = reject;
  });
  const onAbort = () => {
    destroyPdfWorker(worker);
    rejectAborted?.(new DOMException("PDF load cancelled", "AbortError"));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) onAbort();
    await withTimeout(Promise.race([worker.promise, aborted]), timeoutMs, what);
    if (signal?.aborted) {
      throw new DOMException("PDF load cancelled", "AbortError");
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function createReadyPdfWorker(
  timeoutMs: number,
  what: string,
  signal?: AbortSignal,
): Promise<pdfjsLib.PDFWorker> {
  const worker = new pdfjsLib.PDFWorker();
  try {
    await waitForPdfWorker(worker, timeoutMs, what, signal);
    return worker;
  } catch (error) {
    destroyPdfWorker(worker);
    throw error;
  }
}
