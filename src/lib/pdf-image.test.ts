import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  destroyTask: vi.fn().mockResolvedValue(undefined),
  getDocument: vi.fn(),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  PDFWorker: class { destroy() {} },
  getDocument: mocks.getDocument,
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));

import { pdfPageToPng } from "./pdf-image";

describe("pdfPageToPng cleanup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.cleanup.mockReset();
    mocks.getDocument.mockReset();
  });

  it("cleans each loaded page when canvas setup fails", async () => {
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => null, width: 0, height: 0 }),
    });
    const page = {
      getViewport: () => ({ width: 100, height: 100 }),
      cleanup: mocks.cleanup,
    };
    mocks.getDocument.mockImplementation(() => ({
      promise: Promise.resolve({ numPages: 1, getPage: () => Promise.resolve(page) }),
      destroy: mocks.destroyTask,
    }));

    await expect(pdfPageToPng(new Uint8Array([1]))).rejects.toThrow("no 2d context");
    expect(mocks.cleanup).toHaveBeenCalledTimes(2);
  });
});
