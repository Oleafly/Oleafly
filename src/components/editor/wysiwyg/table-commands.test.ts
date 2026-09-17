// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { createTableFloat, createWysiwygExtensions, parseLatexBody, serializeLatexBody } from "@oleafly/wysiwyg";
import { insertVisualTable } from "./insert";
import {
  applyBorderPreset,
  borderPlan,
  canMergeCells,
  canSplitCell,
  currentCaptionPlacement,
  currentColumnAlignment,
  deleteColumn,
  deleteRow,
  deleteTableFloat,
  hasHeaderRow,
  inferBorderPreset,
  insertColumn,
  insertRow,
  mergeCells,
  setCaptionPlacement,
  setColumnAlignment,
  setTableLabel,
  splitCell,
  tableFloatContext,
  tableFloatPosition,
  toggleHeaderRow,
  withBorderPreset,
  type BorderPreset,
} from "./table-commands";

let editors: Editor[] = [];

function mount(content: string): Editor {
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

function mountTable(rows = 2, cols = 2, preset: BorderPreset = "horizontal"): Editor {
  const editor = mount("<p>Before</p>");
  editor.commands.setTextSelection(7);
  insertVisualTable(editor.view, rows, cols, preset);
  return editor;
}

function cellPositions(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") positions.push(pos);
    return true;
  });
  return positions;
}

function selectCell(editor: Editor, index: number): void {
  editor.commands.setTextSelection(cellPositions(editor)[index] + 2);
}

function contextOf(editor: Editor) {
  const context = tableFloatContext(editor.state);
  if (!context) throw new Error("selection is not inside a table");
  return context;
}

function latexOf(editor: Editor): string {
  const latex = serializeLatexBody(editor.getJSON());
  expect(parseLatexBody(latex).content?.[1]).toMatchObject({ type: "tableFloat" });
  return latex;
}

function tabularOf(editor: Editor): string {
  const latex = latexOf(editor);
  return latex.slice(latex.indexOf("\\begin{tabular}"), latex.indexOf("\\end{tabular}"));
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  document.body.replaceChildren();
});

describe("tableFloatContext", () => {
  it("finds the enclosing float from a cell and reports nothing outside", () => {
    const editor = mountTable();
    selectCell(editor, 0);
    const context = tableFloatContext(editor.state);
    expect(context?.floatPos).toBe(8);
    expect(tableFloatPosition(editor.state)).toBe(8);
    editor.commands.setTextSelection(2);
    expect(tableFloatContext(editor.state)).toBeNull();
    expect(currentColumnAlignment(editor.state)).toBeNull();
  });
});

describe("row and column commands", () => {
  it("inserts rows above and below while keeping the rules on the edges", () => {
    const editor = mountTable();
    selectCell(editor, 2);
    expect(insertRow(editor, "above")).toBe(true);
    expect(insertRow(editor, "below")).toBe(true);
    const tabular = tabularOf(editor);
    expect(tabular.match(/\\\\/gu)).toHaveLength(4);
    expect(tabular.match(/\\hline/gu)).toHaveLength(3);
    expect(tabular).toMatch(/^\\begin\{tabular\}\{ll\}\n\s+\\hline\n/u);
    expect(tabular).toMatch(/\\\\\n\s+\\hline\n\s*$/u);
  });

  it("inserts columns left and right and grows the column spec", () => {
    const editor = mountTable();
    selectCell(editor, 3);
    expect(insertColumn(editor, "left")).toBe(true);
    expect(insertColumn(editor, "right")).toBe(true);
    const tabular = tabularOf(editor);
    expect(tabular).toContain("\\begin{tabular}{llll}");
    for (const row of tabular.split("\n").filter((line) => line.includes("\\\\"))) {
      expect(row.match(/&/gu)).toHaveLength(3);
    }
  });

  it("deletes rows and columns and shrinks the column spec", () => {
    const editor = mountTable(3, 3);
    selectCell(editor, 4);
    expect(deleteRow(editor)).toBe(true);
    expect(deleteColumn(editor)).toBe(true);
    const tabular = tabularOf(editor);
    expect(tabular).toContain("\\begin{tabular}{ll}");
    expect(tabular.match(/\\\\/gu)).toHaveLength(2);
  });

  it("refuses to delete the last row or column", () => {
    const editor = mountTable(1, 1);
    selectCell(editor, 0);
    expect(deleteRow(editor)).toBe(false);
    expect(deleteColumn(editor)).toBe(false);
    expect(tabularOf(editor)).toContain("\\begin{tabular}{l}");
  });

  it("deletes the whole float", () => {
    const editor = mountTable();
    selectCell(editor, 0);
    expect(deleteTableFloat(editor)).toBe(true);
    expect(serializeLatexBody(editor.getJSON())).toBe("Before\n");
  });
});

describe("alignment and borders", () => {
  it("sets the alignment of the current column", () => {
    const editor = mountTable();
    selectCell(editor, 1);
    expect(currentColumnAlignment(editor.state)).toBe("l");
    expect(setColumnAlignment(editor, "c")).toBe(true);
    expect(currentColumnAlignment(editor.state)).toBe("c");
    expect(tabularOf(editor)).toContain("\\begin{tabular}{lc}");
    selectCell(editor, 0);
    setColumnAlignment(editor, "r");
    expect(tabularOf(editor)).toContain("\\begin{tabular}{rc}");
  });

  it("applies every border preset and infers it back", () => {
    const editor = mountTable(3, 2);
    selectCell(editor, 0);
    const expectations: Record<BorderPreset, (tabular: string) => void> = {
      booktabs: (tabular) => {
        expect(tabular).toContain("\\toprule");
        expect(tabular).toContain("\\midrule");
        expect(tabular).toContain("\\bottomrule");
        expect(tabular).not.toContain("|");
      },
      all: (tabular) => {
        expect(tabular).toContain("\\begin{tabular}{|l|l|}");
        expect(tabular.match(/\\hline/gu)).toHaveLength(4);
      },
      none: (tabular) => {
        expect(tabular).not.toMatch(/\\(?:hline|toprule|midrule|bottomrule)/u);
        expect(tabular).toContain("\\begin{tabular}{ll}");
      },
      horizontal: (tabular) => {
        expect(tabular.match(/\\hline/gu)).toHaveLength(3);
        expect(tabular).not.toContain("|");
      },
    };
    for (const preset of ["booktabs", "all", "none", "horizontal"] as const) {
      expect(applyBorderPreset(editor, preset)).toBe(true);
      expectations[preset](tabularOf(editor));
      const context = tableFloatContext(editor.state);
      expect(context && inferBorderPreset(context.float)).toBe(preset);
    }
  });

  it("plans rules for single-row and headerless tables", () => {
    expect(borderPlan("booktabs", 1, true, []).rows).toEqual([{ borderTop: "toprule", borderBottom: "bottomrule" }]);
    expect(borderPlan("horizontal", 2, false, []).rows).toEqual([
      { borderTop: "hline", borderBottom: null },
      { borderTop: null, borderBottom: "hline" },
    ]);
    const float = withBorderPreset(createTableFloat(2, 2), "none");
    expect(float.content?.[0].content?.map((row) => row.attrs)).toEqual([
      { borderTop: null, borderBottom: null },
      { borderTop: null, borderBottom: null },
    ]);
  });
});

describe("caption, label and header row", () => {
  it("keeps the inserted caption through row, column and border edits", () => {
    const editor = mountTable();
    selectCell(editor, 0);
    expect(insertRow(editor, "below")).toBe(true);
    selectCell(editor, 0);
    expect(insertColumn(editor, "right")).toBe(true);
    selectCell(editor, 0);
    expect(applyBorderPreset(editor, "booktabs")).toBe(true);
    expect(currentCaptionPlacement(contextOf(editor).float)).not.toBe("none");
    expect(editor.view.dom.querySelector('[data-type="table-caption"]')).not.toBeNull();
    expect(serializeLatexBody(editor.getJSON())).toContain("\\caption{}");
  });


  it("moves the caption below, removes it and adds it back above", () => {
    const editor = mountTable();
    selectCell(editor, 0);
    expect(currentCaptionPlacement(contextOf(editor).float)).toBe("above");
    expect(setCaptionPlacement(editor, "below")).toBe(true);
    let latex = latexOf(editor);
    expect(latex.indexOf("\\caption{}")).toBeGreaterThan(latex.indexOf("\\end{tabular}"));
    selectCell(editor, 0);
    expect(setCaptionPlacement(editor, "none")).toBe(true);
    expect(latexOf(editor)).not.toContain("\\caption");
    selectCell(editor, 0);
    expect(setCaptionPlacement(editor, "above")).toBe(true);
    expect(editor.state.selection.$from.parent.type.name).toBe("tableCaption");
    latex = latexOf(editor);
    expect(latex.indexOf("\\caption{}")).toBeLessThan(latex.indexOf("\\begin{tabular}"));
  });

  it("writes and clears the label", () => {
    const editor = mountTable();
    selectCell(editor, 0);
    expect(setTableLabel(editor, " tab:results ")).toBe(true);
    expect(latexOf(editor)).toContain("\\label{tab:results}");
    setTableLabel(editor, "");
    expect(latexOf(editor)).not.toContain("\\label");
  });

  it("toggles the header row and re-rules booktabs tables accordingly", () => {
    const editor = mountTable(2, 2, "booktabs");
    selectCell(editor, 0);
    const table = () => contextOf(editor).table;
    expect(hasHeaderRow(table())).toBe(true);
    expect(toggleHeaderRow(editor)).toBe(true);
    expect(hasHeaderRow(table())).toBe(false);
    expect(tabularOf(editor)).not.toContain("\\midrule");
    expect(toggleHeaderRow(editor)).toBe(true);
    expect(tabularOf(editor)).toContain("\\midrule");
  });
});

describe("merge and split", () => {
  it("merges two cells into a multicolumn and splits them again", () => {
    const editor = mountTable(2, 2);
    const [, , third, fourth] = cellPositions(editor);
    editor.view.dispatch(
      editor.state.tr.setSelection(CellSelection.create(editor.state.doc, third, fourth)),
    );
    expect(canMergeCells(editor)).toBe(true);
    expect(mergeCells(editor)).toBe(true);
    expect(tabularOf(editor)).toContain("\\multicolumn{2}{ll}{}");
    selectCell(editor, 2);
    expect(canSplitCell(editor)).toBe(true);
    expect(splitCell(editor)).toBe(true);
    expect(tabularOf(editor)).not.toContain("\\multicolumn");
    expect(canSplitCell(editor)).toBe(false);
  });
});
