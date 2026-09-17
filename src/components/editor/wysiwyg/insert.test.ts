// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { createWysiwygExtensions, serializeLatexBody } from "@oleafly/wysiwyg";
import {
  insertLatexIntoVisualEditor,
  insertVisualFigure,
  latexToVisualContent,
  positionAfterEnclosing,
} from "./insert";

const FIGURE_TEMPLATE =
  "\\begin{figure}[h]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{image-filename}\n  \\caption{Caption text}\n  \\label{fig:label}\n\\end{figure}\n";
const TABLE_TEMPLATE =
  "\\begin{table}[htbp]\n  \\centering\n  \\caption{}\n  \\begin{tabular}{ll}\n     &   \\\\\n  \\end{tabular}\n\\end{table}\n";

let editors: Editor[] = [];

function mount(content: JSONContent | string = ""): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: createWysiwygExtensions(),
    content,
    editorProps: { handleScrollToSelection: () => true },
  });
  editors.push(editor);
  return editor;
}

function mountAfterHello(): Editor {
  const editor = mount("<p>Hello</p>");
  editor.commands.setTextSelection(6);
  return editor;
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  document.body.replaceChildren();
});

describe("latexToVisualContent", () => {
  it("turns delimited math into math nodes", () => {
    expect(latexToVisualContent("$x^2$", false, [])).toEqual([{ type: "mathInline", attrs: { source: "$x^2$" } }]);
    expect(latexToVisualContent("\\begin{align}\n  \n\\end{align}\n", true, [])).toEqual([
      { type: "mathDisplay", attrs: { source: "\\begin{align}\n  \n\\end{align}" } },
    ]);
  });

  it("keeps snippets the parser does not understand as raw nodes with their exact source", () => {
    expect(latexToVisualContent("\\alpha", false, [])).toEqual([{ type: "rawInline", attrs: { source: "\\alpha" } }]);
    expect(latexToVisualContent("\\ref{label}", false, [])).toEqual([{ type: "rawInline", attrs: { source: "\\ref{label}" } }]);
    expect(latexToVisualContent("\\begin{figure}\n\\end{figure}\n", true, [])).toEqual([
      { type: "rawBlock", attrs: { source: "\\begin{figure}\n\\end{figure}\n" } },
    ]);
    expect(latexToVisualContent("   ", false, [])).toEqual([{ type: "rawInline", attrs: { source: "   " } }]);
  });

  it("parses footnotes, marks, headings, figures, tables and theorems into native nodes", () => {
    expect(latexToVisualContent("\\footnote{note text}", false, [])).toEqual([
      { type: "footnote", attrs: { source: "note text" } },
    ]);
    expect(latexToVisualContent("\\underline{text}", false, [])[0]).toMatchObject({
      type: "text",
      text: "text",
      marks: [{ type: "underline" }],
    });
    expect(latexToVisualContent("\\href{url}{link text}", false, [])[0]).toMatchObject({
      type: "text",
      text: "link text",
      marks: [{ type: "link", attrs: { href: "url" } }],
    });
    expect(latexToVisualContent("\\part{Part Title}\n", false, [])[0]).toMatchObject({
      type: "heading",
      attrs: { level: 1, command: "part" },
    });
    expect(latexToVisualContent(FIGURE_TEMPLATE, true, [])[0]).toMatchObject({
      type: "figure",
      attrs: { path: "image-filename", width: "0.8\\textwidth", label: "fig:label", placement: "h" },
    });
    expect(latexToVisualContent(TABLE_TEMPLATE, true, [])[0]).toMatchObject({ type: "tableFloat" });
    expect(latexToVisualContent("\\begin{theorem}\n  \n\\end{theorem}\n", true, [])[0]).toMatchObject({
      type: "theorem",
      attrs: { environment: "theorem" },
    });
    expect(latexToVisualContent("\\begin{observation}\n  \n\\end{observation}\n", true, ["observation"])[0]).toMatchObject({
      type: "theorem",
      attrs: { environment: "observation" },
    });
    expect(latexToVisualContent("\\begin{observation}\n  \n\\end{observation}\n", true, [])[0]).toMatchObject({
      type: "rawBlock",
    });
  });

  it("turns escaped characters into plain text that serializes back escaped", () => {
    expect(latexToVisualContent("\\#", false, [])).toEqual([{ type: "text", text: "#" }]);
  });
});

describe("insertLatexIntoVisualEditor", () => {
  it("inserts a footnote node and opens its editor", () => {
    const editor = mountAfterHello();
    insertLatexIntoVisualEditor(editor.view, "\\footnote{note text}", false, []);
    expect(serializeLatexBody(editor.getJSON())).toBe("Hello\\footnote{note text}\n");
    expect(editor.view.dom.querySelector('[data-footnote-editing="true"] textarea.footnote-input')).not.toBeNull();
  });

  it("inserts display math as a block with its source editor open", () => {
    const editor = mountAfterHello();
    insertLatexIntoVisualEditor(editor.view, "\\begin{equation}\n  \n\\end{equation}\n", true, []);
    expect(serializeLatexBody(editor.getJSON())).toBe("Hello\n\n\\begin{equation}\n  \n\\end{equation}\n");
    expect(
      editor.view.dom.querySelector('[data-type="math-display"][data-math-editing="true"] textarea.math-input'),
    ).not.toBeNull();
  });

  it("inserts inline math with its editor open and serializes it verbatim", () => {
    const editor = mountAfterHello();
    insertLatexIntoVisualEditor(editor.view, "$\\frac{numerator}{denominator}$", false, []);
    expect(serializeLatexBody(editor.getJSON())).toBe("Hello$\\frac{numerator}{denominator}$\n");
    expect(editor.view.dom.querySelector('[data-type="math-inline"][data-math-editing="true"] input.math-input')).not.toBeNull();
  });

  it("replaces an empty paragraph with a figure and focuses its caption", () => {
    const editor = mount("");
    insertLatexIntoVisualEditor(editor.view, FIGURE_TEMPLATE, true, []);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(["figure", "paragraph"]);
    expect(editor.state.selection.$from.parent.type.name).toBe("figureCaption");
    expect(serializeLatexBody(editor.getJSON())).toBe(
      "\\begin{figure}[h]\n    \\centering\n    \\includegraphics[width=0.8\\textwidth]{image-filename}\n    \\caption{Caption text}\n    \\label{fig:label}\n\\end{figure}\n",
    );
  });

  it("splits a paragraph around an inserted table and focuses the caption", () => {
    const editor = mount("<p>Hello</p>");
    editor.commands.setTextSelection(3);
    insertLatexIntoVisualEditor(editor.view, TABLE_TEMPLATE, true, []);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(["paragraph", "tableFloat", "paragraph"]);
    expect(editor.state.selection.$from.parent.type.name).toBe("tableCaption");
  });

  it("keeps raw nodes for unknown snippets and heading nodes for sectioning", () => {
    const editor = mountAfterHello();
    insertLatexIntoVisualEditor(editor.view, "\\alpha", false, []);
    expect(editor.getJSON().content?.[0].content?.[1]).toMatchObject({ type: "rawInline", attrs: { source: "\\alpha" } });
    insertLatexIntoVisualEditor(editor.view, "\\chapter{Chapter Title}\n", false, []);
    expect(serializeLatexBody(editor.getJSON())).toContain("\\chapter{Chapter Title}");
  });
});

describe("insertVisualFigure", () => {
  it("inserts a figure with a focused empty caption and a position after it", () => {
    const editor = mountAfterHello();
    insertVisualFigure(editor.view, {
      path: "figures/plot.png",
      width: "0.8\\linewidth",
      centering: true,
      caption: "",
      label: "fig:plot",
    });
    expect(editor.state.selection.$from.parent.type.name).toBe("figureCaption");
    expect(positionAfterEnclosing(editor.state, "figure")).toBe(editor.state.selection.$from.after(1));
    expect(serializeLatexBody(editor.getJSON())).toBe(
      "Hello\n\n\\begin{figure}[htbp]\n    \\centering\n    \\includegraphics[width=0.8\\linewidth]{figures/plot.png}\n    \\caption{}\n    \\label{fig:plot}\n\\end{figure}\n",
    );
  });

  it("returns null from positionAfterEnclosing outside the node type", () => {
    const editor = mountAfterHello();
    expect(positionAfterEnclosing(editor.state, "figure")).toBeNull();
  });
});
