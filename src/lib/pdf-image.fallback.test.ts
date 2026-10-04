import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  installMainThread: vi.fn(async () => {}),
  workers: 0,
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: mocks.getDocument,
  PDFWorker: class {
    promise = Promise.resolve(undefined);
    destroy = vi.fn();
    constructor() {
      mocks.workers += 1;
    }
  },
}));
vi.mock("@oleafly/preview/mainThreadWorker", () => ({ installMainThreadPdfWorker: mocks.installMainThread }));

function documentWith(numPages: number) {
  const page = {
    getViewport: () => ({ width: 10, height: 10 }),
    cleanup: vi.fn(),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
  };
  return {
    promise: Promise.resolve({ numPages, getPage: () => Promise.resolve(page) }),
    destroy: vi.fn(async () => {}),
  };
}

function failingTask(message: string) {
  return { promise: Promise.reject(new Error(message)), destroy: vi.fn(async () => {}) };
}

async function load() {
  vi.resetModules();
  return import("./pdf-image");
}

beforeEach(() => {
  mocks.getDocument.mockReset();
  mocks.installMainThread.mockReset().mockResolvedValue(undefined);
  mocks.workers = 0;
  vi.stubGlobal("document", {
    createElement: () => ({ getContext: () => ({}), toDataURL: () => "data:image/png;base64,ok", width: 0, height: 0 }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pdfPageToPng recovery", () => {
  it("refuses a page outside the document without retrying", async () => {
    const { pdfPageToPng } = await load();
    mocks.getDocument.mockImplementation(() => documentWith(2));
    await expect(pdfPageToPng(new Uint8Array([1]), 3)).rejects.toThrow("page 3 out of range (document has 2)");
    await expect(pdfPageToPng(new Uint8Array([1]), 0)).rejects.toThrow("page 0 out of range");
    expect(mocks.getDocument).toHaveBeenCalledTimes(2);
  });

  it("retries once on a fresh worker after a worker failure", async () => {
    const { pdfPageToPng } = await load();
    mocks.getDocument.mockImplementationOnce(() => failingTask("Worker was destroyed")).mockImplementation(() => documentWith(1));
    await expect(pdfPageToPng(new Uint8Array([1]))).resolves.toBe("data:image/png;base64,ok");
    expect(mocks.workers).toBe(2);
    expect(mocks.installMainThread).not.toHaveBeenCalled();
  });

  it("falls back to the main-thread worker after two worker failures", async () => {
    const { pdfPageToPng } = await load();
    mocks.getDocument
      .mockImplementationOnce(() => failingTask("MessageHandler is gone"))
      .mockImplementationOnce(() => failingTask("transport destroyed"))
      .mockImplementation(() => documentWith(1));
    await expect(pdfPageToPng(new Uint8Array([1]))).resolves.toBe("data:image/png;base64,ok");
    expect(mocks.installMainThread).toHaveBeenCalledOnce();
  });

  it("reports the retry failure when the main-thread fallback cannot be installed, and can install it later", async () => {
    const { pdfPageToPng } = await load();
    mocks.installMainThread.mockRejectedValueOnce(new Error("no main thread"));
    mocks.getDocument
      .mockImplementationOnce(() => failingTask("worker crashed"))
      .mockImplementationOnce(() => failingTask("worker crashed again"));
    await expect(pdfPageToPng(new Uint8Array([1]))).rejects.toThrow("worker crashed again");

    mocks.getDocument
      .mockImplementationOnce(() => failingTask("worker crashed"))
      .mockImplementationOnce(() => failingTask("worker crashed again"))
      .mockImplementation(() => documentWith(1));
    await expect(pdfPageToPng(new Uint8Array([1]))).resolves.toBe("data:image/png;base64,ok");
    expect(mocks.installMainThread).toHaveBeenCalledTimes(2);
  });

  it("rethrows non-Error failures that are not worker problems", async () => {
    const { pdfPageToPng } = await load();
    mocks.getDocument.mockImplementation(() => ({ promise: Promise.reject("bad pdf header"), destroy: vi.fn(async () => {}) }));
    await expect(pdfPageToPng(new Uint8Array([1]))).rejects.toBe("bad pdf header");
    expect(mocks.getDocument).toHaveBeenCalledOnce();
  });
});
