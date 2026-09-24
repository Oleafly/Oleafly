// @vitest-environment jsdom

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { history, undo } from "@codemirror/commands";
import { EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { latexLanguage } from "codemirror-lang-latex";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTabularDecoration } from "./decoration";
import { stateOf, tabularNodeOf } from "./test-support";
import { tableTheme } from "./theme";
import { TableRenderingErrorWidget, TabularWidget } from "./widget";

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
});

async function mount(doc = DOC): Promise<EditorView> {
  const editor = await act(async () => {
    return new EditorView({
      state: EditorState.create({ doc, extensions: [latexLanguage, tableField, tableTheme, history()] }),
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

describe("createTabularDecoration", () => {
  it("returns a block replace decoration carrying the table widget", () => {
    const state = stateOf(DOC);
    const node = tabularNodeOf(state);
    const [decoration] = createTabularDecoration(node, state);
    expect(decoration.from).toBe(node.from);
    expect(decoration.to).toBe(node.to);
    const widget = decoration.value.spec.widget as TabularWidget;
    expect(widget).toBeInstanceOf(TabularWidget);
    expect(widget.environment?.caption).toBeDefined();
    expect(widget.directChild).toBe(true);
  });

  it("skips decorating while the editor selection touches the tabular", () => {
    const state = stateOf(DOC, DOC.indexOf("A & B"));
    expect(createTabularDecoration(tabularNodeOf(state), state)).toEqual([]);
  });

  it("returns a rendering error widget for tables it cannot show", () => {
    const state = stateOf("Text\n\\begin{tabular}{ll}\nA & B \\\\ \\cline{1-2}\nC & D \\\\\n\\end{tabular}\n");
    const node = tabularNodeOf(state);
    const [decoration] = createTabularDecoration(node, state);
    expect(decoration.from).toBe(node.from);
    expect(decoration.to).toBe(node.from);
    expect(decoration.value.spec.widget).toBeInstanceOf(TableRenderingErrorWidget);
  });
});

describe("table widget", () => {
  it.each([
    { key: "Enter", keyCode: 13, isComposing: true },
    { key: "Enter", keyCode: 229, isComposing: false },
    { key: "Escape", keyCode: 27, isComposing: true },
    { key: "Tab", keyCode: 9, isComposing: true },
  ])("leaves composing input to the IME: %j", async (event) => {
    const editor = await mount();
    const table = grid(editor);
    fireEvent.mouseDown(table.querySelectorAll(".ofl-visual-table-cell")[0], { button: 0 });
    fireEvent.keyDown(table, { key: "Enter" });
    const input = editor.dom.querySelector<HTMLTextAreaElement>(".ofl-visual-table-cell-input")!;
    fireEvent.compositionStart(input);
    fireEvent.input(input, { target: { value: "にほん" }, isComposing: true });
    fireEvent.keyDown(input, event);
    expect(editor.dom.querySelector(".ofl-visual-table-cell-input")).toBe(input);
    expect(editor.state.doc.toString()).toBe(DOC);
    fireEvent.input(input, { target: { value: "日本" } });
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(editor.state.doc.toString()).toBe(DOC.replace("A & B", "日本 & B"));
  });

  it("renders the grid with handles and cell text", async () => {
    const editor = await mount();
    const table = grid(editor);
    const cells = table.querySelectorAll(".ofl-visual-table-cell");
    expect(cells).toHaveLength(6);
    expect(Array.from(cells, (cell) => cell.textContent)).toEqual(["A", "B", "C", "1", "2", "3"]);
    expect(table.querySelectorAll(".ofl-visual-table-handle-row")).toHaveLength(2);
    expect(table.querySelectorAll(".ofl-visual-table-handle-column")).toHaveLength(3);
    expect(editor.dom.querySelector(".ofl-visual-table-toolbar")).toBeNull();
    expect(editor.dom.querySelector(".ofl-visual-environment-table")).not.toBeNull();
  });

  it("selects cells with the pointer and shows the toolbar", async () => {
    const editor = await mount();
    const cells = grid(editor).querySelectorAll(".ofl-visual-table-cell");
    fireEvent.mouseDown(cells[1], { button: 0 });
    fireEvent.mouseUp(cells[1], { button: 0 });
    expect(cells[1].classList.contains("ofl-visual-table-cell-selected")).toBe(true);
    expect(cells[0].classList.contains("ofl-visual-table-cell-selected")).toBe(false);
    expect(editor.dom.querySelector(".ofl-visual-table-toolbar")).not.toBeNull();
    fireEvent.mouseDown(cells[5], { button: 0, shiftKey: true });
    expect(grid(editor).querySelectorAll(".ofl-visual-table-cell-selected")).toHaveLength(4);
    fireEvent.mouseDown(grid(editor).querySelectorAll(".ofl-visual-table-handle-row")[0], { button: 0 });
    const handle = grid(editor).querySelectorAll(".ofl-visual-table-handle-row")[0];
    expect(handle.classList.contains("ofl-visual-table-handle-active")).toBe(true);
    expect(grid(editor).querySelectorAll(".ofl-visual-table-cell-selected")).toHaveLength(3);
  });

  it("writes an edited cell back into the document and keeps the widget mounted", async () => {
    const editor = await mount();
    const table = grid(editor);
    fireEvent.mouseDown(table.querySelectorAll(".ofl-visual-table-cell")[1], { button: 0 });
    fireEvent.keyDown(table, { key: "Enter" });
    const input = editor.dom.querySelector<HTMLTextAreaElement>(".ofl-visual-table-cell-input");
    expect(input).not.toBeNull();
    fireEvent.input(input!, { target: { value: "Bee & more" } });
    fireEvent.keyDown(table, { key: "Enter" });
    expect(editor.state.doc.toString()).toContain("A & Bee \\& more & C \\\\");
    expect(grid(editor)).toBe(table);
    expect(editor.dom.querySelector(".ofl-visual-table-toolbar")).not.toBeNull();
    fireEvent.keyDown(grid(editor), { key: "Escape" });
    expect(editor.dom.querySelector(".ofl-visual-table-toolbar")).toBeNull();
  });

  it("adds a row when tabbing past the last cell", async () => {
    const editor = await mount();
    const table = grid(editor);
    fireEvent.mouseDown(table.querySelectorAll(".ofl-visual-table-cell")[5], { button: 0 });
    fireEvent.keyDown(table, { key: "Tab" });
    expect(editor.state.doc.toString()).toContain("1 & 2 & 3 \\\\\n& & \\\\\n");
    expect(grid(editor).querySelectorAll(".ofl-visual-table-cell")).toHaveLength(9);
    expect(grid(editor).querySelectorAll(".ofl-visual-table-cell")[6].classList.contains("ofl-visual-table-cell-selected")).toBe(
      true,
    );
  });

  it.each(["long new content", "", String.raw`\shortstack{one\\two}`])(
    "preserves an edited last cell when Tab adds a row: %s",
    async (content) => {
      const editor = await mount();
      const table = grid(editor);
      fireEvent.mouseDown(table.querySelectorAll(".ofl-visual-table-cell")[5], { button: 0 });
      fireEvent.keyDown(table, { key: "Enter" });
      const input = editor.dom.querySelector<HTMLTextAreaElement>(".ofl-visual-table-cell-input")!;
      fireEvent.input(input, { target: { value: content } });
      fireEvent.keyDown(input, { key: "Tab" });
      expect(editor.state.doc.toString()).toBe(DOC.replace("1 & 2 & 3", `1 & 2 & ${content}`).replace(
        "\\end{tabular}", "& & \\\\\n\\end{tabular}",
      ));
      expect(grid(editor).querySelectorAll(".ofl-visual-table-cell")).toHaveLength(9);
      expect(grid(editor).querySelectorAll(".ofl-visual-table-cell")[6]).toHaveClass("ofl-visual-table-cell-selected");
      await act(async () => { expect(undo(editor)).toBe(true); });
      expect(editor.state.doc.toString()).toBe(DOC);
    },
  );

  it("preserves nested LaTeX line breaks when committing a cell", async () => {
    const content = String.raw`\shortstack{one\\two}`;
    const doc = DOC.replace("A & B & C", `A & ${content} & C`);
    const editor = await mount(doc);
    const table = grid(editor);
    fireEvent.mouseDown(table.querySelectorAll(".ofl-visual-table-cell")[1], { button: 0 });
    fireEvent.keyDown(table, { key: "Enter" });
    const input = editor.dom.querySelector<HTMLTextAreaElement>(".ofl-visual-table-cell-input")!;
    fireEvent.input(input, { target: { value: `${content}!` } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(editor.state.doc.toString()).toBe(doc.replace(content, `${content}!`));
  });

  it("appends a row after an edited cell without a trailing row separator", async () => {
    const doc = DOC.replace("1 & 2 & 3 \\\\", "1 & 2 & 3");
    const editor = await mount(doc);
    const table = grid(editor);
    fireEvent.mouseDown(table.querySelectorAll(".ofl-visual-table-cell")[5], { button: 0 });
    fireEvent.keyDown(table, { key: "Enter" });
    const input = editor.dom.querySelector<HTMLTextAreaElement>(".ofl-visual-table-cell-input")!;
    fireEvent.input(input, { target: { value: "last cell" } });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(editor.state.doc.toString()).toBe(doc.replace("1 & 2 & 3", "1 & 2 & last cell \\\\\n& & \\\\"));
  });

  it("applies toolbar commands to the source", async () => {
    const editor = await mount();
    fireEvent.mouseDown(grid(editor).querySelectorAll(".ofl-visual-table-handle-column")[0], { button: 0 });
    const toolbar = editor.dom.querySelector(".ofl-visual-table-toolbar");
    const borders = toolbar?.querySelector<HTMLButtonElement>("[aria-label='visual.table.borders']");
    fireEvent.click(borders!);
    const items = editor.dom.querySelectorAll<HTMLButtonElement>(".ofl-visual-table-menu-item");
    fireEvent.click(items[2]);
    expect(editor.state.doc.toString()).toContain("\\toprule\nA & B & C \\\\\n\\midrule\n1 & 2 & 3 \\\\ \\bottomrule");
    expect(grid(editor).querySelector(".ofl-visual-table-cell-border-top")).not.toBeNull();
  });

  it("unmounts the React root when the widget is destroyed", async () => {
    const editor = await mount();
    const widget = editor.dom.querySelector<HTMLElement>(".ofl-visual-table-widget");
    expect(widget).not.toBeNull();
    await act(async () => {
      editor.dispatch({ selection: { anchor: editor.state.doc.toString().indexOf("A & B") } });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(editor.dom.querySelector(".ofl-visual-table-widget")).toBeNull();
    expect(widget!.childElementCount).toBe(0);
  });
});
