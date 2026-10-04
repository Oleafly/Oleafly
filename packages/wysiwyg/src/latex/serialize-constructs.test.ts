import { afterEach, describe, expect, it, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { createFigure } from "../figure";
import { createTableFloat } from "../table-float";
import { serializeLatexBody } from "./serialize";

function doc(...content: JSONContent[]): JSONContent {
  return { type: "doc", content };
}

function paragraph(...content: JSONContent[]): JSONContent {
  return { type: "paragraph", content };
}

function cell(type: string, textValue: string, attrs: Record<string, unknown> = {}): JSONContent {
  return {
    type,
    attrs: { colspan: 1, rowspan: 1, columnSpec: null, ...attrs },
    content: [textValue ? paragraph({ type: "text", text: textValue }) : { type: "paragraph" }],
  };
}

describe("serializer safety", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes hard breaks, block images and strays captions", () => {
    expect(
      serializeLatexBody(
        doc(
          paragraph({ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }),
          { type: "image", attrs: { src: "img/x.png", alt: "x" } },
          { type: "figureCaption", content: [{ type: "text", text: "c" }] },
        ),
      ),
    ).toBe("a\\\\b\n\n\\includegraphics{img/x.png}\n\n\\caption{c}\n");
  });

  it("serializes strike-through as plain text because the ulem dependency is unknowable", () => {
    expect(serializeLatexBody(doc(paragraph({ type: "text", text: "gone", marks: [{ type: "strike" }] })))).toBe("gone\n");
  });

  it("throws on unknown node types in development builds", () => {
    vi.stubEnv("DEV", true);
    expect(() => serializeLatexBody(doc({ type: "mystery", content: [{ type: "text", text: "x" }] }))).toThrow(
      /mystery/u,
    );
  });

  it("serializes the text of unknown node types outside development builds", () => {
    vi.stubEnv("DEV", false);
    expect(
      serializeLatexBody(
        doc(
          { type: "mystery", content: [{ type: "text", text: "50% sure" }] },
          paragraph({ type: "widget", attrs: { source: "\\gizmo" } }),
        ),
      ),
    ).toBe("50\\% sure\n\n\\textbackslash{}gizmo\n");
  });
});

describe("headings", () => {
  it("writes each sectioning command from its attrs and falls back to the level", () => {
    const heading = (attrs: Record<string, unknown>) => ({
      type: "heading",
      attrs,
      content: [{ type: "text", text: "T" }],
    });
    expect(
      serializeLatexBody(
        doc(
          heading({ level: 1, command: "part" }),
          heading({ level: 1, command: "chapter", starred: true }),
          heading({ level: 1, command: "section", shortTitle: "S" }),
          heading({ level: 2, command: "section" }),
          heading({ level: 4 }),
          heading({ level: 5 }),
          heading({ level: 6 }),
          heading({ level: 0 }),
          heading({ level: 3, command: "textbf" }),
        ),
      ),
    ).toBe(
      [
        "\\part{T}",
        "\\chapter*{T}",
        "\\section[S]{T}",
        "\\subsection{T}",
        "\\paragraph{T}",
        "\\subparagraph{T}",
        "\\subparagraph{T}",
        "\\section{T}",
        "\\subsubsection{T}",
      ].join("\n\n") + "\n",
    );
  });
});

describe("inline nodes and marks", () => {
  it("writes math, footnotes and colours verbatim with nested marks outermost first", () => {
    expect(
      serializeLatexBody(
        doc(
          paragraph(
            { type: "mathInline", attrs: { source: "\\(x\\)" } },
            { type: "footnote", attrs: { source: "note $y$" } },
            { type: "text", text: "a", marks: [{ type: "textColor", attrs: { color: "red!30" } }, { type: "bold" }] },
            { type: "text", text: "b", marks: [{ type: "colorBox", attrs: { color: "[HTML]{FF0000}" } }] },
          ),
          { type: "mathDisplay", attrs: { source: "\\begin{align}\na\n\\end{align}" } },
        ),
      ),
    ).toBe(
      "\\(x\\)\\footnote{note $y$}\\textcolor{red!30}{\\textbf{a}}\\colorbox[HTML]{FF0000}{b}\n\n\\begin{align}\na\n\\end{align}\n",
    );
  });
});

describe("theorems", () => {
  it("writes the environment with an optional title around the body blocks", () => {
    expect(
      serializeLatexBody(
        doc(
          {
            type: "theorem",
            attrs: { environment: "lemma", title: "Key" },
            content: [paragraph({ type: "text", text: "Body." }), { type: "mathDisplay", attrs: { source: "\\[x\\]" } }],
          },
          { type: "theorem", attrs: { environment: "proof", title: null }, content: [paragraph({ type: "text", text: "Done." })] },
        ),
      ),
    ).toBe("\\begin{lemma}[Key]\nBody.\n\n\\[x\\]\n\\end{lemma}\n\n\\begin{proof}\nDone.\n\\end{proof}\n");
  });
});

describe("figures", () => {
  it("writes the canonical layout from the builder", () => {
    expect(serializeLatexBody(doc(createFigure({ path: "fig/a.png", label: "fig:a", caption: "A caption" })))).toBe(
      [
        "\\begin{figure}[htbp]",
        "    \\centering",
        "    \\includegraphics[width=0.5\\linewidth]{fig/a.png}",
        "    \\caption{A caption}",
        "    \\label{fig:a}",
        "\\end{figure}",
        "",
      ].join("\n"),
    );
  });

  it("omits placement, centering, width, caption and label when absent and keeps extra options", () => {
    expect(
      serializeLatexBody(
        doc(
          createFigure({
            path: "d",
            width: null,
            options: "height=2cm,keepaspectratio",
            placement: null,
            centering: false,
            graphicsCommand: "includesvg",
          }),
        ),
      ),
    ).toBe("\\begin{figure}\n    \\includesvg[height=2cm,keepaspectratio]{d}\n\\end{figure}\n");
  });

  it("puts the caption text from the builder into an editable caption node", () => {
    expect(createFigure({ path: "p", caption: "" }).content).toEqual([{ type: "figureCaption", content: [] }]);
    expect(createFigure({ path: "p" }).content).toEqual([]);
  });
});

describe("tables", () => {
  it("writes the float from the builder with booktabs rules and a header row", () => {
    const float = createTableFloat(2, 2);
    expect(float.content?.[0].content?.[0].content?.map((node) => node.type)).toEqual(["tableHeader", "tableHeader"]);
    expect(serializeLatexBody(doc(float))).toBe(
      [
        "\\begin{table}[htbp]",
        "    \\centering",
        "    \\begin{tabular}{ll}",
        "        \\toprule",
        "         &  \\\\",
        "        \\midrule",
        "         &  \\\\",
        "        \\bottomrule",
        "    \\end{tabular}",
        "\\end{table}",
        "",
      ].join("\n"),
    );
    expect(createTableFloat(0, 0, { header: false }).content?.[0].content?.[0].content?.[0].type).toBe("tableCell");
  });

  it("writes a bare tabular for non-floating tables without caption or label", () => {
    const float = createTableFloat(1, 2, { header: false });
    float.attrs = { ...float.attrs, floating: false };
    expect(serializeLatexBody(doc(float))).toBe("\\begin{tabular}{ll}\n    \\toprule\n     &  \\\\\n    \\bottomrule\n\\end{tabular}\n");
  });

  it("places the caption above or below and writes the label", () => {
    const float = createTableFloat(1, 1, { header: false });
    float.attrs = { ...float.attrs, label: "tab:x", captionPosition: "below", placement: null };
    float.content?.push({ type: "tableCaption", content: [{ type: "text", text: "Cap" }] });
    expect(serializeLatexBody(doc(float))).toBe(
      [
        "\\begin{table}",
        "    \\centering",
        "    \\begin{tabular}{l}",
        "        \\toprule",
        "         \\\\",
        "        \\bottomrule",
        "    \\end{tabular}",
        "    \\caption{Cap}",
        "    \\label{tab:x}",
        "\\end{table}",
        "",
      ].join("\n"),
    );
  });

  it("writes a markdown-origin table with inferred columns, spans and fillers", () => {
    const table: JSONContent = {
      type: "table",
      content: [
        { type: "tableRow", content: [cell("tableHeader", "A", { colspan: 2 }), cell("tableHeader", "B")] },
        { type: "tableRow", content: [cell("tableCell", "tall", { rowspan: 2 }), cell("tableCell", "x"), cell("tableCell", "y", { columnSpec: "r" })] },
        { type: "tableRow", content: [cell("tableCell", "p"), cell("tableCell", "q")] },
      ],
    };
    expect(serializeLatexBody(doc(table))).toBe(
      [
        "\\begin{tabular}{lll}",
        "    \\multicolumn{2}{ll}{A} & B \\\\",
        "    \\multirow{2}{*}{tall} & x & \\multicolumn{1}{r}{y} \\\\",
        "     & p & q \\\\",
        "\\end{tabular}",
        "",
      ].join("\n"),
    );
  });

  it("pads missing column specs and truncates extra ones", () => {
    const float = createTableFloat(1, 3, { header: false });
    float.attrs = { ...float.attrs, floating: false, columns: [{ align: "c", width: null, borderLeft: true, borderRight: false }] };
    expect(serializeLatexBody(doc(float))).toContain("\\begin{tabular}{|cll}");
    float.attrs = {
      ...float.attrs,
      columns: [
        { align: "c", width: null, borderLeft: false, borderRight: false },
        { align: "c", width: null, borderLeft: false, borderRight: false },
        { align: "c", width: null, borderLeft: false, borderRight: false },
        { align: "r", width: null, borderLeft: false, borderRight: false },
      ],
    };
    expect(serializeLatexBody(doc(float))).toContain("\\begin{tabular}{ccc}");
  });
});

describe("tables with irregular shapes", () => {
  it("leaves the trailing cells of a short row empty", () => {
    const table: JSONContent = {
      type: "table",
      content: [
        { type: "tableRow", content: [cell("tableCell", "a"), cell("tableCell", "b"), cell("tableCell", "c")] },
        { type: "tableRow", content: [cell("tableCell", "d")] },
      ],
    };
    expect(serializeLatexBody(doc(table))).toBe("\\begin{tabular}{lll}\n    a & b & c \\\\\n    d &  &  \\\\\n\\end{tabular}\n");
  });

  it("treats missing or invalid spans as single cells", () => {
    const table: JSONContent = {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [paragraph({ type: "text", text: "plain" })] },
            cell("tableCell", "zero", { colspan: 0, rowspan: 0 }),
            cell("tableCell", "half", { colspan: 1.5, rowspan: "x" }),
          ],
        },
      ],
    };
    expect(serializeLatexBody(doc(table))).toBe("\\begin{tabular}{lll}\n    plain & zero & half \\\\\n\\end{tabular}\n");
  });

  it("writes empty rows for rows and cells without content", () => {
    expect(
      serializeLatexBody(doc({ type: "table", content: [{ type: "tableRow" }, { type: "tableRow", content: [{ type: "tableCell" }] }] })),
    ).toBe("\\begin{tabular}{l}\n     \\\\\n     \\\\\n\\end{tabular}\n");
  });

  it("ignores stray non-row children of a table", () => {
    const table: JSONContent = {
      type: "table",
      content: [paragraph({ type: "text", text: "stray" }), { type: "tableRow", content: [cell("tableCell", "kept")] }],
    };
    expect(serializeLatexBody(doc(table))).toBe("\\begin{tabular}{l}\n    kept \\\\\n\\end{tabular}\n");
  });

  it("writes a float without attrs as a plain table environment", () => {
    const table: JSONContent = { type: "table", content: [{ type: "tableRow", content: [cell("tableCell", "x")] }] };
    expect(serializeLatexBody(doc({ type: "tableFloat", content: [table] }))).toBe(
      "\\begin{table}\n    \\begin{tabular}{l}\n        x \\\\\n    \\end{tabular}\n\\end{table}\n",
    );
  });

  it("keeps the float for a non-floating table that has a label or a caption", () => {
    const labelled = createTableFloat(1, 1, { header: false });
    labelled.attrs = { ...labelled.attrs, floating: false, label: "tab:kept", placement: "" };
    expect(serializeLatexBody(doc(labelled))).toContain("\\begin{table}\n");
    expect(serializeLatexBody(doc(labelled))).toContain("\\label{tab:kept}");

    const captioned = createTableFloat(1, 1, { header: false });
    captioned.attrs = { ...captioned.attrs, floating: false, captionPosition: "above" };
    captioned.content?.push({ type: "tableCaption", content: [{ type: "text", text: "Top" }] });
    expect(serializeLatexBody(doc(captioned))).toMatch(/\\centering\n {4}\\caption\{Top\}\n {4}\\begin\{tabular\}/u);
  });
});

describe("lists", () => {
  it("writes nested blocks inside an item indented under the item line", () => {
    expect(
      serializeLatexBody(
        doc({
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                paragraph({ type: "text", text: "one" }),
                { type: "orderedList", content: [{ type: "listItem", content: [paragraph({ type: "text", text: "nested" })] }] },
                { type: "mathDisplay", attrs: { source: "$$x$$" } },
              ],
            },
            { type: "listItem", content: [{ type: "mathDisplay", attrs: { source: "\\[y\\]" } }] },
          ],
        }),
      ),
    ).toBe(
      [
        "\\begin{itemize}",
        "  \\item one",
        "  \\begin{enumerate}",
        "    \\item nested",
        "  \\end{enumerate}",
        "  $$x$$",
        "  \\item ",
        "  \\[y\\]",
        "\\end{itemize}",
        "",
      ].join("\n"),
    );
  });
});

describe("stray table parts", () => {
  it("serializes rows, cells and headers outside a table and nested docs", () => {
    expect(
      serializeLatexBody(
        doc(
          { type: "tableRow", content: [cell("tableCell", "a"), cell("tableHeader", "b")] },
          cell("tableCell", "solo"),
          { type: "tableCaption", content: [{ type: "text", text: "cap" }] },
          { type: "doc", content: [paragraph({ type: "text", text: "inner" })] },
        ),
      ),
    ).toBe("a & b\n\nsolo\n\n\\caption{cap}\n\ninner\n");
  });
});

describe("sparse editor JSON", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults headings, theorems, raw blocks and images that omit their attrs", () => {
    expect(
      serializeLatexBody(
        doc(
          { type: "heading", content: [{ type: "text", text: "Untitled" }] },
          { type: "theorem" },
          { type: "rawBlock" },
          { type: "image" },
        ),
      ),
    ).toBe("\\section{Untitled}\n\n\\begin{theorem}\n\n\\end{theorem}\n\n\\includegraphics{}\n");
  });

  it("writes empty containers when the editor omits their content", () => {
    expect(serializeLatexBody(doc({ type: "blockquote" }))).toBe("\\begin{quote}\n\n\\end{quote}\n");
    expect(serializeLatexBody(doc({ type: "orderedList" }))).toBe("\\begin{enumerate}\n\n\\end{enumerate}\n");
    expect(serializeLatexBody(doc({ type: "bulletList", content: [{ type: "listItem" }] }))).toBe(
      "\\begin{itemize}\n  \\item \n\\end{itemize}\n",
    );
    expect(
      serializeLatexBody(doc({ type: "tableRow", content: [{ type: "tableCell" }, { type: "tableHeader" }] })),
    ).toBe(" & \n");
    expect(serializeLatexBody(doc({ type: "doc" }, paragraph({ type: "text", text: "after" })))).toBe("after\n");
  });

  it("skips item blocks that serialize to nothing and keeps nested blank lines unindented", () => {
    const item: JSONContent = {
      type: "listItem",
      content: [
        paragraph({ type: "text", text: "lead" }),
        { type: "paragraph" },
        {
          type: "theorem",
          attrs: { environment: "lemma" },
          content: [paragraph({ type: "text", text: "one" }), paragraph({ type: "text", text: "two" })],
        },
      ],
    };

    expect(serializeLatexBody(doc({ type: "bulletList", content: [item] }))).toBe(
      "\\begin{itemize}\n  \\item lead\n  \\begin{lemma}\n  one\n\n  two\n  \\end{lemma}\n\\end{itemize}\n",
    );
  });

  it("serializes inline nodes that appear where a block is expected", () => {
    expect(
      serializeLatexBody(doc({ type: "mathInline", attrs: { source: "$x$" } }, { type: "text", text: "a & b" })),
    ).toBe("$x$\n\na \\& b\n");
  });

  it("writes the text of typeless nodes outside development builds and names them in development", () => {
    vi.stubEnv("DEV", false);
    expect(serializeLatexBody(doc({ content: [{ type: "text", text: "loose" }] }, paragraph({ content: [{ type: "text" }] })))).toBe(
      "loose\n",
    );

    vi.stubEnv("DEV", true);
    expect(() => serializeLatexBody(doc({ content: [] }))).toThrow(/"unknown"/u);
  });

  it("reads the text of unknown nodes whose source attr is not a string", () => {
    vi.stubEnv("DEV", false);
    expect(
      serializeLatexBody(doc({ type: "gadget", attrs: { source: 42 }, content: [{ type: "text", text: "kept" }] })),
    ).toBe("kept\n");
  });
});

describe("inline marks and nodes", () => {
  it("writes underline and code marks", () => {
    expect(
      serializeLatexBody(
        doc(
          paragraph(
            { type: "text", text: "under", marks: [{ type: "underline" }] },
            { type: "text", text: " " },
            { type: "text", text: "a_b", marks: [{ type: "code" }] },
          ),
        ),
      ),
    ).toBe("\\underline{under} \\texttt{a\\_b}\n");
  });

  it("leaves text untouched by marks it has no LaTeX form for", () => {
    expect(
      serializeLatexBody(doc(paragraph({ type: "text", text: "glow", marks: [{ type: "highlight" }, { type: "bold" }] }))),
    ).toBe("\\textbf{glow}\n");
  });

  it("writes empty arguments when marks and nodes omit their attrs", () => {
    expect(
      serializeLatexBody(
        doc(
          paragraph(
            { type: "text", text: "tinted", marks: [{ type: "textColor" }] },
            { type: "text", text: "site", marks: [{ type: "link" }] },
            { type: "text" },
            { type: "rawInline" },
            { type: "footnote" },
          ),
        ),
      ),
    ).toBe("\\textcolor{}{tinted}\\href{}{site}\\footnote{}\n");
  });

  it("writes inline images with and without a source", () => {
    expect(
      serializeLatexBody(
        doc(paragraph({ type: "text", text: "icon " }, { type: "image", attrs: { src: "a.png" } }, { type: "image" })),
      ),
    ).toBe("icon \\includegraphics{a.png}\\includegraphics{}\n");
  });
});
