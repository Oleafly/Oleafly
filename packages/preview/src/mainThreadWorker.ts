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

export async function installMainThreadPdfWorker() {
  await import("./polyfills");
  const workerModule = await import("pdfjs-dist/build/pdf.worker.min.mjs");
  installPdfWorkerModule(workerModule);
}
