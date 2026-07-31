import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", () => ({
  readFileBase64: vi.fn(),
  base64ToUint8Array: vi.fn(() => new Uint8Array([1, 2, 3])),
}));

vi.mock("@/lib/pdf-image", () => ({
  pdfPageToPng: vi.fn(),
}));

import { base64ToUint8Array, readFileBase64 } from "@/lib/tauri";
import { pdfPageToPng } from "@/lib/pdf-image";
import {
  clearThumbnailCache,
  loadAssetThumbnail,
  THUMBNAIL_TARGET_RE,
} from "./hover-asset";

const mockRead = vi.mocked(readFileBase64);
const mockToBytes = vi.mocked(base64ToUint8Array);
const mockPdfToPng = vi.mocked(pdfPageToPng);

beforeEach(() => {
  clearThumbnailCache();
  vi.clearAllMocks();
  mockRead.mockResolvedValue("QUJD");
  mockToBytes.mockReturnValue(new Uint8Array([1, 2, 3]));
  mockPdfToPng.mockResolvedValue("data:image/png;base64,PDFTHUMB");
});

describe("THUMBNAIL_TARGET_RE", () => {
  it("matches raster images, svg, and pdf, case-insensitively", () => {
    for (const p of [
      "fig.png",
      "images/photo.jpg",
      "a.JPEG",
      "anim.gif",
      "modern.webp",
      "old.BMP",
      "vector.svg",
      "plot.pdf",
    ]) {
      expect(THUMBNAIL_TARGET_RE.test(p)).toBe(true);
    }
  });

  it("rejects non-asset paths", () => {
    for (const p of ["main.tex", "fig.png.bak", "notes.md", "pngfile", "archive.pdfx"]) {
      expect(THUMBNAIL_TARGET_RE.test(p)).toBe(false);
    }
  });
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

  it("applies the size guard to PDFs before rasterizing", async () => {
    mockRead.mockResolvedValue("a".repeat(8 * 1024 * 1024 + 1));
    await expect(loadAssetThumbnail("p1", "huge.pdf")).resolves.toBeNull();
    expect(mockPdfToPng).not.toHaveBeenCalled();
  });

  it("rasterizes page 1 of a PDF via pdfPageToPng", async () => {
    await expect(loadAssetThumbnail("p1", "figs/plot.pdf")).resolves.toBe(
      "data:image/png;base64,PDFTHUMB",
    );
    expect(mockToBytes).toHaveBeenCalledWith("QUJD");
    expect(mockPdfToPng).toHaveBeenCalledTimes(1);
    const [bytes, page] = mockPdfToPng.mock.calls[0];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(page).toBe(1);
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

    // A cache hit refreshes recency, so f0 survives the next eviction.
    await loadAssetThumbnail("p1", "f0.png");
    expect(mockRead).toHaveBeenCalledTimes(16);

    // Inserting a 17th entry evicts the now-oldest f1, not f0.
    await loadAssetThumbnail("p1", "f16.png");
    expect(mockRead).toHaveBeenCalledTimes(17);

    await loadAssetThumbnail("p1", "f0.png"); // still cached
    expect(mockRead).toHaveBeenCalledTimes(17);

    await loadAssetThumbnail("p1", "f1.png"); // evicted, refetches
    expect(mockRead).toHaveBeenCalledTimes(18);
  });

  it("clearThumbnailCache forces a re-read", async () => {
    await loadAssetThumbnail("p1", "fig.png");
    clearThumbnailCache();
    await loadAssetThumbnail("p1", "fig.png");
    expect(mockRead).toHaveBeenCalledTimes(2);
  });
});
