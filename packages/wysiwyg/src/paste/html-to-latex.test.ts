// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { htmlToLatex } from "./html-to-latex";

const CASES: [name: string, html: string, expected: string][] = [
  ["bold tags", "<p>Hello <b>bold</b> and <strong>strong</strong></p>", "Hello \\textbf{bold} and \\textbf{strong}"],
  [
    "bold styles",
    '<p><span style="font-weight:700">heavy</span> <span style="font-weight: bold">b</span> <span style="font-weight:400">normal</span></p>',
    "\\textbf{heavy} \\textbf{b} normal",
  ],
  ["italic tags and styles", '<p><i>i</i> <em>em</em> <span style="font-style:italic">styled</span></p>', "\\textit{i} \\textit{em} \\textit{styled}"],
  [
    "superscript and subscript",
    '<p>x<sup>2</sup> and H<sub>2</sub>O and <span style="vertical-align:super">s</span></p>',
    "x\\textsuperscript{2} and H\\textsubscript{2}O and \\textsuperscript{s}",
  ],
  [
    "links with protected characters",
    '<p><a href="https://example.com/a_b?x=1&amp;y=2#frag">link</a></p>',
    "\\href{https://example.com/a\\_b?x=1\\&y=2\\#frag}{link}",
  ],
  [
    "headings",
    "<h1>Title</h1><h2>Sub</h2><h3>Subsub</h3><h4>Para</h4><h5>Subpara</h5><h6>Deep</h6>",
    "\\section{Title}\n\n\\subsection{Sub}\n\n\\subsubsection{Subsub}\n\n\\paragraph{Para}\n\n\\subparagraph{Subpara}\n\n\\subparagraph{Deep}",
  ],
  ["line breaks", "<p>line one<br>line two</p>", "line one\n\nline two"],
  ["double break", "<p>a<br/><br/>b</p>", "a\n\nb"],
  ["inline code", "<p>Use <code>a|b</code> and <code>x</code></p>", "Use \\verb!a|b! and \\verb|x|"],
  [
    "code block",
    "<pre><code>int x = 1;\n  y();</code></pre><p>after</p>",
    "\\begin{verbatim}\nint x = 1;\n  y();\n\\end{verbatim}\n\nafter",
  ],
  ["monospace pre", '<pre style="font-family: Menlo, monospace">raw</pre><p>x</p>', "\\begin{verbatim}\nraw\n\\end{verbatim}\n\nx"],
  ["proportional pre", '<pre style="font-family: Georgia, serif">not code</pre><p>x</p>', "not code\n\nx"],
  [
    "nested lists",
    "<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>",
    "\\begin{itemize}\n    \\item one\n    \\item two\n    \\begin{itemize}\n        \\item nested\n    \\end{itemize}\n\\end{itemize}",
  ],
  ["ordered list", "<ol><li>first</li><li>second</li></ol>", "\\begin{enumerate}\n    \\item first\n    \\item second\n\\end{enumerate}"],
  [
    "list nested directly in a list",
    "<ul><li>a</li><ul><li>b</li></ul></ul>",
    "\\begin{itemize}\n    \\item a\n    \\begin{itemize}\n        \\item b\n    \\end{itemize}\n\\end{itemize}",
  ],
  ["blockquote", "<blockquote><p>quoted</p></blockquote>", "\\begin{quote}\nquoted\n\\end{quote}"],
  [
    "escaping",
    "<p>100% &amp; $5 #1 a_b ~ ^ \\ {x}</p>",
    "100\\% \\& \\$5 \\#1 a\\_b \\textasciitilde{} \\textasciicircum{} \\textbackslash{} \\{x\\}",
  ],
  ["non-breaking space", "<p>a&nbsp;b</p>", "a b"],
  ["paragraphs in a div", "<div><p>first</p><p>second</p></div>", "first\n\nsecond"],
  ["whitespace normalisation", "<p>  lots   of\n  space  </p>", "lots of space"],
  ["underline and strike", "<p><u>under</u> <s>gone</s></p>", "\\underline{under} gone"],
  ["whitespace moved outside wrappers", "<p><b> spaced </b>x</p>", "\\textbf{spaced} x"],
  ["images dropped", '<p>see <img src="x.png"> here</p>', "see here"],
  ["mixed inline styles", '<p><span style="font-weight:bold;font-style:italic">both</span></p>', "\\textbf{\\textit{both}}"],
  [
    "basic table",
    '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td style="text-align:right">2</td></tr></table>',
    "\\begin{tabular}{ll}\n    \\textbf{A} & \\textbf{B} \\\\\n    1 & 2 \\\\\n\\end{tabular}",
  ],
  [
    "alignment from the first cell of each column",
    '<table><tr><td style="text-align:center">c</td><td align="right">r</td></tr><tr><td>x</td><td>y</td></tr></table>',
    "\\begin{tabular}{cr}\n    c & r \\\\\n    x & y \\\\\n\\end{tabular}",
  ],
  [
    "bordered table attribute",
    '<table border="1"><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>',
    "\\begin{tabular}{|l|l|}\n    \\hline\n    a & b \\\\\n    \\hline\n    c & d \\\\\n    \\hline\n\\end{tabular}",
  ],
  [
    "borders from inline styles",
    '<table><tr><td style="border: solid windowtext 1.0pt">a</td><td style="border: solid windowtext 1.0pt; border-left: none">b</td></tr><tr><td style="border: solid windowtext 1.0pt; border-top: none">c</td><td style="border-top:none;border-left:none;border-bottom:solid windowtext 1.0pt;border-right:solid windowtext 1.0pt">d</td></tr></table>',
    "\\begin{tabular}{|l|l|}\n    \\hline\n    a & b \\\\\n    \\hline\n    c & d \\\\\n    \\hline\n\\end{tabular}",
  ],
  [
    "colspan",
    '<table><tr><td colspan="2">span</td></tr><tr><td>a</td><td>b</td></tr></table>',
    "\\begin{tabular}{ll}\n    \\multicolumn{2}{l}{span} \\\\\n    a & b \\\\\n\\end{tabular}",
  ],
  [
    "rowspan with filler cells",
    '<table><tr><td rowspan="2">tall</td><td>a</td></tr><tr><td>b</td></tr></table>',
    "\\begin{tabular}{ll}\n    \\multirow{2}{*}{tall} & a \\\\\n     & b \\\\\n\\end{tabular}",
  ],
  [
    "caption becomes a table float",
    "<table><caption>Results</caption><tr><td>x</td></tr></table>",
    "\\begin{table}[htbp]\n    \\centering\n    \\caption{Results}\n    \\begin{tabular}{l}\n        x \\\\\n    \\end{tabular}\n\\end{table}",
  ],
  ["headings inside tables stay text", "<table><tr><td><h1>Head</h1></td><td>x<br>y</td></tr></table>", "\\begin{tabular}{ll}\n    Head & x y \\\\\n\\end{tabular}"],
  ["lists inside tables become inline text", "<table><tr><td><ul><li>a</li><li>b</li></ul></td></tr></table>", "\\begin{tabular}{l}\n    a; b \\\\\n\\end{tabular}"],
  [
    "Word-style table",
    "<html xmlns:o=\"urn:schemas-microsoft-com:office:office\"><head><meta name=ProgId content=Word.Document></head><body><table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:none'><tr><td width=200 valign=top style='border:solid windowtext 1.0pt;padding:0in 5.4pt'><p class=MsoNormal><b>Name</b></p></td><td style='border:solid windowtext 1.0pt;border-left:none'><p class=MsoNormal>Value</p></td></tr><tr><td style='border:solid windowtext 1.0pt;border-top:none'><p class=MsoNormal>a</p></td><td style='border-top:none;border-left:none;border-bottom:solid windowtext 1.0pt;border-right:solid windowtext 1.0pt'><p class=MsoNormal>1</p></td></tr></table></body></html>",
    "\\begin{tabular}{|l|l|}\n    \\hline\n    \\textbf{Name} & Value \\\\\n    \\hline\n    a & 1 \\\\\n    \\hline\n\\end{tabular}",
  ],
  ["table sections", "<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>", "\\begin{tabular}{l}\n    \\textbf{h} \\\\\n    b \\\\\n\\end{tabular}"],
];

describe("htmlToLatex", () => {
  it.each(CASES)("converts %s", (_name, html, expected) => {
    expect(htmlToLatex(html)).toBe(expected);
  });

  it("returns null for empty or whitespace-only content", () => {
    expect(htmlToLatex("")).toBeNull();
    expect(htmlToLatex("<p> </p>")).toBeNull();
    expect(htmlToLatex("<meta charset=utf-8>")).toBeNull();
  });

  it("returns null when the content is only a code block", () => {
    expect(htmlToLatex("<pre>only code</pre>")).toBeNull();
    expect(htmlToLatex("<div><pre><code>x</code></pre></div>")).toBeNull();
  });

  it("defers to files unless the HTML is a lone table or comes from an Office application", () => {
    expect(htmlToLatex("<p>x</p>", { hasFiles: true })).toBeNull();
    expect(htmlToLatex("<table><tr><td>x</td></tr></table>", { hasFiles: true })).toBe(
      "\\begin{tabular}{l}\n    x \\\\\n\\end{tabular}",
    );
    expect(
      htmlToLatex("<google-sheets-html-origin><table><tr><td>x</td></tr></table></google-sheets-html-origin>", {
        hasFiles: true,
      }),
    ).toBe("\\begin{tabular}{l}\n    x \\\\\n\\end{tabular}");
    expect(
      htmlToLatex(
        '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta name=ProgId content=Word.Document></head><body><p class=MsoNormal>Word text</p></body></html>',
        { hasFiles: true },
      ),
    ).toBe("Word text");
  });

  it("falls back to texttt when inline code cannot use any verb delimiter or spans lines", () => {
    expect(htmlToLatex("<p><code>|!+=#@</code></p>")).toBe("\\texttt{|!+=\\#@}");
    expect(htmlToLatex("<p><code>a\nb</code></p>")).toBe("\\texttt{a b}");
  });
});

describe("sanitizes pasted markup", () => {
  it("drops scripts and event handlers before converting", () => {
    const latex = htmlToLatex('<p>Hi<script>alert(1)</script><img src="x" onerror="alert(1)"> there</p>');
    expect(latex).toBe("Hi there");
  });

  it("drops javascript links", () => {
    expect(htmlToLatex('<p><a href="javascript:alert(1)">x</a></p>')).toBe("x");
  });

  it("escapes every LaTeX special character in a link", () => {
    const latex = htmlToLatex('<p><a href="https://x.test/a\\b?c=1&d=_2#f{g}">x</a></p>');
    expect(latex).toBe(String.raw`\href{https://x.test/a\%5Cb?c=1\&d=\_2\#f\{g\}}{x}`);
  });
});
