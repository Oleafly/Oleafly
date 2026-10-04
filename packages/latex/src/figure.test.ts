import { describe, expect, it } from "vitest";
import { buildStandaloneDoc, bytesToBase64, normalizeFigureCode, slugifyFigureName } from "./figure";

describe("slugifyFigureName", () => {
  it("collapses punctuation and trims the dashes it introduces", () => {
    expect(slugifyFigureName("Transformer Encoder (6 blocks)!")).toBe("transformer-encoder-6-blocks");
    expect(slugifyFigureName("---leading and trailing---")).toBe("leading-and-trailing");
    expect(slugifyFigureName("!!!")).toBe("figure");
    expect(slugifyFigureName("")).toBe("figure");
    expect(slugifyFigureName("   ")).toBe("figure");
  });

  it("never leaves a dash after the 48 character cut", () => {
    const prompt = `${"a".repeat(47)} tail`;
    expect(slugifyFigureName(prompt)).toBe("a".repeat(47));

    const exact = `${"b".repeat(48)} tail`;
    expect(slugifyFigureName(exact)).toBe("b".repeat(48));
  });

  it("looks at no more than the first 200 characters", () => {
    const prompt = `${"c".repeat(200)}zzz`;
    expect(slugifyFigureName(prompt)).toBe("c".repeat(48));
  });
});

describe("bytesToBase64", () => {
  it("round trips every byte value", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const encoded = bytesToBase64(bytes);
    const decoded = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("handles an input larger than one chunk", () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17).fill(0xff);
    bytes[0] = 0x00;
    const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0));
    expect(decoded).toHaveLength(bytes.length);
    expect(decoded[0]).toBe(0);
    expect(decoded.at(-1)).toBe(0xff);
  });

  it("returns an empty string for no bytes", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });
});

describe("normalizeFigureCode", () => {
  it("wraps bare drawing commands in a tikzpicture", () => {
    expect(normalizeFigureCode("  \\draw (0,0) -- (1,1);  ")).toBe(
      "\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}",
    );
  });

  it("leaves code that already opens a tikzpicture alone apart from trimming", () => {
    const code = "\\begin {tikzpicture}[scale=2]\n\\draw (0,0) circle (1);\n\\end{tikzpicture}";
    expect(normalizeFigureCode(`\n${code}\n`)).toBe(code);
  });
});

describe("buildStandaloneDoc", () => {
  it("builds a cropped standalone document around the figure", () => {
    expect(buildStandaloneDoc({ code: "\\draw (0,0) -- (1,0);" })).toBe(
      [
        "\\documentclass[tikz,border=4pt]{standalone}",
        "\\usepackage{tikz}",
        "\\usepackage{lmodern}",
        "\\begin{document}",
        "\\begin{tikzpicture}",
        "\\draw (0,0) -- (1,0);",
        "\\end{tikzpicture}",
        "\\end{document}",
        "",
      ].join("\n"),
    );
  });

  it("adds packages and libraries once each, skipping blanks", () => {
    const doc = buildStandaloneDoc({
      code: "\\begin{tikzpicture}\\end{tikzpicture}",
      packages: ["amsmath", " tikz ", "", "amsmath"],
      libraries: ["arrows.meta", " positioning ", "", "arrows.meta"],
    });
    expect(doc.match(/\\usepackage\{[^}]+\}/g)).toEqual([
      "\\usepackage{tikz}",
      "\\usepackage{lmodern}",
      "\\usepackage{amsmath}",
    ]);
    expect(doc).toContain("\\usetikzlibrary{arrows.meta,positioning}\n\\begin{document}");
  });

  it("paints a valid hex background over the whole page", () => {
    const doc = buildStandaloneDoc({ code: "x", background: "#a1b2c3" });
    expect(doc).toContain("\\usepackage{xcolor}\n\\usepackage{tikz}");
    expect(doc).toContain("\\begin{document}\n\\definecolor{obgcolor}{HTML}{A1B2C3}\n\\pagecolor{obgcolor}\n");
  });

  it("ignores a background that is not a six-digit hex colour", () => {
    for (const background of ["", "white", "#fff", "#12345g"]) {
      const doc = buildStandaloneDoc({ code: "x", background });
      expect(doc).not.toContain("xcolor");
      expect(doc).not.toContain("\\pagecolor");
    }
  });
});
