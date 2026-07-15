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
