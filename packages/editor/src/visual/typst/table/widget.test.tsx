// @vitest-environment jsdom

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installEnglishEditorMessages } from "../../../test-messages";
import { loadTypstParser, typstLanguage } from "../../../typst";
import { parsedView } from "../../test-document";
import { typstVisualMode } from "../index";
import { NO_PORTS } from "../test-support";

const DOC = `Intro.
#table(
  columns: 2,
  table.header([Name], [Count]),
  [Alpha], [1],
  [Beta], [2],
)
Outro.`;

let view: EditorView | null = null;

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installEnglishEditorMessages();
  await loadTypstParser();
  if (!globalThis.Range.prototype.getClientRects) {
    Object.defineProperty(globalThis.Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  }
});

afterEach(async () => {
  await act(async () => {
    view?.destroy();
  });
  view = null;
  document.body.replaceChildren();
});

async function mount(doc = DOC): Promise<EditorView> {
  const editor = await act(async () =>
    parsedView(
      new EditorView({
        state: EditorState.create({
          doc,
          selection: EditorSelection.cursor(0),
          extensions: [typstLanguage(), typstVisualMode(NO_PORTS)],
        }),
        parent: document.body,
      }),
    ),
  );
  await act(async () => {
    editor.dispatch({});
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

describe("the Typst table grid", () => {
  it("renders the header and body cells", async () => {
    const editor = await mount();
    expect(cells(editor).map((cell) => cell.textContent)).toEqual(["Name", "Count", "Alpha", "1", "Beta", "2"]);
    expect(cells(editor)[0].classList.contains("ofl-visual-table-cell-border-top")).toBe(true);
    expect(editor.dom.querySelector(".ofl-visual-typst-table")).not.toBeNull();
  });

  it("writes an edited cell back as Typst", async () => {
    const editor = await mount();
    fireEvent.mouseDown(cells(editor)[3], { button: 0 });
    fireEvent.keyDown(grid(editor), { key: "Enter" });
    const input = editor.dom.querySelector<HTMLTextAreaElement>(".ofl-visual-table-cell-input");
    expect(input).not.toBeNull();
    fireEvent.input(input!, { target: { value: "one ] two" } });
    fireEvent.keyDown(grid(editor), { key: "Enter" });
    expect(editor.state.doc.toString()).toBe(DOC.replace("[Alpha], [1],", "[Alpha], [one \\] two],"));
  });

  it("adds a row in Typst syntax when tabbing past the last cell", async () => {
    const editor = await mount();
    fireEvent.mouseDown(cells(editor)[5], { button: 0 });
    fireEvent.keyDown(grid(editor), { key: "Tab" });
    expect(editor.state.doc.toString()).toBe(DOC.replace("[Beta], [2],", "[Beta], [2],\n  [], [],"));
    expect(cells(editor)).toHaveLength(8);
  });

  it("offers the Typst toolbar and inserts a column", async () => {
    const editor = await mount();
    fireEvent.mouseDown(grid(editor).querySelectorAll(".ofl-visual-table-handle-column")[1], { button: 0 });
    const toolbar = editor.dom.querySelector(".ofl-visual-table-toolbar");
    expect(toolbar).not.toBeNull();
    expect(toolbar?.querySelector('[aria-label="Merge cells"]')).toBeNull();
    fireEvent.click(toolbar!.querySelector('[aria-label="Insert"]')!);
    const item = Array.from(editor.dom.querySelectorAll<HTMLElement>(".ofl-visual-table-menu [role='menuitem']")).find(
      (candidate) => candidate.textContent?.includes("right"),
    );
    expect(item).toBeDefined();
    fireEvent.click(item!);
    expect(editor.state.doc.toString()).toContain("columns: 3,");
    expect(editor.state.doc.toString()).toContain("table.header([Name], [Count], []),");
  });

  it("inserts a body row under the header when asked to insert above the header row", async () => {
    const editor = await mount();
    fireEvent.mouseDown(grid(editor).querySelectorAll(".ofl-visual-table-handle-row")[0], { button: 0 });
    const toolbar = editor.dom.querySelector(".ofl-visual-table-toolbar");
    fireEvent.click(toolbar!.querySelector('[aria-label="Insert"]')!);
    const item = Array.from(editor.dom.querySelectorAll<HTMLElement>(".ofl-visual-table-menu [role='menuitem']")).find(
      (candidate) => candidate.textContent?.includes("above"),
    );
    expect(item?.getAttribute("aria-disabled")).not.toBe("true");
    expect(item?.hasAttribute("disabled")).toBe(false);
    fireEvent.click(item!);
    expect(editor.state.doc.toString()).toBe(DOC.replace("  [Alpha], [1],", "  [], [],\n  [Alpha], [1],"));
  });

  function choose(editor: EditorView, menu: string, item: string): void {
    fireEvent.click(editor.dom.querySelector(`.ofl-visual-table-toolbar [aria-label="${menu}"]`)!);
    const option = Array.from(editor.dom.querySelectorAll<HTMLElement>(".ofl-visual-table-menu-item")).find(
      (candidate) => candidate.textContent === item,
    );
    if (!option) throw new Error(`No menu item ${item}`);
    fireEvent.click(option);
  }

  function selectColumn(editor: EditorView, index: number): void {
    fireEvent.mouseDown(grid(editor).querySelectorAll(".ofl-visual-table-handle-column")[index], { button: 0 });
  }

  it("switches the borders off and on from the toolbar", async () => {
    const editor = await mount();
    selectColumn(editor, 0);
    choose(editor, "Borders", "No borders");
    expect(editor.state.doc.toString()).toContain("stroke: none,");
    selectColumn(editor, 0);
    choose(editor, "Borders", "All borders");
    expect(editor.state.doc.toString()).not.toContain("stroke");
  });

  it("aligns a selected column from the toolbar", async () => {
    const editor = await mount();
    selectColumn(editor, 1);
    choose(editor, "Alignment", "Align right");
    expect(editor.state.doc.toString()).toContain("align: (left, right),");
    selectColumn(editor, 1);
    choose(editor, "Alignment", "Align centre");
    expect(editor.state.doc.toString()).toContain("align: (left, center),");
    selectColumn(editor, 1);
    choose(editor, "Alignment", "Align left");
    expect(editor.state.doc.toString()).toContain("align: left,");
  });

  it("inserts columns to the left and rows below from the toolbar", async () => {
    const editor = await mount();
    selectColumn(editor, 0);
    choose(editor, "Insert", "Insert column left");
    expect(editor.state.doc.toString()).toContain("table.header([], [Name], [Count]),");
    fireEvent.mouseDown(grid(editor).querySelectorAll(".ofl-visual-table-handle-row")[2], { button: 0 });
    choose(editor, "Insert", "Insert row below");
    expect(editor.state.doc.toString()).toContain("[], [Beta], [2],\n  [], [], [],");
  });

  it("deletes a row and removes the table from the toolbar", async () => {
    const editor = await mount();
    fireEvent.mouseDown(grid(editor).querySelectorAll(".ofl-visual-table-handle-row")[1], { button: 0 });
    fireEvent.click(editor.dom.querySelector('.ofl-visual-table-toolbar [aria-label="Delete"]')!);
    expect(editor.state.doc.toString()).not.toContain("[Alpha]");
    fireEvent.mouseDown(grid(editor).querySelectorAll(".ofl-visual-table-handle-row")[0], { button: 0 });
    fireEvent.click(editor.dom.querySelector('.ofl-visual-table-toolbar [aria-label="Remove table"]')!);
    expect(editor.state.doc.toString()).toBe("Intro.\nOutro.");
  });
});
