import type { EditorState } from "@codemirror/state";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTypstParser } from "../../../typst";
import { CellSelection } from "../../table/table-selection";
import {
  typstAppendRowEdit,
  typstBordersEdit,
  typstDeleteSelectionEdit,
  typstInsertColumnsEdit,
  typstInsertRowsEdit,
  typstRemoveTableEdit,
} from "./commands";
import type { TypstTable } from "./parse";
import { applied, tableOf } from "./test-support";

beforeAll(async () => {
  await loadTypstParser();
});

function run(doc: string, edit: (state: EditorState, table: TypstTable) => { changes: unknown[] } | null): string | null {
  const { state, table } = tableOf(doc);
  if (!table) throw new Error("the table did not parse");
  const result = edit(state, table);
  if (!result) return null;
  const after = applied(state, result.changes as never);
  expect(tableOf(after).table, `the edited table should still parse:\n${after}`).not.toBeNull();
  return after;
}

const all = (table: TypstTable) =>
  new CellSelection({ row: 0, column: 0 }, { row: table.parsed.model.rowCount - 1, column: table.parsed.model.columnCount - 1 });

describe("Typst table edits on single-line tables", () => {
  const INLINE = "#table(columns: 3, [a], [b], [c], [d], [e], [f])";

  it("inserts rows and columns inline", () => {
    expect(run(INLINE, (state, table) => typstAppendRowEdit(state, table))).toBe(
      "#table(columns: 3, [a], [b], [c], [d], [e], [f], [], [], [])",
    );
    expect(run(INLINE, (state, table) => typstInsertRowsEdit(state, table, CellSelection.cell(0, 0), "below"))).toBe(
      "#table(columns: 3, [a], [b], [c], [], [], [], [d], [e], [f])",
    );
    expect(run(INLINE, (state, table) => typstInsertRowsEdit(state, table, CellSelection.cell(1, 0), "above"))).toBe(
      "#table(columns: 3, [a], [b], [c], [], [], [], [d], [e], [f])",
    );
    expect(run(INLINE, (state, table) => typstInsertColumnsEdit(state, table, CellSelection.cell(0, 0), "left"))).toBe(
      "#table(columns: 4, [], [a], [b], [c], [], [d], [e], [f])",
    );
  });

  it("deletes a column and refuses to delete every cell", () => {
    expect(run(INLINE, (state, table) => typstDeleteSelectionEdit(state, table, CellSelection.column(table.parsed.model, 0)))).toBe(
      "#table(columns: 2, [b], [c], [e], [f])",
    );
    expect(run(INLINE, (state, table) => typstDeleteSelectionEdit(state, table, all(table)))).toBeNull();
    expect(run(INLINE, (state, table) => typstDeleteSelectionEdit(state, table, CellSelection.cell(0, 1)))).toBeNull();
  });

  it("removes a table that shares its line with prose", () => {
    const doc = "Text #table(columns: 1, [a]) after";
    const { state } = tableOf(doc);
    const removal = { from: doc.indexOf("#table"), to: doc.indexOf(" after") };
    expect(applied(state, typstRemoveTableEdit(state, removal).changes)).toBe("Text  after");
  });
});

describe("Typst table edits without a column count", () => {
  it("adds a column count when a second column appears", () => {
    expect(run("#table([a], [b])", (state, table) => typstInsertColumnsEdit(state, table, CellSelection.cell(0, 0), "left"))).toBe(
      "#table([], columns: 2, [a], [], [b])",
    );
    expect(run("#table(\n  [a],\n)", (state, table) => typstInsertColumnsEdit(state, table, CellSelection.cell(0, 0), "left"))).toBe(
      "#table(\n  columns: 2,\n  [], [a],\n)",
    );
  });

  it("will not delete the only column", () => {
    expect(run("#table([a], [b])", (state, table) => typstDeleteSelectionEdit(state, table, CellSelection.column(table.parsed.model, 0)))).toBeNull();
  });
});

describe("Typst table column track arrays", () => {
  const TRACKS = "#table(columns: (1fr, 2fr), [a], [b], [c], [d])";

  it("adds an automatic track and keeps a one-track array an array", () => {
    expect(run(TRACKS, (state, table) => typstInsertColumnsEdit(state, table, CellSelection.cell(0, 0), "left"))).toBe(
      "#table(columns: (auto, 1fr, 2fr), [], [a], [b], [], [c], [d])",
    );
    expect(run(TRACKS, (state, table) => typstDeleteSelectionEdit(state, table, CellSelection.column(table.parsed.model, 0)))).toBe(
      "#table(columns: (2fr,), [b], [d])",
    );
  });
});

describe("Typst table borders", () => {
  it("adds, replaces and removes the stroke argument", () => {
    expect(run("#table(columns: 2, [a], [b])", (state, table) => typstBordersEdit(state, table, false))).toBe(
      "#table(columns: 2, stroke: none, [a], [b])",
    );
    expect(run("#table(columns: 2, [a], [b])", (state, table) => typstBordersEdit(state, table, true))).toBeNull();
    expect(run("#table(columns: 2, stroke: none, [a], [b])", (state, table) => typstBordersEdit(state, table, true))).toBe(
      "#table(columns: 2, [a], [b])",
    );
    expect(run("#table(columns: 2, stroke: none, [a], [b])", (state, table) => typstBordersEdit(state, table, false))).toBeNull();
    expect(run("#table(columns: 2, stroke: 1pt, [a], [b])", (state, table) => typstBordersEdit(state, table, false))).toBe(
      "#table(columns: 2, stroke: none, [a], [b])",
    );
    expect(run("#table(columns: 2, stroke: 1pt, [a], [b])", (state, table) => typstBordersEdit(state, table, true))).toBeNull();
  });
});
