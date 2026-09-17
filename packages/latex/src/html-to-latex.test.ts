// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { escapeLatexText, htmlToLatex } from "./index";

describe("escapeLatexText", () => {
  it("escapes the characters LaTeX reserves", () => {
    expect(escapeLatexText("100% of a&b {c} #1 _x $y")).toBe(
      String.raw`100\% of a\&b \{c\} \#1 \_x \$y`,
    );
  });

  it("uses command forms for backslash, caret and tilde", () => {
    expect(escapeLatexText("a\\b^c~d")).toBe(
      String.raw`a\textbackslash{}b\textasciicircum{}c\textasciitilde{}d`,
    );
  });
});

describe("htmlToLatex from the latex package", () => {
  it("converts a formatted fragment", () => {
    expect(htmlToLatex("<p>Hello <b>bold</b> and <i>italic</i></p>")).toBe(
      String.raw`Hello \textbf{bold} and \textit{italic}`,
    );
  });

  it("returns null for content it will not convert", () => {
    expect(htmlToLatex("")).toBeNull();
    expect(htmlToLatex("<pre>only code</pre>")).toBeNull();
    expect(htmlToLatex("<p>x</p>", { hasFiles: true })).toBeNull();
  });
});
