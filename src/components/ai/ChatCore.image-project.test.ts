import { describe, expect, it } from "vitest";

import { imageProjectRule } from "./ChatCore";

describe("image project rule", () => {
  it("keeps the standalone TikZ guidance for LaTeX figures", () => {
    expect(imageProjectRule("latex")).toBe(`
This is an IMAGE project, not a text document. The main document is a standalone TikZ/LaTeX figure that compiles to a single cropped image (not a paper). Your job is to build, edit, and fix that ONE figure: shapes, arrows, labels, colors, and layout. Do not add prose, sections, abstracts, bibliographies, or multi-page document structure. Keep the standalone document class and its tikzpicture. When you compile, success means the figure renders cleanly; the "PDF" here is the image.`);
  });

  it("describes a Typst figure without asking for LaTeX", () => {
    const rule = imageProjectRule("typst");
    expect(rule).toContain("This is an IMAGE project, not a text document.");
    expect(rule).toContain("standalone Typst figure");
    expect(rule).toContain("#set page(width: auto, height: auto");
    expect(rule).not.toMatch(/tikz|LaTeX|document class/i);
  });
});
