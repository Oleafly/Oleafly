// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { createWysiwygExtensions, serializeLatexBody } from "@oleafly/wysiwyg";

const controller = vi.hoisted(() => ({
  insertEnvironment: vi.fn(),
  insertTemplate: vi.fn(),
  wrapSelectionOrPlaceholder: vi.fn(),
}));

vi.mock("@/components/editor/cm/controller", () => controller);

import {
  setWysiwygDocumentContext,
  setWysiwygEditor,
  setWysiwygInsertions,
  setWysiwygVisible,
} from "@/components/editor/wysiwyg/controller";
import { visualInsertions } from "@/components/editor/wysiwyg/insert";
import { useFigureDialogStore } from "@/store/figure-dialog";
import { useFilesStore } from "@/store/files";
import {
  figureSnippet,
  HEADING_LEVELS,
  insertAlign,
  insertBlockquote,
  insertBold,
  insertCode,
  insertEnumerate,
  insertEquation,
  insertFigure,
  insertFigureFromDialog,
  insertFigurePlaceholder,
  insertFootnote,
  insertFraction,
  insertHeading,
  insertItalic,
  insertItemize,
  insertLink,
  insertRef,
  insertTable,
  insertUnderline,
} from "./latex-commands";

function headingLevel(cmd: string) {
  const level = HEADING_LEVELS.find((l) => l.cmd === cmd);
  if (!level) throw new Error(`no heading level for ${cmd}`);
  return level;
}

let editors: Editor[] = [];

function activateVisualEditor(content = "<p>Hello</p>"): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: createWysiwygExtensions(),
    content,
    editorProps: { handleScrollToSelection: () => true },
  });
  editors.push(editor);
  editor.commands.setTextSelection(6);
  setWysiwygEditor(editor as never);
  setWysiwygInsertions(visualInsertions);
  setWysiwygVisible(true);
  return editor;
}

function latexOf(editor: Editor): string {
  return serializeLatexBody(editor.getJSON());
}

describe("latex-commands wysiwyg native routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWysiwygEditor(null);
    setWysiwygInsertions(null);
    setWysiwygVisible(false);
    setWysiwygDocumentContext(null);
    useFigureDialogStore.setState({ open: false });
    useFilesStore.setState({ mainDoc: "main.tex" } as never);
  });

  afterEach(() => {
    for (const editor of editors) editor.destroy();
    editors = [];
    document.body.replaceChildren();
  });

  it("falls back to the LaTeX text path when wysiwyg is not active", () => {
    insertBold();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("\\textbf{", "}", "text");
    insertHeading(headingLevel("part"));
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("\\part{", "}\n", "Part Title");
    insertFraction();
    expect(controller.insertTemplate).toHaveBeenLastCalledWith("\\frac{numerator}{denominator}", 6, 15);
  });

  it("toggles the native bold/italic/code marks when wysiwyg is active", () => {
    const editor = activateVisualEditor();
    editor.commands.setTextSelection({ from: 1, to: 6 });
    insertBold();
    insertItalic();
    expect(latexOf(editor)).toBe("\\textbf{\\textit{Hello}}\n");
    insertCode();
    expect(latexOf(editor)).toBe("\\texttt{Hello}\n");
    expect(controller.wrapSelectionOrPlaceholder).not.toHaveBeenCalled();
  });

  it("sets every sectioning command as a native heading and toggles it back off", () => {
    const editor = activateVisualEditor();
    for (const cmd of ["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"]) {
      insertHeading(headingLevel(cmd));
      expect(latexOf(editor)).toBe(`\\${cmd}{Hello}\n`);
    }
    insertHeading(headingLevel("subparagraph"));
    expect(latexOf(editor)).toBe("Hello\n");
    expect(controller.wrapSelectionOrPlaceholder).not.toHaveBeenCalled();
  });

  it("switches a part heading to a section without going through raw text", () => {
    const editor = activateVisualEditor("<h1 data-command=\"part\">Hello</h1>");
    insertHeading(headingLevel("section"));
    expect(latexOf(editor)).toBe("\\section{Hello}\n");
  });

  it("toggles native lists and blockquote", () => {
    const editor = activateVisualEditor();
    insertItemize();
    expect(latexOf(editor)).toContain("\\begin{itemize}");
    insertItemize();
    insertEnumerate();
    expect(latexOf(editor)).toContain("\\begin{enumerate}");
    insertEnumerate();
    insertBlockquote();
    expect(latexOf(editor)).toContain("\\begin{quote}");
    expect(controller.insertEnvironment).not.toHaveBeenCalled();
  });

  it("routes wrap and template commands through the visual inserter", () => {
    activateVisualEditor();
    insertUnderline();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("\\underline{", "}", "text");
    insertFootnote();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("\\footnote{", "}", "note text");
    insertRef();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("\\ref{", "}", "label");
    insertLink();
    expect(controller.insertTemplate).toHaveBeenLastCalledWith("\\href{url}{link text}", 6, 9);
    insertFraction();
    expect(controller.insertTemplate).toHaveBeenLastCalledWith("$\\frac{numerator}{denominator}$", 0, 0);
    insertAlign();
    expect(controller.insertEnvironment).toHaveBeenLastCalledWith("align");
    insertEquation();
    expect(controller.insertEnvironment).toHaveBeenLastCalledWith("equation");
  });

  it("opens the figure dialog from the toolbar command and keeps the placeholder snippet", () => {
    insertFigure();
    expect(useFigureDialogStore.getState().open).toBe(true);
    expect(controller.insertTemplate).not.toHaveBeenCalled();
    insertFigurePlaceholder();
    const [template, start, end] = controller.insertTemplate.mock.lastCall as [string, number, number];
    expect(template).toBe(
      "\\begin{figure}[h]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{image-filename}\n  \\caption{Caption text}\n  \\label{fig:label}\n\\end{figure}\n",
    );
    expect(template.slice(start, end)).toBe("image-filename");
  });

  it("builds figure snippets with the caret in the caption", () => {
    const snippet = figureSnippet({ path: "figures/plot.png", width: "0.8\\linewidth", caption: "", label: "fig:plot" });
    expect(snippet.template).toBe(
      "\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{figures/plot.png}\n  \\caption{}\n  \\label{fig:plot}\n\\end{figure}\n",
    );
    expect(snippet.template.slice(0, snippet.selStart)).toMatch(/\\caption\{$/u);
    expect(snippet.selEnd).toBe(snippet.selStart);
    const titled = figureSnippet({ path: "a.png", caption: "Growth" });
    expect(titled.template).toBe("\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics{a.png}\n  \\caption{Growth}\n\\end{figure}\n");
    expect(titled.template.slice(titled.selStart, titled.selEnd)).toBe("Growth");
    const bare = figureSnippet({ path: "a.png", width: null, caption: null, label: null });
    expect(bare.template).toBe("\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics{a.png}\n\\end{figure}\n");
    expect(bare.selStart).toBe(bare.template.length);
  });

  it("inserts dialog figures as snippets in Source mode and as nodes in Visual mode", () => {
    useFilesStore.setState({ mainDoc: "src/main.tex" } as never);
    insertFigureFromDialog({ path: "figures/plot.png", width: "\\linewidth", caption: "Growth", label: "fig:plot" });
    const [template] = controller.insertTemplate.mock.lastCall as [string, number, number];
    expect(template).toContain("\\includegraphics[width=\\linewidth]{../figures/plot.png}");
    expect(template).toContain("\\label{fig:plot}");

    const editor = activateVisualEditor();
    insertFigureFromDialog({ path: "src/figures/b.png", width: null, caption: null, label: null });
    expect(latexOf(editor)).toBe(
      "Hello\n\n\\begin{figure}[htbp]\n    \\centering\n    \\includegraphics{figures/b.png}\n\\end{figure}\n",
    );
    expect(controller.insertTemplate).toHaveBeenCalledTimes(1);
  });

  it("inserts native tables in Visual mode using booktabs only when the preamble loads it", () => {
    const editor = activateVisualEditor();
    insertTable(2, 3);
    expect(latexOf(editor)).toContain("\\begin{tabular}{lll}");
    expect(latexOf(editor)).toContain("\\hline");
    expect(editor.state.selection.$from.parent.type.name).toBe("tableCaption");
    setWysiwygDocumentContext({ theoremEnvironments: [], booktabs: true });
    insertTable(1, 1);
    expect(latexOf(editor)).toContain("\\toprule");
    expect(controller.insertTemplate).not.toHaveBeenCalled();
  });

  it("generates every 1..8 by 1..10 toolbar table without changing its dimensions", () => {
    for (let rows = 1; rows <= 8; rows++) {
      for (let columns = 1; columns <= 10; columns++) {
        insertTable(rows, columns);
        const call = controller.insertTemplate.mock.lastCall;
        expect(call).toBeDefined();
        const [template, selectionStart, selectionEnd] = call as [
          string,
          number,
          number,
        ];
        expect(template).toContain(
          `\\begin{tabular}{${"l".repeat(columns)}}`,
        );
        const body =
          template.match(
            /\\begin\{tabular\}\{l+\}\n([\s\S]*?)\n {2}\\end\{tabular\}/,
          )?.[1] ?? "";
        const tableRows = body.split("\n");
        expect(tableRows).toHaveLength(rows);
        for (const row of tableRows) {
          expect(row.match(/&/g) ?? []).toHaveLength(columns - 1);
          expect(row.trimEnd().endsWith("\\\\")).toBe(true);
        }
        expect(template.slice(selectionStart, selectionEnd)).toBe("");
        expect(template.slice(0, selectionStart)).toMatch(/\\caption\{$/u);
      }
    }
    expect(controller.insertTemplate).toHaveBeenCalledTimes(80);
  });
});
