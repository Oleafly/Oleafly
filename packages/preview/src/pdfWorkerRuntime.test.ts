import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pdf = vi.hoisted(() => {
  const state = {
    options: {} as { workerSrc?: string },
    workers: [] as Array<{ promise: Promise<void>; destroy: ReturnType<typeof vi.fn> }>,
    ready: () => Promise.resolve() as Promise<void>,
    install: vi.fn(async () => {}),
  };
  class PDFWorker {
    promise = state.ready();
    destroy = vi.fn();
    constructor() {
      state.workers.push(this);
    }
  }
  return { state, PDFWorker };
});

vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: pdf.state.options, PDFWorker: pdf.PDFWorker }));
vi.mock("./pdf.worker?worker&url", () => ({ default: "/assets/pdf.worker.js" }));
vi.mock("./mainThreadWorker", () => ({ installMainThreadPdfWorker: pdf.state.install }));

async function runtime() {
  vi.resetModules();
  return import("./pdfWorkerRuntime");
}

beforeEach(() => {
  pdf.state.workers.length = 0;
  pdf.state.ready = () => Promise.resolve();
  pdf.state.install.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the shared pdf.js worker runtime", () => {
  it("points pdf.js at the bundled worker as soon as it loads", async () => {
    await runtime();
    expect(pdf.state.options.workerSrc).toBe("/assets/pdf.worker.js");
  });

  it("times out a promise with its label and passes its own outcome through unchanged", async () => {
    const { withTimeout } = await runtime();
    await expect(withTimeout(Promise.resolve(7), 10, "seven")).resolves.toBe(7);
    await expect(withTimeout(Promise.reject("not an error"), 10, "plain")).rejects.toBe("not an error");
    vi.useFakeTimers();
    const pending = expect(withTimeout(new Promise(() => {}), 50, "pdf load")).rejects.toThrow(
      "pdf load timed out after 50ms",
    );
    await vi.advanceTimersByTimeAsync(50);
    await pending;
  });

  it("destroys a worker without throwing when it is already gone", async () => {
    const { destroyPdfWorker } = await runtime();
    const destroy = vi.fn(() => {
      throw new Error("already destroyed");
    });
    expect(() => destroyPdfWorker({ destroy } as never)).not.toThrow();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("hands back a worker once it is ready", async () => {
    const { createReadyPdfWorker } = await runtime();
    const worker = await createReadyPdfWorker(100, "PDF worker setup");
    expect(worker).toBe(pdf.state.workers[0]);
    expect(pdf.state.workers[0].destroy).not.toHaveBeenCalled();
  });

  it("destroys a worker that never gets ready and names the step that timed out", async () => {
    const { createReadyPdfWorker } = await runtime();
    vi.useFakeTimers();
    pdf.state.ready = () => new Promise<void>(() => {});
    const opening = expect(createReadyPdfWorker(5_000, "pdf worker setup")).rejects.toThrow(
      "pdf worker setup timed out after 5000ms",
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await opening;
    expect(pdf.state.workers[0].destroy).toHaveBeenCalled();
  });

  it("destroys a worker whose setup fails and passes the failure on", async () => {
    const { createReadyPdfWorker } = await runtime();
    pdf.state.ready = () => Promise.reject(new Error("worker crashed"));
    await expect(createReadyPdfWorker(100, "PDF worker setup")).rejects.toThrow("worker crashed");
    expect(pdf.state.workers[0].destroy).toHaveBeenCalled();
  });

  it("stops waiting for a worker when the load is cancelled, before or during setup", async () => {
    const { createReadyPdfWorker } = await runtime();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(createReadyPdfWorker(100, "PDF worker setup", cancelled.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(pdf.state.workers[0].destroy).toHaveBeenCalled();

    pdf.state.ready = () => new Promise<void>(() => {});
    const later = new AbortController();
    const opening = createReadyPdfWorker(100_000, "PDF worker setup", later.signal);
    later.abort();
    await expect(opening).rejects.toMatchObject({ name: "AbortError" });
    expect(pdf.state.workers[1].destroy).toHaveBeenCalled();
  });

  it("waits for a worker it does not own without destroying it on success", async () => {
    const { waitForPdfWorker } = await runtime();
    const worker = new pdf.PDFWorker();
    await expect(waitForPdfWorker(worker as never, 100, "pdf worker setup")).resolves.toBeUndefined();
    expect(worker.destroy).not.toHaveBeenCalled();
  });

  it("installs the main-thread worker once per session and again only after a failed install", async () => {
    const { forceMainThreadPdfWorker, pendingMainThreadPdfWorker } = await runtime();
    expect(pendingMainThreadPdfWorker()).toBeNull();

    pdf.state.install.mockRejectedValueOnce(new Error("no main thread"));
    await expect(forceMainThreadPdfWorker()).rejects.toThrow("no main thread");
    expect(pendingMainThreadPdfWorker()).toBeNull();

    await forceMainThreadPdfWorker();
    await forceMainThreadPdfWorker();
    expect(pdf.state.install).toHaveBeenCalledTimes(2);
    await expect(pendingMainThreadPdfWorker()).resolves.toBeUndefined();
  });
});
