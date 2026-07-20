type PdfWorkerModule = {
  WorkerMessageHandler?: unknown;
};

export function installPdfWorkerModule(workerModule: PdfWorkerModule) {
  const handler = workerModule.WorkerMessageHandler as { setup?: unknown } | undefined;
  if (typeof handler?.setup !== "function") {
    throw new Error("PDF worker module does not expose WorkerMessageHandler.setup");
  }
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = workerModule;
}

export async function installMainThreadPdfWorker(workerSrc: string) {
  await import("./polyfills");
  await import(/* @vite-ignore */ workerSrc);
  const workerModule = (globalThis as { pdfjsWorker?: PdfWorkerModule }).pdfjsWorker;
  if (!workerModule) {
    throw new Error("PDF worker module did not register its main-thread handler");
  }
  installPdfWorkerModule(workerModule);
}
