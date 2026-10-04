// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent, render, screen } from "@testing-library/react";
import { latexLanguage } from "codemirror-lang-latex";
import { act, type FC } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TableEdit } from "./commands";
import { type TableDialect, type TableHost, useTableHost } from "./contexts";
import { TableEditor } from "./TableEditor";
import { fixtureOf } from "./test-support";
import { TableRenderingErrorWidget, TabularWidget } from "./widget";

const DOC = `\\begin{tabular}{ll}
A & B \\\\
\\end{tabular}
`;

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

afterEach(() => {
  view?.destroy();
  view = null;
});

function editorView(doc = DOC): EditorView {
  view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [latexLanguage] }),
    parent: document.body,
  });
  return view;
}

function hostFor(editor: EditorView, dialect?: TableDialect): TableHost {
  const { parsed } = fixtureOf(editor.state.doc.toString());
  return { view: editor, parsed, environment: null, directChild: false, dialect };
}

describe("table rendering error widget", () => {
  it("compares by position and environment", () => {
    const widget = new TableRenderingErrorWidget(4, true);
    expect(widget.eq(new TableRenderingErrorWidget(4, true))).toBe(true);
    expect(widget.eq(new TableRenderingErrorWidget(4, false))).toBe(false);
    expect(widget.eq(new TableRenderingErrorWidget(5, true))).toBe(false);
    expect(widget.ignoreEvent()).toBe(true);
    expect(widget.estimatedHeight).toBe(72);
  });

  it("explains the failure and moves the cursor to the source on request", () => {
    const editor = editorView();
    const inside = new TableRenderingErrorWidget(3, true).toDOM(editor);
    expect(inside.className).toBe("ofl-visual-table-error ofl-visual-environment-table");
    expect(inside.getAttribute("role")).toBe("alert");
    const bare = new TableRenderingErrorWidget(3, false).toDOM(editor);
    expect(bare.className).toBe("ofl-visual-table-error");
    expect(bare.textContent).toBe("visual.table.errorTitlevisual.table.errorBodyvisual.table.viewSource");
    fireEvent.click(bare.querySelector("button")!);
    expect(editor.state.selection.main.head).toBe(3);
    expect(new TableRenderingErrorWidget(3, false).coordsAt(bare)).toBeDefined();
  });
});

describe("tabular widget", () => {
  it("renders a bare tabular without the table environment frame", async () => {
    const editor = editorView();
    const { parsed } = fixtureOf(DOC);
    const widget = new TabularWidget(parsed, null, false, DOC);
    const element = await act(async () => widget.toDOM(editor));
    expect(element.className).toBe("ofl-visual-table-widget");
    expect(element.querySelectorAll(".ofl-visual-table-cell")).toHaveLength(2);
    expect(widget.estimatedHeight).toBe(72);
    expect(widget.ignoreEvent(new Event("mousedown"))).toBe(true);
    expect(widget.ignoreEvent(new Event("mouseup"))).toBe(false);
    expect(widget.coordsAt(element)).toBeDefined();
    await act(async () => {
      widget.destroy(element);
      widget.destroy(element);
      await Promise.resolve();
    });
    expect(element.childElementCount).toBe(0);
  });

  it("compares widgets by source position, environment and content", () => {
    const { parsed } = fixtureOf(DOC);
    const widget = new TabularWidget(parsed, null, false, DOC);
    expect(widget.eq(new TabularWidget(parsed, null, false, DOC))).toBe(true);
    expect(widget.eq(new TabularWidget(parsed, null, false, `${DOC} `))).toBe(false);
    expect(widget.eq(new TabularWidget(parsed, null, true, DOC))).toBe(false);
  });
});

describe("table editor host", () => {
  it("falls back to the rendering error when part of the editor throws", async () => {
    const editor = editorView();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken: FC = () => {
      throw new Error("broken toolbar");
    };
    const dialect: TableDialect = {
      sanitizeCellInput: (text) => text,
      appendRowEdit: () => null,
      Toolbar: Broken,
      Dialogs: null,
    };
    render(<TableEditor host={hostFor(editor, dialect)} />);
    expect(screen.getByRole("alert").textContent).toContain("visual.table.errorTitle");
    expect(error.mock.calls.some(([message]) => message === "Visual table rendering failed")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "visual.table.viewSource" }));
    expect(editor.state.selection.main.head).toBe(0);
    error.mockRestore();
  });

  it("uses the dialect's toolbar, cell sanitiser and row appender", async () => {
    const editor = editorView();
    const appended: TableEdit = { changes: [{ from: DOC.indexOf("\\end"), insert: "C & D \\\\\n" }], selection: null };
    const Toolbar: FC = () => <div data-testid="dialect-toolbar">{useTableHost().parsed.model.rowCount}</div>;
    const dialect: TableDialect = {
      sanitizeCellInput: (text) => text.toUpperCase(),
      appendRowEdit: vi.fn(() => appended),
      Toolbar,
      Dialogs: null,
    };
    render(<TableEditor host={hostFor(editor, dialect)} />);
    const cells = document.querySelectorAll(".ofl-visual-table-cell");
    fireEvent.mouseDown(cells[1], { button: 0 });
    expect(screen.getByTestId("dialect-toolbar").textContent).toBe("1");
    const grid = document.querySelector(".ofl-visual-table-grid")!;
    fireEvent.keyDown(grid, { key: "Enter" });
    fireEvent.input(document.querySelector(".ofl-visual-table-cell-input")!, { target: { value: "bee" } });
    fireEvent.keyDown(grid, { key: "Tab" });
    expect(dialect.appendRowEdit).toHaveBeenCalledTimes(1);
    expect(editor.state.doc.toString()).toBe("\\begin{tabular}{ll}\nA & BEE \\\\\nC & D \\\\\n\\end{tabular}\n");
  });

  it("keeps the selection on the last cell when the dialect cannot append a row", async () => {
    const editor = editorView();
    const dialect: TableDialect = {
      sanitizeCellInput: (text) => text,
      appendRowEdit: () => null,
      Toolbar: () => null,
      Dialogs: null,
    };
    render(<TableEditor host={hostFor(editor, dialect)} />);
    const cells = document.querySelectorAll(".ofl-visual-table-cell");
    fireEvent.mouseDown(cells[1], { button: 0 });
    fireEvent.keyDown(document.querySelector(".ofl-visual-table-grid")!, { key: "Tab" });
    expect(editor.state.doc.toString()).toBe(DOC);
    expect(document.querySelectorAll(".ofl-visual-table-cell-selected")).toHaveLength(1);
    expect(document.querySelector(".ofl-visual-table-cell-selected")?.textContent).toBe("A");
  });

  it("refuses to use the table hooks outside the editor", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const Outside: FC = () => <span>{useTableHost().directChild ? "yes" : "no"}</span>;
    expect(() => render(<Outside />)).toThrow("TableHost is only available inside the table editor");
    error.mockRestore();
  });
});
