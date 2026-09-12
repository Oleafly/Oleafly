import { describe, expect, it } from "vitest";
import { equationToSvgDocument } from "./equation-export";

describe("equationToSvgDocument", () => {
  it("renders TeX to a standalone svg with paths", async () => {
    const svg = await equationToSvgDocument("E = mc^2", true);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain("<path");
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("renders matrices and aligned systems", async () => {
    const aligned = await equationToSvgDocument(
      "\\begin{aligned} a &= b + c \\\\ d &= e \\end{aligned}",
      true,
    );
    expect(aligned).toContain("<path");
    const matrix = await equationToSvgDocument(
      "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}",
      true,
    );
    expect(matrix).toContain("<path");
  });

  it("rejects broken input with the MathJax error", async () => {
    await expect(equationToSvgDocument("\\begin{aligned}", true)).rejects.toThrow();
  });
});
