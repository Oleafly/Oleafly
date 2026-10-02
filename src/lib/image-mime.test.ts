import { describe, expect, it } from "vitest";
import {
  imageMime,
  INSERTABLE_IMAGE_EXTENSIONS,
  insertableImageExtension,
  isImagePath,
  isInsertableImagePath,
  isLatexGraphicsPath,
} from "./image-mime";

const PREVIEWABLE = ["fig.png", "images/photo.jpg", "a.JPEG", "anim.gif", "modern.webp", "old.BMP", "vector.svg"];
const NOT_ASSETS = ["main.tex", "fig.png.bak", "notes.md", "pngfile", "archive.pdfx", "dir.png/readme"];

describe("isImagePath", () => {
  it("accepts what the webview can show, case-insensitively", () => {
    for (const path of PREVIEWABLE) expect(isImagePath(path)).toBe(true);
    expect(isImagePath("plot.pdf")).toBe(false);
    expect(isImagePath("plot.eps")).toBe(false);
  });

  it("adds PDF when the caller renders PDF pages itself", () => {
    for (const path of [...PREVIEWABLE, "plot.pdf", "PLOT.PDF"]) {
      expect(isImagePath(path, { allowPdf: true })).toBe(true);
    }
    expect(isImagePath("plot.eps", { allowPdf: true })).toBe(false);
  });

  it("rejects paths that are not images", () => {
    for (const path of NOT_ASSETS) expect(isImagePath(path, { allowPdf: true })).toBe(false);
  });
});

describe("isLatexGraphicsPath", () => {
  it("accepts the formats a LaTeX compile can include", () => {
    for (const path of ["a.png", "b.jpg", "c.jpeg", "d.pdf", "e.svg", "f.EPS"]) {
      expect(isLatexGraphicsPath(path)).toBe(true);
    }
  });

  it("rejects formats no LaTeX engine includes", () => {
    for (const path of ["a.gif", "b.webp", "c.bmp", "main.tex"]) {
      expect(isLatexGraphicsPath(path)).toBe(false);
    }
  });
});

describe("figure insertion formats", () => {
  it("lists the formats a figure can be inserted from", () => {
    expect(INSERTABLE_IMAGE_EXTENSIONS).toEqual(["png", "jpg", "jpeg", "svg", "pdf"]);
    expect(isInsertableImagePath("figures/A.PNG")).toBe(true);
    expect(isInsertableImagePath("plot.pdf")).toBe(true);
    expect(isInsertableImagePath("anim.gif")).toBe(false);
    expect(isInsertableImagePath("plot.eps")).toBe(false);
  });

  it("maps a pasted file type to the extension it is saved with", () => {
    expect(insertableImageExtension("image/png")).toBe("png");
    expect(insertableImageExtension("image/jpeg")).toBe("jpg");
    expect(insertableImageExtension("image/svg+xml")).toBe("svg");
    expect(insertableImageExtension("application/pdf")).toBe("pdf");
    expect(insertableImageExtension("image/gif")).toBeUndefined();
    expect(insertableImageExtension("text/plain")).toBeUndefined();
  });
});

describe("imageMime", () => {
  it("names the MIME type of a previewable image", () => {
    expect(imageMime("a.JPG")).toBe("image/jpeg");
    expect(imageMime("a.jpeg")).toBe("image/jpeg");
    expect(imageMime("a.gif")).toBe("image/gif");
    expect(imageMime("a.webp")).toBe("image/webp");
    expect(imageMime("a.bmp")).toBe("image/bmp");
    expect(imageMime("a.svg")).toBe("image/svg+xml");
  });

  it("falls back to PNG for anything else", () => {
    expect(imageMime("a.png")).toBe("image/png");
    expect(imageMime("plot.pdf")).toBe("image/png");
    expect(imageMime("noext")).toBe("image/png");
  });
});
