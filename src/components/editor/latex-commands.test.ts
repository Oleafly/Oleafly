// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const controller = vi.hoisted(() => ({
  insertEnvironment: vi.fn(),
  insertTemplate: vi.fn(),
  wrapSelectionOrPlaceholder: vi.fn(),
}));

vi.mock("@/components/editor/cm/controller", () => controller);

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

describe("latex-commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFigureDialogStore.setState({ open: false, edit: null });
    useFilesStore.setState({ mainDoc: "main.tex" } as never);
  });

  it("writes LaTeX into the document for every formatting command", () => {
    insertBold();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("\\textbf{", "}", "text");
    insertItalic();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("\\textit{", "}", "text");
    insertCode();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("\\texttt{", "}", "text");
    insertUnderline();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("\\underline{", "}", "text");
    insertFootnote();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("\\footnote{", "}", "note text");
    insertRef();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("\\ref{", "}", "label");
  });

  it("writes every sectioning command as source", () => {
    for (const cmd of ["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"]) {
      const level = headingLevel(cmd);
      insertHeading(level);
      expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith(
        `\\${cmd}{`,
        "}\n",
        level.placeholder,
      );
    }
  });

  it("puts the caret inside the first placeholder of a template", () => {
    insertLink();
    expect(controller.insertTemplate).toHaveBeenLastCalledWith("\\href{url}{link text}", 6, 9);
    insertFraction();
    expect(controller.insertTemplate).toHaveBeenLastCalledWith("\\frac{numerator}{denominator}", 6, 15);
  });

  it("inserts list and math environments as source", () => {
    insertAlign();
    expect(controller.insertEnvironment).toHaveBeenLastCalledWith("align");
    insertEquation();
    expect(controller.insertEnvironment).toHaveBeenLastCalledWith("equation");
    insertBlockquote();
    expect(controller.insertEnvironment).toHaveBeenLastCalledWith("quote");

    insertItemize();
    let [template, start, end] = controller.insertTemplate.mock.lastCall as [string, number, number];
    expect(template).toContain("\\begin{itemize}");
    expect(template.slice(0, start)).toMatch(/\\item $/u);
    expect(end).toBe(start);

    insertEnumerate();
    [template, start, end] = controller.insertTemplate.mock.lastCall as [string, number, number];
    expect(template).toContain("\\begin{enumerate}");
    expect(template.slice(0, start)).toMatch(/\\item $/u);
  });

  it("opens the figure dialog from the toolbar command and keeps the placeholder snippet", () => {
    insertFigure();
    expect(useFigureDialogStore.getState().open).toBe(true);
    expect(useFigureDialogStore.getState().edit).toBeNull();
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

  it("rewrites the dialog figure path relative to the main document", () => {
    useFilesStore.setState({ mainDoc: "src/main.tex" } as never);
    insertFigureFromDialog({ path: "figures/plot.png", width: "\\linewidth", caption: "Growth", label: "fig:plot" });
    const [template] = controller.insertTemplate.mock.lastCall as [string, number, number];
    expect(template).toContain("\\includegraphics[width=\\linewidth]{../figures/plot.png}");
    expect(template).toContain("\\label{fig:plot}");
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
