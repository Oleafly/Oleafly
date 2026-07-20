import { afterEach, describe, expect, it, vi } from "vitest";
import { installMainThreadPdfWorker, installPdfWorkerModule } from "./mainThreadWorker";
import "./pdf.worker";

describe("main-thread PDF worker fallback", () => {
  afterEach(() => {
    delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;
  });

  it("installs the actual PDF.js worker handler", async () => {
    const workerModule = (
      globalThis as { pdfjsWorker?: { WorkerMessageHandler?: unknown } }
    ).pdfjsWorker;
    expect(workerModule).toBeDefined();
    if (!workerModule) throw new Error("PDF worker was not registered");
    installPdfWorkerModule(workerModule);
    const worker = (globalThis as {
      pdfjsWorker?: { WorkerMessageHandler?: { setup?: unknown } };
    }).pdfjsWorker;
    expect(typeof worker?.WorkerMessageHandler?.setup).toBe("function");
  });

  it("loads and installs the worker module directly on the main thread", async () => {
    delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;
    const setup = () => {};
    const loader = vi.fn(async () => ({ WorkerMessageHandler: { setup } }));
    await installMainThreadPdfWorker("/assets/pdf.worker.js", loader);
    expect(loader).toHaveBeenCalledWith("/assets/pdf.worker.js");
    const worker = (globalThis as {
      pdfjsWorker?: { WorkerMessageHandler?: { setup?: unknown } };
    }).pdfjsWorker;
    expect(worker?.WorkerMessageHandler?.setup).toBe(setup);
  });
});
