import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  readFileBase64: vi.fn(),
  readNoteFile: vi.fn(),
}));

vi.mock("@/lib/pdf-image", () => ({
  pdfPageToPng: vi.fn(),
}));

import { readFileBase64, readNoteFile } from "@/lib/tauri";
import { pdfPageToPng } from "@/lib/pdf-image";
import {
  clearThumbnailCache,
  loadAssetThumbnail,
} from "./hover-asset";

const mockRead = vi.mocked(readFileBase64);
const mockReadBytes = vi.mocked(readNoteFile);
const mockPdfToPng = vi.mocked(pdfPageToPng);

beforeEach(() => {
  clearThumbnailCache();
  vi.clearAllMocks();
  mockRead.mockResolvedValue("QUJD");
  mockReadBytes.mockResolvedValue(new Uint8Array([37, 80, 68, 70]).buffer);
  mockPdfToPng.mockResolvedValue("data:image/png;base64,PDFTHUMB");
});

describe("loadAssetThumbnail", () => {
  it("forms a data URL with the extension's mime type", async () => {
    await expect(loadAssetThumbnail("p1", "img/fig.png")).resolves.toBe(
      "data:image/png;base64,QUJD",
    );
    await expect(loadAssetThumbnail("p1", "img/photo.JPG")).resolves.toBe(
      "data:image/jpeg;base64,QUJD",
    );
    await expect(loadAssetThumbnail("p1", "img/vector.svg")).resolves.toBe(
      "data:image/svg+xml;base64,QUJD",
    );
    expect(mockRead).toHaveBeenCalledWith("p1", "img/fig.png");
  });

  it("returns null for files whose base64 exceeds the size guard", async () => {
    mockRead.mockResolvedValue("a".repeat(8 * 1024 * 1024 + 1));
    await expect(loadAssetThumbnail("p1", "huge.png")).resolves.toBeNull();
  });

  it("reads a PDF as raw bytes rather than base64, so a large PDF still draws", async () => {
    await expect(loadAssetThumbnail("p1", "figs/plot.pdf")).resolves.toBe(
      "data:image/png;base64,PDFTHUMB",
    );
    expect(mockReadBytes).toHaveBeenCalledWith("p1", "figs/plot.pdf");
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockPdfToPng).toHaveBeenCalledTimes(1);
    const [bytes, page] = mockPdfToPng.mock.calls[0];
    expect(Array.from(bytes)).toEqual([37, 80, 68, 70]);
    expect(page).toBe(1);
  });

  it("draws the PDF page asked for, and nothing when the file can't be read", async () => {
    await loadAssetThumbnail("p1", "paper.PDF", 4);
    expect(mockPdfToPng.mock.calls[0][1]).toBe(4);
    mockReadBytes.mockRejectedValue(new Error("file exceeds the limit"));
    await expect(loadAssetThumbnail("p1", "huge.pdf")).resolves.toBeNull();
    expect(mockPdfToPng).toHaveBeenCalledTimes(1);
  });

  it("caches successful results and does not re-read the file", async () => {
    await loadAssetThumbnail("p1", "fig.png");
    await loadAssetThumbnail("p1", "fig.png");
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it("returns null on read errors and caches the null", async () => {
    mockRead.mockRejectedValue(new Error("missing"));
    await expect(loadAssetThumbnail("p1", "gone.png")).resolves.toBeNull();
    await expect(loadAssetThumbnail("p1", "gone.png")).resolves.toBeNull();
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it("returns null when the PDF rasterizer fails", async () => {
    mockPdfToPng.mockRejectedValue(new Error("wedged worker"));
    await expect(loadAssetThumbnail("p1", "bad.pdf")).resolves.toBeNull();
  });

  it("keys the cache by project as well as path", async () => {
    await loadAssetThumbnail("p1", "fig.png");
    await loadAssetThumbnail("p2", "fig.png");
    expect(mockRead).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used entry beyond 16 items", async () => {
    for (let i = 0; i < 16; i++) {
      await loadAssetThumbnail("p1", `f${i}.png`);
    }
    expect(mockRead).toHaveBeenCalledTimes(16);

    await loadAssetThumbnail("p1", "f0.png");
    expect(mockRead).toHaveBeenCalledTimes(16);

    await loadAssetThumbnail("p1", "f16.png");
    expect(mockRead).toHaveBeenCalledTimes(17);

    await loadAssetThumbnail("p1", "f0.png");
    expect(mockRead).toHaveBeenCalledTimes(17);

    await loadAssetThumbnail("p1", "f1.png");
    expect(mockRead).toHaveBeenCalledTimes(18);
  });

  it("clearThumbnailCache forces a re-read", async () => {
    await loadAssetThumbnail("p1", "fig.png");
    clearThumbnailCache();
    await loadAssetThumbnail("p1", "fig.png");
    expect(mockRead).toHaveBeenCalledTimes(2);
  });
});
