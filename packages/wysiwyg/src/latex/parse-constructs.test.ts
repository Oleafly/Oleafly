import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { parseLatexBody, type ParseLatexBodyOptions } from "./parse";

function blocks(body: string, options?: ParseLatexBodyOptions): JSONContent[] {
  return parseLatexBody(body, options).content ?? [];
}

function first(body: string, options?: ParseLatexBodyOptions): JSONContent {
  return blocks(body, options)[0];
}

function text(node: JSONContent | undefined): string {
  return (node?.content ?? []).map((child) => child.text ?? "").join("");
}

describe("sectioning", () => {
  it("parses every sectioning command with its level, command, star and short title", () => {
    const doc = blocks(
      "\\section*[Short]{Long \\textbf{title}}\n\\chapter{Chap}\n\\part{P}\n\\subsection{S}\n\\subsubsection{SS}\n\\paragraph{Para}\n\\subparagraph{Sub}\n",
    );
    expect(doc.map((node) => node.attrs)).toEqual([
      { level: 1, command: "section", starred: true, shortTitle: "Short" },
      { level: 1, command: "chapter", starred: false, shortTitle: null },
      { level: 1, command: "part", starred: false, shortTitle: null },
      { level: 2, command: "subsection", starred: false, shortTitle: null },
      { level: 3, command: "subsubsection", starred: false, shortTitle: null },
      { level: 4, command: "paragraph", starred: false, shortTitle: null },
      { level: 5, command: "subparagraph", starred: false, shortTitle: null },
    ]);
    expect(doc[0].content).toEqual([
      { type: "text", text: "Long " },
      { type: "text", text: "title", marks: [{ type: "bold" }] },
    ]);
  });

  it("keeps inline math inside a heading as an inline node", () => {
    const heading = first("\\section{Energy $E=mc^2$ and $$x$$}\n");
    expect(heading.type).toBe("heading");
    expect(heading.content?.map((node) => node.type)).toEqual(["text", "mathInline", "text", "mathInline"]);
    expect(heading.content?.[3].attrs?.source).toBe("$$x$$");
  });

  it("produces a heading without content for an empty title", () => {
    expect(first("\\section{}\n")).toEqual({
      type: "heading",
      attrs: { level: 1, command: "section", starred: false, shortTitle: null },
    });
  });
});

describe("paragraph boundaries", () => {
  it("drops the line break between a paragraph and a following raw block", () => {
    const doc = parseLatexBody("Closing words\n\\bibliographystyle{plain}\n");
    const paragraph = doc.content?.[0];
    expect(paragraph?.type).toBe("paragraph");
    expect(paragraph?.content?.map((node) => node.text).join("")).toBe("Closing words");
    expect(doc.content?.[1]?.type).toBe("rawBlock");
  });
});

describe("footnotes", () => {
  it("captures the exact footnote body including nested braces and math", () => {
    const paragraph = first("Text\\footnote{A note with \\emph{nested {braces}} and $x^2$} more.\n");
    expect(paragraph.content).toEqual([
      { type: "text", text: "Text" },
      { type: "footnote", attrs: { source: "A note with \\emph{nested {braces}} and $x^2$" } },
      { type: "text", text: " more." },
    ]);
  });

  it("keeps a footnote with an optional argument as raw inline source", () => {
    const paragraph = first("A\\footnote[3]{numbered} B\n");
    expect(paragraph.content?.some((node) => node.type === "footnote")).toBe(false);
    expect(paragraph.content?.find((node) => node.type === "rawInline")?.attrs?.source).toBe("\\footnote[3]{numbered}");
  });
});

describe("colours", () => {
  it("parses textcolor and colorbox into marks carrying the raw specification", () => {
    const paragraph = first("\\textcolor{red}{warm} and \\textcolor[HTML]{FF0000}{hex} \\colorbox{yellow}{box}\n");
    expect(paragraph.content).toEqual([
      { type: "text", text: "warm", marks: [{ type: "textColor", attrs: { color: "red" } }] },
      { type: "text", text: " and " },
      { type: "text", text: "hex", marks: [{ type: "textColor", attrs: { color: "[HTML]{FF0000}" } }] },
      { type: "text", text: " " },
      { type: "text", text: "box", marks: [{ type: "colorBox", attrs: { color: "yellow" } }] },
    ]);
  });

  it("nests colour marks with formatting marks, outermost first", () => {
    const paragraph = first("\\textcolor{blue!40!white}{a \\textbf{b}}\n");
    expect(paragraph.content?.[1].marks).toEqual([
      { type: "textColor", attrs: { color: "blue!40!white" } },
      { type: "bold" },
    ]);
  });

  it("colours the following token when the braces are omitted, as LaTeX does", () => {
    const paragraph = first("\\textcolor{red} x\n");
    expect(paragraph.content?.[0]).toEqual({ type: "text", text: "x", marks: [{ type: "textColor", attrs: { color: "red" } }] });
  });

  it("keeps a colour command without content as raw inline source", () => {
    const paragraph = first("\\colorbox{yellow}\n");
    expect(paragraph.content?.[0].type).toBe("rawInline");
    expect(paragraph.content?.[0].attrs?.source).toContain("\\colorbox{yellow}");
  });
});

describe("math", () => {
  it("keeps inline math inline and lifts display math out of the paragraph", () => {
    expect(blocks("Inline $a$ and \\(b\\) then display \\[c\\] and $$d$$ end.\n")).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Inline " },
          { type: "mathInline", attrs: { source: "$a$" } },
          { type: "text", text: " and " },
          { type: "mathInline", attrs: { source: "\\(b\\)" } },
          { type: "text", text: " then display" },
        ],
      },
      { type: "mathDisplay", attrs: { source: "\\[c\\]" } },
      { type: "paragraph", content: [{ type: "text", text: "and" }] },
      { type: "mathDisplay", attrs: { source: "$$d$$" } },
      { type: "paragraph", content: [{ type: "text", text: "end." }] },
    ]);
  });

  it("uses the preserved ranges the app supplies so delimiters stay byte-exact", () => {
    const body = "Sum \\(\\sum_i x_i\\) and $y$ here.\n";
    const ranges = [
      { from: body.indexOf("\\("), to: body.indexOf("\\)") + 2 },
      { from: body.indexOf("$y$"), to: body.indexOf("$y$") + 3 },
    ];
    const paragraph = first(body, { preservedInlineRanges: ranges });
    expect(paragraph.content?.map((node) => node.attrs?.source ?? node.text)).toEqual([
      "Sum ",
      "\\(\\sum_i x_i\\)",
      " and ",
      "$y$",
      " here.",
    ]);
  });

  it("keeps an incomplete preserved range as raw inline source", () => {
    const body = "Broken $x here\n";
    const paragraph = first(body, { preservedInlineRanges: [{ from: 7, to: body.length - 1 }] });
    expect(paragraph.content?.[1]).toEqual({ type: "rawInline", attrs: { source: "$x here" } });
  });

  it("captures display environments byte for byte", () => {
    const source = "\\begin{align}\n  a &= b \\\\\n  c &= d\n\\end{align}";
    expect(blocks(`${source}\n\\begin{equation}\nx^2\n\\end{equation}\n\\begin{eqnarray*}\na & = & b\n\\end{eqnarray*}\n`)).toEqual([
      { type: "mathDisplay", attrs: { source } },
      { type: "mathDisplay", attrs: { source: "\\begin{equation}\nx^2\n\\end{equation}" } },
      { type: "mathDisplay", attrs: { source: "\\begin{eqnarray*}\na & = & b\n\\end{eqnarray*}" } },
    ]);
  });

  it("restores preserved math inside a display environment", () => {
    const body = "\\begin{align}\n\\text{for $x$}\n\\end{align}\n";
    const from = body.indexOf("$x$");
    expect(first(body, { preservedInlineRanges: [{ from, to: from + 3 }] }).attrs?.source).toBe(
      "\\begin{align}\n\\text{for $x$}\n\\end{align}",
    );
  });

  it("leaves math environments it cannot render as raw blocks", () => {
    expect(first("\\begin{alignat}{2}\na &= b\n\\end{alignat}\n").type).toBe("rawBlock");
  });

  it("promotes display math inside a list item behind a leading paragraph", () => {
    expect(first("\\begin{itemize}\n\\item $$x$$ only\n\\end{itemize}\n")).toEqual({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph" },
            { type: "mathDisplay", attrs: { source: "$$x$$" } },
            { type: "paragraph", content: [{ type: "text", text: "only" }] },
          ],
        },
      ],
    });
  });
});

describe("theorem environments", () => {
  it("parses the standard environments with a title and a recursively parsed body", () => {
    expect(first("\\begin{theorem}[Euler's identity]\nBody $e^{i\\pi}$ here.\n\nSecond paragraph.\n\\end{theorem}\n")).toEqual({
      type: "theorem",
      attrs: { environment: "theorem", title: "Euler's identity" },
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Body " },
            { type: "mathInline", attrs: { source: "$e^{i\\pi}$" } },
            { type: "text", text: " here." },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "Second paragraph." }] },
      ],
    });
  });

  it("nests lists and display math inside a proof", () => {
    const proof = first("\\begin{proof}\n\\begin{itemize}\n\\item step\n\\end{itemize}\n\\[x\\]\n\\end{proof}\n");
    expect(proof.attrs).toEqual({ environment: "proof", title: null });
    expect(proof.content?.map((node) => node.type)).toEqual(["bulletList", "mathDisplay"]);
  });

  it("gives an empty theorem one empty paragraph", () => {
    expect(first("\\begin{lemma}\n\\end{lemma}\n").content).toEqual([{ type: "paragraph" }]);
  });

  it("only treats preamble-declared names as theorems when the option lists them", () => {
    const body = "\\begin{mytheorem}[custom title]\nBody.\n\\end{mytheorem}\n";
    expect(first(body).type).toBe("rawBlock");
    expect(first(body, { theoremEnvironments: ["mytheorem"] })).toMatchObject({
      type: "theorem",
      attrs: { environment: "mytheorem", title: "custom title" },
    });
  });
});

describe("figures", () => {
  const canonical =
    "\\begin{figure}[htbp]\n    \\centering % keep\n    \\includegraphics[height=3cm,width=0.5\\linewidth]{fig/a.png}\n    \\caption{A \\textbf{caption}}\n    \\label{fig:a}\n\\end{figure}\n";

  it("parses the canonical figure shape with a comment, width and other options", () => {
    expect(first(canonical)).toEqual({
      type: "figure",
      attrs: {
        path: "fig/a.png",
        width: "0.5\\linewidth",
        options: "height=3cm",
        placement: "htbp",
        centering: true,
        label: "fig:a",
        graphicsCommand: "includegraphics",
      },
      content: [
        {
          type: "figureCaption",
          content: [
            { type: "text", text: "A " },
            { type: "text", text: "caption", marks: [{ type: "bold" }] },
          ],
        },
      ],
    });
  });

  it("parses a minimal figure and includesvg without caption, label or placement", () => {
    expect(first("\\begin{figure}\n\\includesvg{diagram}\n\\end{figure}\n")).toEqual({
      type: "figure",
      attrs: {
        path: "diagram",
        width: null,
        options: null,
        placement: null,
        centering: false,
        label: null,
        graphicsCommand: "includesvg",
      },
      content: [],
    });
  });

  it("accepts the caption and label before the graphic", () => {
    const figure = first("\\begin{figure}[t]\n\\caption{Early}\n\\label{fig:e}\n\\includegraphics{x.pdf}\n\\end{figure}\n");
    expect(figure.type).toBe("figure");
    expect(figure.attrs?.label).toBe("fig:e");
    expect(text(figure.content?.[0])).toBe("Early");
  });

  it.each([
    ["figure*", "\\begin{figure*}\n\\includegraphics{x}\n\\end{figure*}\n"],
    ["two graphics", "\\begin{figure}\n\\includegraphics{a}\n\\includegraphics{b}\n\\end{figure}\n"],
    ["short caption", "\\begin{figure}\n\\includegraphics{a}\n\\caption[short]{long}\n\\end{figure}\n"],
    ["subfigures", "\\begin{figure}\n\\begin{subfigure}{.5\\textwidth}\\includegraphics{a}\\end{subfigure}\n\\end{figure}\n"],
    ["extra text", "\\begin{figure}\n\\includegraphics{a}\nSome text\n\\end{figure}\n"],
    ["no graphic", "\\begin{figure}\n\\centering\n\\caption{x}\n\\end{figure}\n"],
    ["two captions", "\\begin{figure}\n\\includegraphics{a}\n\\caption{x}\n\\caption{y}\n\\end{figure}\n"],
    ["unknown command", "\\begin{figure}\n\\includegraphics{a}\n\\vspace{1em}\n\\end{figure}\n"],
    ["braced centering", "\\begin{figure}\n{\\centering \\includegraphics{a}}\n\\end{figure}\n"],
  ])("keeps a %s figure as a raw block", (_name, body) => {
    const node = first(body);
    expect(node.type).toBe("rawBlock");
    expect(node.attrs?.source).toContain("\\begin{figure");
  });

  it("keeps includegraphics outside a figure as raw inline source", () => {
    const paragraph = first("See \\includegraphics[width=2cm]{x.png} here\n");
    expect(paragraph.type).toBe("paragraph");
    expect(paragraph.content?.[1]).toEqual({ type: "rawInline", attrs: { source: "\\includegraphics[width=2cm]{x.png}" } });
  });
});

describe("tables", () => {
  const float =
    "\\begin{table}[h]\n  \\centering\n  \\begin{tabular}{|l|c r|p{3cm}|}\n    \\hline\n    A & B & \\multicolumn{2}{c}{C} \\\\\n    \\hline\n    1 & 2 & 3 & 4 \\\\ \\hline\n  \\end{tabular}\n  \\caption{T}\n  \\label{tab:t}\n\\end{table}\n";

  it("parses a table float with borders, rules, a multicolumn header and a caption below", () => {
    const node = first(float);
    expect(node.type).toBe("tableFloat");
    expect(node.attrs).toEqual({
      placement: "h",
      centering: true,
      label: "tab:t",
      captionPosition: "below",
      columns: [
        { align: "l", width: null, borderLeft: true, borderRight: true },
        { align: "c", width: null, borderLeft: false, borderRight: false },
        { align: "r", width: null, borderLeft: false, borderRight: true },
        { align: "p", width: "3cm", borderLeft: false, borderRight: true },
      ],
      floating: true,
    });
    const table = node.content?.[0];
    expect(table?.type).toBe("table");
    expect(table?.content?.map((row) => row.attrs)).toEqual([
      { borderTop: "hline", borderBottom: null },
      { borderTop: "hline", borderBottom: "hline" },
    ]);
    expect(table?.content?.[0].content?.map((cell) => cell.type)).toEqual(["tableHeader", "tableHeader", "tableHeader"]);
    expect(table?.content?.[0].content?.[2]).toEqual({
      type: "tableHeader",
      attrs: { colspan: 2, rowspan: 1, columnSpec: "c" },
      content: [{ type: "paragraph", content: [{ type: "text", text: "C" }] }],
    });
    expect(table?.content?.[1].content?.map((cell) => cell.type)).toEqual(["tableCell", "tableCell", "tableCell", "tableCell"]);
    expect(node.content?.[1]).toEqual({ type: "tableCaption", content: [{ type: "text", text: "T" }] });
  });

  it("parses a bare tabular with booktabs rules and inline marks in cells", () => {
    const node = first("\\begin{tabular}{cc}\n\\toprule\na & \\textbf{b} \\\\\n\\midrule\n1 & 2 \\\\\n\\bottomrule\n\\end{tabular}\n");
    expect(node.attrs).toMatchObject({ floating: false, placement: null, centering: false, label: null, captionPosition: null });
    const rows = node.content?.[0].content ?? [];
    expect(rows.map((row) => row.attrs)).toEqual([
      { borderTop: "toprule", borderBottom: null },
      { borderTop: "midrule", borderBottom: "bottomrule" },
    ]);
    expect(rows[0].content?.[1].content?.[0].content).toEqual([{ type: "text", text: "b", marks: [{ type: "bold" }] }]);
  });

  it("puts a caption written before the tabular above the table", () => {
    const node = first("\\begin{table}\n\\caption{Above}\n\\begin{tabular}{l}\nx \\\\\n\\end{tabular}\n\\end{table}\n");
    expect(node.attrs?.captionPosition).toBe("above");
  });

  it("pads short rows and keeps a table without a header when no rule follows the first row", () => {
    const node = first("\\begin{tabular}{ll}\na \\\\\nb & c\n\\end{tabular}\n");
    const rows = node.content?.[0].content ?? [];
    expect(rows[0].content).toHaveLength(2);
    expect(rows[0].content?.map((cell) => cell.type)).toEqual(["tableCell", "tableCell"]);
    expect(rows[0].content?.[1].content).toEqual([{ type: "paragraph" }]);
  });

  it("drops comments inside the float body", () => {
    const node = first("\\begin{table}\n% hidden\n\\begin{tabular}{l}\nx % note\n\\end{tabular}\n\\end{table}\n");
    expect(node.type).toBe("tableFloat");
    expect(text(node.content?.[0].content?.[0].content?.[0].content?.[0])).toBe("x");
  });

  it.each([
    ["cline", "\\begin{tabular}{ll}\na & b \\\\ \\cline{1-2}\nc & d\n\\end{tabular}\n"],
    ["multirow", "\\begin{tabular}{ll}\n\\multirow{2}{*}{a} & b \\\\\n& c\n\\end{tabular}\n"],
    ["nested tabular", "\\begin{tabular}{l}\n\\begin{tabular}{l}x\\end{tabular}\n\\end{tabular}\n"],
    ["X column", "\\begin{tabular}{lX}\na & b\n\\end{tabular}\n"],
    ["S column", "\\begin{tabular}{S}\n1.2\n\\end{tabular}\n"],
    ["row spacing", "\\begin{tabular}{l}\na \\\\[2pt]\nb\n\\end{tabular}\n"],
    ["tabular*", "\\begin{tabular*}{\\textwidth}{cc}\na & b\n\\end{tabular*}\n"],
    ["position argument", "\\begin{tabular}[t]{l}\na\n\\end{tabular}\n"],
    ["too many cells", "\\begin{tabular}{l}\na & b\n\\end{tabular}\n"],
    ["resizebox in float", "\\begin{table}\n\\resizebox{\\textwidth}{!}{\\begin{tabular}{l}a\\end{tabular}}\n\\end{table}\n"],
    ["float without tabular", "\\begin{table}\n\\caption{x}\n\\end{table}\n"],
    ["rule with spacing", "\\begin{tabular}{l}\n\\toprule[1pt]\na\n\\end{tabular}\n"],
    ["double border", "\\begin{tabular}{||l||}\na\n\\end{tabular}\n"],
  ])("keeps a %s table as a raw block", (_name, body) => {
    const node = first(body);
    expect(node.type).toBe("rawBlock");
    expect(node.attrs?.source).toContain("\\begin{tab");
  });
});

describe("lists", () => {
  it("nests list environments inside items as native lists", () => {
    expect(first("\\begin{itemize}\n  \\item one\n  \\begin{enumerate}\n    \\item nested\n  \\end{enumerate}\n  \\item two\n\\end{itemize}\n")).toEqual({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "one" }] },
            {
              type: "orderedList",
              content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "nested" }] }] }],
            },
          ],
        },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
      ],
    });
  });

  it("gives an item that only holds a nested list a leading empty paragraph", () => {
    const item = first("\\begin{itemize}\n\\item \\begin{itemize}\\item x\\end{itemize}\n\\end{itemize}\n").content?.[0];
    expect(item?.content?.map((node) => node.type)).toEqual(["paragraph", "bulletList"]);
  });
});
