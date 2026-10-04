// @vitest-environment jsdom

import { history } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { latexLanguage } from "codemirror-lang-latex";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTabularDecoration } from "./decoration";
import { tableTheme } from "./theme";

const DOC = `Intro text.
\\begin{table}
\\centering
\\begin{tabular}{lcr}
A & B & C \\\\
1 & 2 & 3 \\\\
\\end{tabular}
\\caption{Cap}
\\end{table}
Outro text.
`;

function decorate(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  (ensureSyntaxTree(state, state.doc.length, 5_000) ?? syntaxTree(state)).iterate({
    enter(ref) {
      if (ref.type.is("TabularEnvironment")) {
        ranges.push(...createTabularDecoration(ref, state));
        return false;
      }
      return undefined;
    },
  });
  return Decoration.set(ranges, true);
}

const tableField = StateField.define<DecorationSet>({
  create: decorate,
  update: (value, transaction) => (transaction.docChanged || transaction.selection ? decorate(transaction.state) : value),
  provide: (field) => EditorView.decorations.from(field),
});

let view: EditorView | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!globalThis.Range.prototype.getClientRects) {
    Object.defineProperty(globalThis.Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [],
    });
  }
});

afterEach(async () => {
  await act(async () => {
    view?.destroy();
  });
  view = null;
  document.body.innerHTML = "";
});

async function mount(doc = DOC, readOnly = false): Promise<EditorView> {
  await act(async () => {
    view?.destroy();
  });
  const editor = await act(async () => {
    return new EditorView({
      state: EditorState.create({
        doc,
        extensions: [latexLanguage, tableField, tableTheme, history(), EditorState.readOnly.of(readOnly)],
      }),
      parent: document.body,
    });
  });
  view = editor;
  return editor;
}

function grid(editor: EditorView): HTMLTableElement {
  const element = editor.dom.querySelector<HTMLTableElement>(".ofl-visual-table-grid");
  if (!element) throw new Error("The table grid is not rendered");
  return element;
}

function cells(editor: EditorView): HTMLElement[] {
  return Array.from(grid(editor).querySelectorAll<HTMLElement>(".ofl-visual-table-cell"));
}

function selectedTexts(editor: EditorView): string[] {
  return Array.from(grid(editor).querySelectorAll(".ofl-visual-table-cell-selected"), (cell) => cell.textContent ?? "");
}

function selectCell(editor: EditorView, index: number): void {
  fireEvent.mouseDown(cells(editor)[index], { button: 0 });
  fireEvent.mouseUp(cells(editor)[index], { button: 0 });
}

function selectColumn(editor: EditorView, index: number): void {
  fireEvent.mouseDown(grid(editor).querySelectorAll(".ofl-visual-table-handle-column")[index], { button: 0 });
}

function selectRow(editor: EditorView, index: number): void {
  fireEvent.mouseDown(grid(editor).querySelectorAll(".ofl-visual-table-handle-row")[index], { button: 0 });
}

function key(editor: EditorView, init: KeyboardEventInit): void {
  fireEvent.keyDown(grid(editor), init);
}

function control(label: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`[aria-label='${label}']`);
  if (!element) throw new Error(`No control labelled ${label}`);
  return element;
}

function menuItem(label: string): HTMLButtonElement {
  const item = Array.from(document.querySelectorAll<HTMLButtonElement>(".ofl-visual-table-menu-item")).find(
    (candidate) => candidate.textContent === label,
  );
  if (!item) throw new Error(`No menu item ${label}`);
  return item;
}

function choose(menu: string, item: string): void {
  fireEvent.click(control(menu));
  fireEvent.click(menuItem(item));
}

function tabular(editor: EditorView): string {
  const doc = editor.state.doc.toString();
  const start = doc.indexOf("\\begin{tabular}");
  const end = doc.indexOf("\\end{tabular}") + "\\end{tabular}".length;
  return doc.slice(start, end);
}

describe("keyboard navigation in the table grid", () => {
  it("selects the first cell when an arrow or Tab is pressed without a selection", async () => {
    const editor = await mount();
    key(editor, { key: "ArrowDown" });
    expect(selectedTexts(editor)).toEqual(["A"]);
    fireEvent.keyDown(grid(editor), { key: "Escape" });
    expect(selectedTexts(editor)).toEqual([]);
    key(editor, { key: "Tab" });
    expect(selectedTexts(editor)).toEqual(["A"]);
  });

  it("moves and extends the selection with the arrow keys", async () => {
    const editor = await mount();
    selectCell(editor, 0);
    key(editor, { key: "ArrowRight" });
    expect(selectedTexts(editor)).toEqual(["B"]);
    key(editor, { key: "ArrowDown" });
    expect(selectedTexts(editor)).toEqual(["2"]);
    key(editor, { key: "ArrowLeft" });
    expect(selectedTexts(editor)).toEqual(["1"]);
    key(editor, { key: "ArrowUp" });
    expect(selectedTexts(editor)).toEqual(["A"]);
    key(editor, { key: "ArrowRight", shiftKey: true });
    expect(selectedTexts(editor)).toEqual(["A", "B"]);
    key(editor, { key: "ArrowDown", shiftKey: true });
    expect(selectedTexts(editor)).toEqual(["A", "B", "1", "2"]);
    key(editor, { key: "ArrowLeft", shiftKey: true });
    expect(selectedTexts(editor)).toEqual(["A", "1"]);
    key(editor, { key: "ArrowUp", shiftKey: true });
    expect(selectedTexts(editor)).toEqual(["A"]);
  });

  it("moves backwards with Shift+Tab, wrapping to the previous row", async () => {
    const editor = await mount();
    selectCell(editor, 3);
    key(editor, { key: "Tab", shiftKey: true });
    expect(selectedTexts(editor)).toEqual(["C"]);
    key(editor, { key: "Tab", shiftKey: true });
    expect(selectedTexts(editor)).toEqual(["B"]);
  });

  it("commits the edited cell when moving with Tab or Shift+Tab", async () => {
    const editor = await mount();
    selectCell(editor, 1);
    key(editor, { key: "Enter" });
    fireEvent.input(editor.dom.querySelector(".ofl-visual-table-cell-input")!, { target: { value: "Bee" } });
    key(editor, { key: "Tab" });
    expect(editor.state.doc.toString()).toContain("A & Bee & C");
    expect(selectedTexts(editor)).toEqual(["C"]);
    key(editor, { key: "Enter" });
    fireEvent.input(editor.dom.querySelector(".ofl-visual-table-cell-input")!, { target: { value: "Sea" } });
    key(editor, { key: "Tab", shiftKey: true });
    expect(editor.state.doc.toString()).toContain("A & Bee & Sea");
    expect(selectedTexts(editor)).toEqual(["Bee"]);
  });

  it("cancels an edit with Escape and keeps the cell selected", async () => {
    const editor = await mount();
    selectCell(editor, 0);
    key(editor, { key: "Enter" });
    fireEvent.input(editor.dom.querySelector(".ofl-visual-table-cell-input")!, { target: { value: "changed" } });
    key(editor, { key: "Escape" });
    expect(editor.dom.querySelector(".ofl-visual-table-cell-input")).toBeNull();
    expect(editor.state.doc.toString()).toBe(DOC);
    expect(selectedTexts(editor)).toEqual(["A"]);
  });

  it("starts editing with the typed character and ignores modified keys", async () => {
    const editor = await mount();
    selectCell(editor, 2);
    key(editor, { key: "x", altKey: true });
    expect(editor.dom.querySelector(".ofl-visual-table-cell-input")).toBeNull();
    key(editor, { key: "q", ctrlKey: true });
    expect(editor.dom.querySelector(".ofl-visual-table-cell-input")).toBeNull();
    key(editor, { key: "x" });
    const input = editor.dom.querySelector<HTMLTextAreaElement>(".ofl-visual-table-cell-input");
    expect(input?.value).toBe("x");
    key(editor, { key: "ArrowLeft" });
    expect(editor.dom.querySelector(".ofl-visual-table-cell-input")).toBe(input);
    key(editor, { key: "Enter" });
    expect(editor.state.doc.toString()).toContain("A & B & x \\\\");
  });

  it("clears the selected cells with Delete and Backspace", async () => {
    const editor = await mount();
    selectRow(editor, 1);
    key(editor, { key: "Delete" });
    expect(tabular(editor)).toContain("A & B & C \\\\\n &  &  \\\\");
    selectCell(editor, 0);
    key(editor, { key: "Backspace" });
    expect(tabular(editor)).toContain(" & B & C \\\\");
  });

  it("selects every cell with Ctrl+A and undoes and redoes with Ctrl+Z and Ctrl+Y", async () => {
    const editor = await mount();
    selectCell(editor, 4);
    key(editor, { key: "a", ctrlKey: true });
    expect(selectedTexts(editor)).toEqual(["A", "B", "C", "1", "2", "3"]);
    key(editor, { key: "Delete" });
    expect(tabular(editor)).not.toContain("A & B");
    await act(async () => key(editor, { key: "z", ctrlKey: true }));
    expect(editor.state.doc.toString()).toBe(DOC);
    selectCell(editor, 0);
    await act(async () => key(editor, { key: "y", ctrlKey: true }));
    expect(tabular(editor)).not.toContain("A & B");
    selectCell(editor, 0);
    await act(async () => key(editor, { key: "z", ctrlKey: true }));
    expect(editor.state.doc.toString()).toBe(DOC);
    selectCell(editor, 0);
    await act(async () => key(editor, { key: "Z", ctrlKey: true, shiftKey: true }));
    expect(tabular(editor)).not.toContain("A & B");
  });

  it("ignores keys in a read-only document and hides the toolbar", async () => {
    const editor = await mount(DOC, true);
    selectCell(editor, 0);
    expect(editor.dom.querySelector(".ofl-visual-table-toolbar")).toBeNull();
    key(editor, { key: "Delete" });
    fireEvent.doubleClick(cells(editor)[0]);
    expect(editor.dom.querySelector(".ofl-visual-table-cell-input")).toBeNull();
    expect(editor.state.doc.toString()).toBe(DOC);
  });
});

describe("pointer interaction with cells", () => {
  it("extends the selection while dragging and stops when the button is released", async () => {
    const editor = await mount();
    fireEvent.mouseDown(cells(editor)[0], { button: 0 });
    fireEvent.mouseMove(cells(editor)[4], { buttons: 1 });
    expect(selectedTexts(editor)).toEqual(["A", "B", "1", "2"]);
    fireEvent.mouseMove(cells(editor)[4], { buttons: 1 });
    expect(selectedTexts(editor)).toEqual(["A", "B", "1", "2"]);
    fireEvent.mouseMove(cells(editor)[5], { buttons: 0 });
    fireEvent.mouseMove(cells(editor)[5], { buttons: 1 });
    expect(selectedTexts(editor)).toEqual(["A", "B", "1", "2"]);
  });

  it("ignores secondary buttons and edits a cell on double click", async () => {
    const editor = await mount();
    fireEvent.mouseDown(cells(editor)[0], { button: 2 });
    expect(selectedTexts(editor)).toEqual([]);
    fireEvent.doubleClick(cells(editor)[1]);
    const input = editor.dom.querySelector<HTMLTextAreaElement>(".ofl-visual-table-cell-input");
    expect(input?.value).toBe("B");
    fireEvent.mouseDown(input!, { button: 0 });
    fireEvent.input(input!, { target: { value: "Blur" } });
    fireEvent.blur(input!);
    expect(editor.state.doc.toString()).toContain("A & Blur & C");
  });

  it("commits the edit and clears the selection when clicking outside the table", async () => {
    const editor = await mount();
    selectCell(editor, 0);
    key(editor, { key: "Enter" });
    fireEvent.input(editor.dom.querySelector(".ofl-visual-table-cell-input")!, { target: { value: "Out" } });
    fireEvent.mouseDown(document.body);
    expect(editor.state.doc.toString()).toContain("Out & B & C");
    expect(selectedTexts(editor)).toEqual([]);
    fireEvent.mouseDown(document.body);
    expect(selectedTexts(editor)).toEqual([]);
  });

  it("starts a new edit after committing the cell being edited elsewhere", async () => {
    const editor = await mount();
    fireEvent.doubleClick(cells(editor)[0]);
    fireEvent.input(editor.dom.querySelector(".ofl-visual-table-cell-input")!, { target: { value: "First" } });
    fireEvent.doubleClick(cells(editor)[5]);
    expect(editor.state.doc.toString()).toContain("First & B & C");
    expect(editor.dom.querySelector<HTMLTextAreaElement>(".ofl-visual-table-cell-input")?.value).toBe("3");
  });
});

describe("table toolbar", () => {
  it("moves the caption above, below and removes it", async () => {
    const editor = await mount();
    selectCell(editor, 0);
    expect(control("visual.table.captionPlacement").textContent).toBe("visual.table.captionBelow");
    choose("visual.table.captionPlacement", "visual.table.captionAbove");
    const above = editor.state.doc.toString();
    expect(above.indexOf("\\caption{Cap}")).toBeLessThan(above.indexOf("\\begin{tabular}"));
    selectCell(editor, 0);
    choose("visual.table.captionPlacement", "visual.table.noCaption");
    expect(editor.state.doc.toString()).not.toContain("\\caption");
  });

  it("disables the caption menu for a bare tabular", async () => {
    const editor = await mount("Text\n\\begin{tabular}{ll}\nA & B \\\\\n\\end{tabular}\n");
    selectCell(editor, 0);
    const caption = control("visual.table.captionPlacement");
    expect(caption).toBeDisabled();
    expect(caption.title).toBe("visual.table.captionNeedsTable");
  });

  it("applies every border preset and reports custom borders", async () => {
    const editor = await mount();
    selectCell(editor, 0);
    expect(control("visual.table.borders").textContent).toBe("visual.table.noBorders");
    choose("visual.table.borders", "visual.table.allBorders");
    expect(tabular(editor)).toContain("{|l|c|r|}");
    expect(tabular(editor)).toContain("\\hline");
    selectCell(editor, 0);
    expect(control("visual.table.borders").textContent).toBe("visual.table.allBorders");
    choose("visual.table.borders", "visual.table.noBorders");
    expect(tabular(editor)).not.toContain("\\hline");
    const custom = await mount(DOC.replace("{lcr}", "{l|cr}"));
    selectCell(custom, 0);
    expect(control("visual.table.borders").textContent).toBe("visual.table.customBorders");
  });

  it("aligns a selected column and disables alignment for single cells", async () => {
    const editor = await mount();
    selectCell(editor, 0);
    expect(control("visual.table.alignment")).toBeDisabled();
    selectColumn(editor, 0);
    choose("visual.table.alignment", "visual.table.alignCenter");
    expect(tabular(editor)).toContain("{ccr}");
    selectColumn(editor, 0);
    choose("visual.table.alignment", "visual.table.alignRight");
    expect(tabular(editor)).toContain("{rcr}");
    selectColumn(editor, 0);
    choose("visual.table.alignment", "visual.table.alignLeft");
    expect(tabular(editor)).toContain("{lcr}");
  });

  it("offers justification only for paragraph columns", async () => {
    const editor = await mount(DOC.replace("{lcr}", "{p{3cm}cr}"));
    selectColumn(editor, 0);
    fireEvent.click(control("visual.table.alignment"));
    fireEvent.click(menuItem("visual.table.alignJustify"));
    expect(tabular(editor)).toContain("p{3cm}");
    selectColumn(editor, 1);
    fireEvent.click(control("visual.table.alignment"));
    expect(document.querySelectorAll(".ofl-visual-table-menu-item")).toHaveLength(3);
  });

  it("removes a fixed column width and opens the width dialog from the menu", async () => {
    const editor = await mount(DOC.replace("{lcr}", "{p{3cm}cr}"));
    selectColumn(editor, 0);
    choose("visual.table.columnWidth", "visual.table.fitToContent");
    expect(tabular(editor)).toContain("{lcr}");
    selectColumn(editor, 0);
    choose("visual.table.columnWidth", "visual.table.fixedWidth");
    expect(document.querySelector("dialog")?.getAttribute("aria-label")).toBe("visual.table.setColumnWidth");
  });

  it("opens the width dialog from the set-width item of a paragraph column", async () => {
    const editor = await mount(DOC.replace("{lcr}", "{p{3cm}cr}"));
    selectColumn(editor, 0);
    choose("visual.table.columnWidth", "visual.table.setColumnWidth");
    expect(document.querySelector("dialog")).not.toBeNull();
  });

  it("merges and unmerges cells", async () => {
    const editor = await mount();
    selectCell(editor, 0);
    expect(control("visual.table.mergeCells")).toBeDisabled();
    fireEvent.mouseDown(cells(editor)[1], { button: 0, shiftKey: true });
    fireEvent.click(control("visual.table.mergeCells"));
    expect(tabular(editor)).toContain("\\multicolumn{2}{c}{A B} & C");
    selectCell(editor, 0);
    expect(control("visual.table.unmergeCells")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(control("visual.table.unmergeCells"));
    expect(tabular(editor)).not.toContain("\\multicolumn");
  });

  it("deletes a selected row or column", async () => {
    const editor = await mount();
    selectCell(editor, 0);
    expect(control("visual.table.deleteRowOrColumn")).toBeDisabled();
    selectRow(editor, 0);
    fireEvent.click(control("visual.table.deleteRowOrColumn"));
    expect(tabular(editor)).not.toContain("A & B & C");
    selectColumn(editor, 2);
    fireEvent.click(control("visual.table.deleteRowOrColumn"));
    expect(tabular(editor)).toContain("{lc}");
  });

  it("inserts columns and rows on every side", async () => {
    const editor = await mount();
    selectCell(editor, 0);
    choose("visual.table.insert", "visual.table.insertColumnsLeft");
    expect(tabular(editor)).toContain("{llcr}");
    choose("visual.table.insert", "visual.table.insertColumnsRight");
    expect(tabular(editor)).toContain("{lllcr}");
    choose("visual.table.insert", "visual.table.insertRowsAbove");
    choose("visual.table.insert", "visual.table.insertRowsBelow");
    expect(cells(editor)).toHaveLength(30);
  });

  it("removes the whole table", async () => {
    const editor = await mount();
    selectCell(editor, 0);
    fireEvent.click(control("visual.table.removeTable"));
    expect(editor.state.doc.toString()).toBe("Intro text.\nOutro text.\n");
  });

  it("closes an open menu with Escape or a click outside it", async () => {
    const editor = await mount();
    selectCell(editor, 0);
    fireEvent.click(control("visual.table.insert"));
    expect(document.querySelector("[role='menu']")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(document.querySelector("[role='menu']")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector("[role='menu']")).toBeNull();
    fireEvent.click(control("visual.table.insert"));
    fireEvent.mouseDown(document.querySelector("[role='menu']")!);
    expect(document.querySelector("[role='menu']")).not.toBeNull();
    fireEvent.mouseDown(cells(editor)[3], { button: 0 });
    expect(document.querySelector("[role='menu']")).toBeNull();
    fireEvent.click(control("visual.table.insert"));
    fireEvent.click(control("visual.table.insert"));
    expect(document.querySelector("[role='menu']")).toBeNull();
  });
});

describe("table dialogs", () => {
  it("shows the help dialog and closes it with its button", async () => {
    const editor = await mount();
    selectCell(editor, 0);
    fireEvent.click(control("visual.table.help"));
    const dialog = document.querySelector("dialog");
    expect(dialog?.getAttribute("aria-label")).toBe("visual.table.helpTitle");
    expect(dialog?.textContent).toContain("visual.table.shortcutUndo");
    expect(document.querySelector("[data-ofl-visual-table-dialog]")?.className).toBe(editor.themeClasses);
    fireEvent.mouseDown(dialog!);
    expect(selectedTexts(editor)).toEqual(["A"]);
    fireEvent.click(Array.from(dialog!.querySelectorAll("button")).at(-1)!);
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("closes a dialog with Escape or the backdrop and ignores other keys", async () => {
    const editor = await mount();
    selectCell(editor, 0);
    fireEvent.click(control("visual.table.help"));
    fireEvent.keyDown(document, { key: "a" });
    expect(document.querySelector("dialog")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector("dialog")).toBeNull();
    fireEvent.click(control("visual.table.help"));
    fireEvent.mouseDown(control("visual.table.close"));
    expect(document.querySelector("dialog")).toBeNull();
  });

  async function openWidthDialog(spec: string, column = 0): Promise<EditorView> {
    const editor = await mount(DOC.replace("{lcr}", spec));
    selectColumn(editor, column);
    choose("visual.table.columnWidth", "visual.table.fixedWidth");
    return editor;
  }

  function widthInputs(): { value: HTMLInputElement; unit: HTMLSelectElement; form: HTMLFormElement } {
    const dialog = document.querySelector("dialog");
    return {
      value: dialog!.querySelector<HTMLInputElement>("input")!,
      unit: dialog!.querySelector<HTMLSelectElement>("select")!,
      form: dialog!.querySelector<HTMLFormElement>("form")!,
    };
  }

  it("starts empty in percent for a plain column and writes a relative width", async () => {
    const editor = await openWidthDialog("{lcr}");
    const { value, unit, form } = widthInputs();
    expect([value.value, unit.value]).toEqual(["", "%"]);
    expect(document.querySelector("dialog")?.textContent).toContain("visual.table.widthPercentHelp");
    fireEvent.change(value, { target: { value: "40" } });
    fireEvent.submit(form);
    expect(tabular(editor)).toContain("p{0.4\\linewidth}");
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("prefills relative, absolute and custom widths", async () => {
    await openWidthDialog("{p{0.25\\textwidth}cr}");
    expect([widthInputs().value.value, widthInputs().unit.value]).toEqual(["25", "%"]);
    await openWidthDialog("{p{3cm}cr}");
    expect([widthInputs().value.value, widthInputs().unit.value]).toEqual(["3", "cm"]);
    await openWidthDialog("{p{\\mywidth}cr}");
    expect([widthInputs().value.value, widthInputs().unit.value]).toEqual(["\\mywidth", "custom"]);
    expect(widthInputs().value.type).toBe("text");
    expect(document.querySelector("dialog")?.textContent).toContain("visual.table.widthCustomHelp");
  });

  it("keeps the relative width command when changing the percentage", async () => {
    const editor = await openWidthDialog("{p{0.25\\textwidth}cr}");
    const { value, form } = widthInputs();
    fireEvent.change(value, { target: { value: "50" } });
    fireEvent.submit(form);
    expect(tabular(editor)).toContain("p{0.5\\textwidth}");
  });

  it("writes absolute and custom widths and rejects empty or non-positive values", async () => {
    const editor = await openWidthDialog("{lcr}");
    const { value, unit, form } = widthInputs();
    fireEvent.change(unit, { target: { value: "cm" } });
    expect(document.querySelector("dialog")?.textContent).not.toContain("visual.table.widthPercentHelp");
    fireEvent.change(value, { target: { value: "0" } });
    fireEvent.submit(form);
    expect(document.querySelector("dialog")).not.toBeNull();
    fireEvent.change(value, { target: { value: "2.5" } });
    fireEvent.submit(form);
    expect(tabular(editor)).toContain("p{2.5cm}");
    selectColumn(editor, 1);
    choose("visual.table.columnWidth", "visual.table.fixedWidth");
    const custom = widthInputs();
    fireEvent.change(custom.unit, { target: { value: "custom" } });
    fireEvent.change(custom.value, { target: { value: "  " } });
    fireEvent.submit(custom.form);
    expect(document.querySelector("dialog")).not.toBeNull();
    fireEvent.change(custom.value, { target: { value: " \\colwidth " } });
    fireEvent.submit(custom.form);
    expect(tabular(editor)).toContain("p{\\colwidth}");
  });

  it("closes the width dialog with Cancel without changing the table", async () => {
    const editor = await openWidthDialog("{lcr}");
    const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>("dialog button")).find(
      (button) => button.textContent === "visual.table.cancel",
    );
    fireEvent.click(cancel!);
    expect(document.querySelector("dialog")).toBeNull();
    expect(editor.state.doc.toString()).toBe(DOC);
  });

  it("opens the width dialog from a column width badge", async () => {
    const editor = await mount(DOC.replace("{lcr}", "{p{3cm}cr}"));
    expect(editor.dom.querySelector(".ofl-visual-table-width-badge")).toBeNull();
    selectCell(editor, 4);
    const badge = editor.dom.querySelector<HTMLButtonElement>(".ofl-visual-table-width-badge");
    expect(badge?.textContent).toBe("3cm");
    fireEvent.mouseDown(badge!);
    fireEvent.click(badge!);
    expect(selectedTexts(editor)).toEqual(["A", "1"]);
    expect(widthInputs().value.value).toBe("3");
  });
});
