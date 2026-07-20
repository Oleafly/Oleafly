import { afterEach, describe, expect, it } from "vitest";
import { installPdfWorkerModule } from "./mainThreadWorker";
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
});
