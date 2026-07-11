import { describe, it, expect } from "vitest";
import { lintLatexText } from "./latex-linter";

describe("lintLatexText: environments", () => {
  it("passes correctly nested environments", () => {
    const d = lintLatexText("\\begin{a}\\begin{b}x\\end{b}\\end{a}");
    expect(d).toHaveLength(0);
  });

  it("flags a mismatched \\end (and the now-unclosed \\begin)", () => {
    const d = lintLatexText("\\begin{itemize}x\\end{enumerate}");
    // The mismatch is reported, and since \begin{itemize} never closes it is
    // also reported as unclosed.
    expect(d).toHaveLength(2);
    expect(d[0].severity).toBe("error");
    expect(d[0].message).toContain("expected \\end{itemize}");
    expect(d[0].message).toContain("got \\end{enumerate}");
    expect(d[1].message).toContain("Unclosed environment \\begin{itemize}");
  });

  it("flags an unclosed environment", () => {
    const d = lintLatexText("\\begin{document}hello");
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("Unclosed environment \\begin{document}");
  });

  it("flags an \\end with no matching \\begin", () => {
    const d = lintLatexText("hello\\end{document}");
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("without matching \\begin");
  });
});

describe("lintLatexText: labels", () => {
  it("warns on a duplicate label, once", () => {
    const d = lintLatexText("\\label{eq:1} ... \\label{eq:1}");
    expect(d).toHaveLength(1);
    expect(d[0].severity).toBe("warning");
    expect(d[0].message).toContain("Duplicate label");
    expect(d[0].message).toContain("eq:1");
  });

  it("allows distinct labels", () => {
    expect(lintLatexText("\\label{a}\\label{b}")).toHaveLength(0);
  });
});

describe("lintLatexText: inline math", () => {
  it("warns on an odd number of $ on a line", () => {
    const d = lintLatexText("the cost is $x per item");
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("Unmatched $");
  });

  it("accepts balanced $ ... $", () => {
    expect(lintLatexText("the cost is $x$ per item")).toHaveLength(0);
  });

  it("ignores escaped \\$ and display $$", () => {
    expect(lintLatexText("price \\$5 and $$E=mc^2$$")).toHaveLength(0);
  });
});
