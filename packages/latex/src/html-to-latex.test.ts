// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("htmlToLatex inline details", () => {
  it("writes inline code containing a no-break space as plain spaces", () => {
    expect(htmlToLatex("<p>run <code>a&nbsp;b</code> now</p>")).toBe(String.raw`run \verb|a b| now`);
  });

  it("drops formatting around nothing but whitespace", () => {
    expect(htmlToLatex("<p>a<b> </b>b</p>")).toBe("a b");
  });

  it("drops HTML comments between words", () => {
    expect(htmlToLatex("<p>a<!--x-->b</p>")).toBe("ab");
  });

  it("flattens block wrappers inside a heading", () => {
    expect(htmlToLatex("<h1><div>Title</div></h1><p>x</p>")).toBe("\\section{Title}\n\nx");
  });

  it("drops empty quotes and horizontal rules", () => {
    expect(htmlToLatex("<blockquote> </blockquote><p>x</p>")).toBe("x");
    expect(htmlToLatex("<p>a</p><hr><p>b</p>")).toBe("a\n\nb");
  });
});

describe("htmlToLatex preformatted text", () => {
  it("treats preformatted text in a proportional font as prose", () => {
    expect(htmlToLatex('<pre style="font-family: Georgia">plain words</pre><p>x</p>')).toBe("plain words\n\nx");
  });

  it("keeps monospace and code blocks verbatim", () => {
    expect(htmlToLatex('<pre style="font-family: Courier New">\ncode  here\n</pre><p>x</p>')).toBe(
      "\\begin{verbatim}\ncode  here\n\\end{verbatim}\n\nx",
    );
    expect(htmlToLatex('<pre style="font-family: Georgia"><code>x = 1</code></pre><p>y</p>')).toBe(
      "\\begin{verbatim}\nx = 1\n\\end{verbatim}\n\ny",
    );
  });
});

describe("htmlToLatex lists", () => {
  it("nests lists inside items and directly inside lists", () => {
    expect(htmlToLatex("<ul><li>a<ol><li>b</li></ol></li><li><ul><li>c</li></ul></li><ul><li>d</li></ul></ul>")).toBe(
      [
        "\\begin{itemize}",
        "    \\item a",
        "    \\begin{enumerate}",
        "        \\item b",
        "    \\end{enumerate}",
        "    \\item",
        "    \\begin{itemize}",
        "        \\item c",
        "    \\end{itemize}",
        "    \\begin{itemize}",
        "        \\item d",
        "    \\end{itemize}",
        "\\end{itemize}",
      ].join("\n"),
    );
  });

  it("joins list items inside a table cell and skips empty ones", () => {
    expect(htmlToLatex("<table><tr><td><ul><li>a</li><li></li><li>b</li></ul></td></tr></table>")).toBe(
      "\\begin{tabular}{l}\n    a; b \\\\\n\\end{tabular}",
    );
  });
});

describe("htmlToLatex tables", () => {
  it("converts a lone table surrounded by whitespace even when files are on the clipboard", () => {
    expect(htmlToLatex("  <table><tr><td>a</td></tr></table>  ", { hasFiles: true })).toBe(
      "\\begin{tabular}{l}\n    a \\\\\n\\end{tabular}",
    );
  });

  it("treats invalid spans as single cells", () => {
    expect(htmlToLatex('<table><tr><td colspan="0">a</td><td colspan="x">b</td></tr></table>')).toBe(
      "\\begin{tabular}{ll}\n    a & b \\\\\n\\end{tabular}",
    );
  });

  it("reads rows from the header, the footer and directly under the table", () => {
    expect(
      htmlToLatex(
        "<table><caption>Cap</caption><thead><tr><th>h</th></tr></thead><tfoot><tr><td>f</td></tr></tfoot><tr><td>direct</td></tr></table>",
      ),
    ).toBe(
      [
        "\\begin{table}[htbp]",
        "    \\centering",
        "    \\caption{Cap}",
        "    \\begin{tabular}{l}",
        "        \\textbf{h} \\\\",
        "        f \\\\",
        "        direct \\\\",
        "    \\end{tabular}",
        "\\end{table}",
      ].join("\n"),
    );
  });

  it("leaves the missing cells of a short row empty", () => {
    expect(htmlToLatex("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>")).toBe(
      "\\begin{tabular}{ll}\n    a & b \\\\\n    c &  \\\\\n\\end{tabular}",
    );
  });

  it("keeps the width of a cell that spans both rows and columns", () => {
    expect(htmlToLatex('<table><tr><td rowspan="2" colspan="2">a</td><td>b</td></tr><tr><td>c</td></tr></table>')).toBe(
      [
        "\\begin{tabular}{lll}",
        "    \\multicolumn{2}{l}{\\multirow{2}{*}{a}} & b \\\\",
        "    \\multicolumn{2}{l}{} & c \\\\",
        "\\end{tabular}",
      ].join("\n"),
    );
  });

  it("flattens line breaks and headings inside cells", () => {
    expect(htmlToLatex("<table><tr><td>a<br>b</td><td><h2>Head</h2></td></tr></table>")).toBe(
      "\\begin{tabular}{ll}\n    a b & Head \\\\\n\\end{tabular}",
    );
  });
});

describe("htmlToLatex without a DOM parser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null", () => {
    vi.stubGlobal("DOMParser", undefined);
    expect(htmlToLatex("<p>x</p>")).toBeNull();
  });
});
