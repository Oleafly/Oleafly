import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractPdfText: vi.fn(),
  pdfPageToPng: vi.fn(),
  normalizeImage: vi.fn(),
}));

vi.mock("@/lib/pdf-text", () => ({ extractPdfText: mocks.extractPdfText }));
vi.mock("@/lib/pdf-image", () => ({ pdfPageToPng: mocks.pdfPageToPng }));
vi.mock("@/lib/image-normalize", () => ({ normalizeImage: mocks.normalizeImage }));
vi.mock("@/lib/toast", () => ({ toast: { errorUnique: vi.fn() } }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import { ATTACHMENT_LIMITS } from "@/lib/attachments-intake";
import { isScannedPdf, normalizeAttachment, pdfTextForModel } from "./attachments-normalize";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pdfPageToPng.mockResolvedValue(PNG_DATA_URL);
});

describe("PDF text for the model", () => {
  it("labels pages and notes when the text was cut", () => {
    expect(pdfTextForModel(["a", "b"], 2, 100)).toBe("[Page 1]\na\n\n[Page 2]\nb");
    expect(pdfTextForModel(["a", "b"], 240, 100)).toMatch(
      /\[Only the first 100 of 240 pages are included\.\]$/,
    );
  });

  it("treats a PDF with almost no text as scanned", () => {
    expect(isScannedPdf(["", " ", "x"])).toBe(true);
    expect(isScannedPdf([])).toBe(true);
    expect(isScannedPdf(["This page has a proper paragraph of text on it."])).toBe(false);
  });
});

describe("normalizeAttachment", () => {
  it("keeps a PDF's text and a first-page thumbnail", async () => {
    mocks.extractPdfText.mockResolvedValue({
      pages: ["An abstract with real sentences in it.", "Section two goes on."],
      numPages: 2,
    });
    const file = new File([new Uint8Array([37, 80])], "paper.pdf", { type: "application/pdf" });
    const result = await normalizeAttachment(file, "pdf", ATTACHMENT_LIMITS);
    expect(mocks.extractPdfText).toHaveBeenCalledWith(expect.any(Uint8Array), { maxPages: 100 });
    expect(result).toMatchObject({ name: "paper.pdf", mime: "application/pdf", pages: 2 });
    expect(result.text).toContain("[Page 2]\nSection two goes on.");
    expect(result.thumbnailUrl).toBe(PNG_DATA_URL);
    expect(result.pageImages).toBeUndefined();
  });

  it("renders the first three pages of a scanned PDF as images", async () => {
    mocks.extractPdfText.mockResolvedValue({ pages: ["", "", "", ""], numPages: 12 });
    const file = new File([new Uint8Array([1])], "scan.pdf", { type: "application/pdf" });
    const result = await normalizeAttachment(file, "pdf", ATTACHMENT_LIMITS);
    expect(result.text).toBeUndefined();
    expect(result.pageImages).toHaveLength(3);
    expect(result.pageImages?.[0].mime).toBe("image/png");
    expect(mocks.pdfPageToPng).toHaveBeenCalledWith(expect.any(Uint8Array), 3, 1.5, "#ffffff", {
      overallTimeoutMs: 20_000,
    });
  });

  it("reports a PDF that cannot be opened", async () => {
    mocks.extractPdfText.mockRejectedValue(new Error("bad xref"));
    const file = new File([new Uint8Array([1])], "broken.pdf", { type: "application/pdf" });
    await expect(normalizeAttachment(file, "pdf", ATTACHMENT_LIMITS)).rejects.toMatchObject({
      reason: "unreadablePdf",
    });
  });

  it("keeps text files as they are and labels them text/plain", async () => {
    const file = new File(["\\section{x}"], "main.tex", { type: "" });
    const result = await normalizeAttachment(file, "text", ATTACHMENT_LIMITS);
    expect(result.mime).toBe("text/plain");
    expect(new TextDecoder().decode(result.bytes)).toBe("\\section{x}");
    const markdown = await normalizeAttachment(
      new File(["# x"], "a.md", { type: "text/markdown" }),
      "text",
      ATTACHMENT_LIMITS,
    );
    expect(markdown.mime).toBe("text/markdown");
  });

  it("passes images through the image normalizer", async () => {
    mocks.normalizeImage.mockResolvedValue({
      bytes: new Uint8Array([9]),
      mime: "image/webp",
      width: 2048,
      height: 1536,
      thumbnailUrl: "data:thumb",
    });
    const file = new File([new Uint8Array([1])], "photo.jpg", { type: "image/jpeg" });
    const result = await normalizeAttachment(file, "image", ATTACHMENT_LIMITS);
    expect(mocks.normalizeImage).toHaveBeenCalledWith(file, { maxEdge: 2048, thumbEdge: 96 });
    expect(result).toMatchObject({ name: "photo.jpg", mime: "image/webp", thumbnailUrl: "data:thumb" });
  });
});
