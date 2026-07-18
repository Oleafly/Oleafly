import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  destroyTask: vi.fn().mockResolvedValue(undefined),
  destroyWorker: vi.fn(),
  getDocument: vi.fn(),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: mocks.getDocument,
  PDFWorker: class {
    static create() {
      return new this();
    }
    destroy = mocks.destroyWorker;
  },
}));

import { pdfPageToPng } from "./pdf-image";

describe("pdfPageToPng cleanup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.cleanup.mockReset();
    mocks.destroyWorker.mockReset();
    mocks.getDocument.mockReset();
  });

  it("cleans the loaded page and retires the worker without retrying", async () => {
    vi.stubGlobal("Worker", class {});
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
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.getDocument).toHaveBeenCalledOnce();
    expect(mocks.destroyWorker).toHaveBeenCalledOnce();
  });

  it("passes a transparent background through to the PDF renderer", async () => {
    vi.stubGlobal("Worker", class {});
    const render = vi.fn(() => ({ promise: Promise.resolve() }));
    const canvas = {
      getContext: () => ({}),
      toDataURL: () => "data:image/png;base64,alpha",
      width: 0,
      height: 0,
    };
    vi.stubGlobal("document", { createElement: () => canvas });
    const page = {
      getViewport: () => ({ width: 100, height: 100 }),
      cleanup: mocks.cleanup,
      render,
    };
    mocks.getDocument.mockImplementation(() => ({
      promise: Promise.resolve({ numPages: 1, getPage: () => Promise.resolve(page) }),
      destroy: mocks.destroyTask,
    }));

    const result = await pdfPageToPng(
      new Uint8Array([1]),
      1,
      2,
      "rgba(0,0,0,0)",
    );

    expect(result).toBe("data:image/png;base64,alpha");
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ background: "rgba(0,0,0,0)" }),
    );
  });
});
