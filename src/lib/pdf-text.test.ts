import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  destroy: vi.fn(),
  getDocument: vi.fn(),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: mocks.getDocument,
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));

import { extractPdfText } from "./pdf-text";

describe("extractPdfText cleanup", () => {
  beforeEach(() => {
    mocks.destroy.mockReset();
    mocks.getDocument.mockReset();
  });

  it("destroys the loading task when document loading fails", async () => {
    const primary = new Error("malformed PDF");
    mocks.destroy.mockResolvedValue(undefined);
    mocks.getDocument.mockReturnValue({ promise: Promise.reject(primary), destroy: mocks.destroy });

    await expect(extractPdfText(new Uint8Array([1]))).rejects.toBe(primary);
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("does not mask the primary extraction error when cleanup also fails", async () => {
    const primary = new Error("page decode failed");
    mocks.destroy.mockRejectedValue(new Error("worker teardown failed"));
    mocks.getDocument.mockReturnValue({ promise: Promise.reject(primary), destroy: mocks.destroy });

    await expect(extractPdfText(new Uint8Array([1]))).rejects.toBe(primary);
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("does not mask the primary error when destroy throws synchronously", async () => {
    const primary = new Error("xref parse failed");
    mocks.destroy.mockImplementation(() => { throw new Error("destroy threw"); });
    mocks.getDocument.mockReturnValue({ promise: Promise.reject(primary), destroy: mocks.destroy });

    await expect(extractPdfText(new Uint8Array([1]))).rejects.toBe(primary);
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});

describe("extractPdfText", () => {
  beforeEach(() => {
    mocks.destroy.mockReset().mockResolvedValue(undefined);
    mocks.getDocument.mockReset();
  });

  function page(items: unknown[], cleanup = vi.fn()) {
    return { getTextContent: vi.fn(async () => ({ items })), cleanup };
  }

  it("joins text items into lines per page and cleans up every page", async () => {
    const first = page([
      { str: "Hello", transform: [1, 0, 0, 1, 10, 700] },
      { str: " world  ", transform: [1, 0, 0, 1, 40, 700.5] },
      { str: "Next line", transform: [1, 0, 0, 1, 10, 680] },
      { type: "beginMarkedContent" },
      { str: 42, transform: [1, 0, 0, 1, 10, 660] },
      { str: "tail" },
    ]);
    const second = page([{ str: "  Page two  ", transform: [1, 0, 0, 1, 0, 100] }]);
    const pages = [first, second];
    const bytes = new Uint8Array([1, 2, 3]);
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage: vi.fn(async (n: number) => pages[n - 1]) }),
      destroy: mocks.destroy,
    });

    const result = await extractPdfText(bytes);

    expect(result).toEqual({ numPages: 2, pages: ["Hello world\nNext line\ntail", "Page two"] });
    expect(first.cleanup).toHaveBeenCalledOnce();
    expect(second.cleanup).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
    const passed = mocks.getDocument.mock.calls[0][0].data as Uint8Array;
    expect(passed).toEqual(bytes);
    expect(passed).not.toBe(bytes);
  });

  it("keeps going when page cleanup throws and still destroys the task", async () => {
    const broken = page([{ str: "Only", transform: [1, 0, 0, 1, 0, 5] }], vi.fn(() => {
      throw new Error("cleanup failed");
    }));
    mocks.destroy.mockRejectedValue(new Error("destroy failed"));
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: vi.fn(async () => broken) }),
      destroy: mocks.destroy,
    });

    await expect(extractPdfText(new Uint8Array([1]))).resolves.toEqual({ numPages: 1, pages: ["Only"] });
    expect(broken.cleanup).toHaveBeenCalledOnce();
  });

  it("cleans up the page when reading its text fails", async () => {
    const failing = { getTextContent: vi.fn(async () => { throw new Error("bad content stream"); }), cleanup: vi.fn() };
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: vi.fn(async () => failing) }),
      destroy: mocks.destroy,
    });

    await expect(extractPdfText(new Uint8Array([1]))).rejects.toThrow("bad content stream");
    expect(failing.cleanup).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});
