type PdfWorkerModule = {
  WorkerMessageHandler?: unknown;
};

type WorkerModuleLoader = (workerSrc: string) => Promise<PdfWorkerModule>;

export function installPdfWorkerModule(workerModule: PdfWorkerModule) {
  const handler = workerModule.WorkerMessageHandler as { setup?: unknown } | undefined;
  if (typeof handler?.setup !== "function") {
    throw new Error("PDF worker module does not expose WorkerMessageHandler.setup");
  }
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = workerModule;
}

export async function installMainThreadPdfWorker(
  workerSrc: string,
  loadWorkerModule: WorkerModuleLoader = (src) => import(/* @vite-ignore */ src),
) {
  await import("./polyfills");
  const workerModule = await loadWorkerModule(workerSrc);
  installPdfWorkerModule(workerModule);
}
