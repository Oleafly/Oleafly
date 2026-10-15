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

  it("refuses a module that does not expose the worker message handler", () => {
    delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;

    expect(() => installPdfWorkerModule({})).toThrow(
      new TypeError("PDF worker module does not expose WorkerMessageHandler.setup"),
    );
    expect(() => installPdfWorkerModule({ WorkerMessageHandler: { setup: "not callable" } })).toThrow(
      TypeError,
    );
    expect((globalThis as { pdfjsWorker?: unknown }).pdfjsWorker).toBeUndefined();
  });

  it("loads and installs the worker module directly on the main thread", async () => {
    delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;
    await installMainThreadPdfWorker();
    const worker = (globalThis as {
      pdfjsWorker?: { WorkerMessageHandler?: { setup?: unknown } };
    }).pdfjsWorker;
    expect(typeof worker?.WorkerMessageHandler?.setup).toBe("function");
  });
});

describe("main-thread PDF worker decompression", () => {
  const native = Object.getOwnPropertyDescriptor(globalThis, "DecompressionStream");
  const MAC_WKWEBVIEW =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
  const WEBVIEW2 =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker;
    if (native) Object.defineProperty(globalThis, "DecompressionStream", native);
  });

  it("inflates in JavaScript when pdf.js runs on a WebKit main thread", async () => {
    expect(native).toBeDefined();
    vi.stubGlobal("navigator", { userAgent: MAC_WKWEBVIEW });
    await installMainThreadPdfWorker();
    expect((globalThis as { DecompressionStream?: unknown }).DecompressionStream).toBeUndefined();
  });

  it("keeps the native DecompressionStream on WebView2", async () => {
    vi.stubGlobal("navigator", { userAgent: WEBVIEW2 });
    await installMainThreadPdfWorker();
    expect((globalThis as { DecompressionStream?: unknown }).DecompressionStream).toBe(native?.value);
  });
});
