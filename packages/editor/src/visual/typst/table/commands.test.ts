import type { EditorState } from "@codemirror/state";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTypstParser } from "../../../typst";
import { writeCellEdit } from "../../table/commands";
import { CellSelection } from "../../table/table-selection";
import {
  sanitizeTypstCell,
  typstAlignmentEdit,
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

const TABLE = `#table(
  columns: 2,
  align: (left, center),
  table.header([*A*], [*B*]),
  table.hline(),
  [a], [b],
  [c], [d],
)`;

function setup(doc: string): { state: EditorState; table: TypstTable } {
  const { state, table } = tableOf(doc);
  if (!table) throw new Error("the table did not parse");
  return { state, table };
}

function run(doc: string, edit: (state: EditorState, table: TypstTable) => { changes: unknown[] } | null): string | null {
  const { state, table } = setup(doc);
  const result = edit(state, table);
  if (!result) return null;
  const after = applied(state, result.changes as never);
  expect(tableOf(after).table, `the edited table should still parse:\n${after}`).not.toBeNull();
  return after;
}

describe("Typst table cell edits", () => {
  it("writes a cell back between its brackets", () => {
    expect(run(TABLE, (_state, table) => writeCellEdit(table.parsed, 1, 1, "B2"))).toContain("[a], [B2],");
  });

  it("escapes brackets that would close the cell early", () => {
    expect(sanitizeTypstCell("a ] b")).toBe("a \\] b");
    expect(sanitizeTypstCell("keep [this] balanced")).toBe("keep [this] balanced");
    expect(sanitizeTypstCell("already \\] escaped")).toBe("already \\] escaped");
  });
});

describe("Typst table rows", () => {
  it("adds a row on its own line below the last row", () => {
    const after = run(TABLE, (state, table) =>
      typstInsertRowsEdit(state, table, CellSelection.row(table.parsed.model, 2), "below"),
    );
    expect(after).toContain("  [c], [d],\n  [], [],\n)");
  });

  it("adds a row above a body row and below the header", () => {
    const expected = "  table.hline(),\n  [], [],\n  [a], [b],";
    expect(
      run(TABLE, (state, table) => typstInsertRowsEdit(state, table, CellSelection.row(table.parsed.model, 1), "above")),
    ).toContain(expected);
    expect(
      run(TABLE, (state, table) => typstInsertRowsEdit(state, table, CellSelection.row(table.parsed.model, 0), "below")),
    ).toContain("  [], [],\n  [a], [b],");
  });

  it("puts rows asked for above the header at the top of the body", () => {
    const { state, table } = setup(TABLE);
    const edit = typstInsertRowsEdit(state, table, CellSelection.row(table.parsed.model, 0), "above");
    expect(edit?.selection?.bounds).toMatchObject({ minRow: 1, maxRow: 1, minColumn: 0, maxColumn: 1 });
    expect(
      run(TABLE, (state, table) => typstInsertRowsEdit(state, table, CellSelection.row(table.parsed.model, 0), "above")),
    ).toContain("  table.hline(),\n  [], [],\n  [a], [b],");
  });

  it("adds the first body row after a header-only table", () => {
    const doc = "#table(columns: 2, table.header([A], [B]))";
    expect(
      run(doc, (state, table) => typstInsertRowsEdit(state, table, CellSelection.row(table.parsed.model, 0), "above")),
    ).toBe("#table(columns: 2, table.header([A], [B]), [], [])");
  });

  it("appends rows inline in a single-line table", () => {
    expect(
      run("#table(columns: 2, [a], [b])", (state, table) => typstAppendRowEdit(state, table)),
    ).toBe("#table(columns: 2, [a], [b], [], [])");
  });

  it("deletes whole row lines", () => {
    expect(
      run(TABLE, (state, table) => typstDeleteSelectionEdit(state, table, CellSelection.row(table.parsed.model, 2))),
    ).toBe(TABLE.replace("  [c], [d],\n", ""));
    expect(
      run(TABLE, (state, table) => typstDeleteSelectionEdit(state, table, CellSelection.row(table.parsed.model, 1))),
    ).toBe(TABLE.replace("  [a], [b],\n", ""));
  });

  it("deletes the header call with its row", () => {
    expect(
      run(TABLE, (state, table) => typstDeleteSelectionEdit(state, table, CellSelection.row(table.parsed.model, 0))),
    ).toBe(TABLE.replace("  table.header([*A*], [*B*]),\n", ""));
  });

  it("deletes inline rows with their separators", () => {
    expect(
      run("#table(columns: 1, [a], [b], [c])", (state, table) =>
        typstDeleteSelectionEdit(state, table, CellSelection.row(table.parsed.model, 2)),
      ),
    ).toBe("#table(columns: 1, [a], [b])");
    expect(
      run("#table(columns: 1, [a], [b], [c])", (state, table) =>
        typstDeleteSelectionEdit(state, table, CellSelection.row(table.parsed.model, 0)),
      ),
    ).toBe("#table(columns: 1, [b], [c])");
  });
});

describe("Typst table columns", () => {
  it("inserts a column to the right and widens the column and alignment arrays", () => {
    const after = run(TABLE, (state, table) =>
      typstInsertColumnsEdit(state, table, CellSelection.column(table.parsed.model, 1), "right"),
    );
    expect(after).toBe(
      TABLE.replace("columns: 2", "columns: 3")
        .replace("align: (left, center)", "align: (left, center, left)")
        .replace("[*B*])", "[*B*], [])")
        .replace("[b],", "[b], [],")
        .replace("[d],", "[d], [],"),
    );
  });

  it("inserts a column to the left", () => {
    const after = run("#table(columns: (1fr, auto), [a], [b])", (state, table) =>
      typstInsertColumnsEdit(state, table, CellSelection.column(table.parsed.model, 0), "left"),
    );
    expect(after).toBe("#table(columns: (auto, 1fr, auto), [], [a], [b])");
  });

  it("adds a column count to a table that had none", () => {
    expect(
      run("#table([a], [b])", (state, table) =>
        typstInsertColumnsEdit(state, table, CellSelection.column(table.parsed.model, 0), "right"),
      ),
    ).toBe("#table(columns: 2, [a], [], [b], [])");
  });

  it("deletes a column from every row", () => {
    const after = run(TABLE, (state, table) =>
      typstDeleteSelectionEdit(state, table, CellSelection.column(table.parsed.model, 0)),
    );
    expect(after).toBe(
      TABLE.replace("columns: 2", "columns: 1")
        .replace("align: (left, center)", "align: center")
        .replace("[*A*], ", "")
        .replace("[a], ", "")
        .replace("[c], ", ""),
    );
  });

  it("deletes the last column", () => {
    expect(
      run("#table(columns: 2, [a], [b], [c], [d])", (state, table) =>
        typstDeleteSelectionEdit(state, table, CellSelection.column(table.parsed.model, 1)),
      ),
    ).toBe("#table(columns: 1, [a], [c])");
  });

  it("will not delete every column", () => {
    expect(
      run("#table(columns: 1, [a], [b])", (state, table) =>
        typstDeleteSelectionEdit(state, table, CellSelection.column(table.parsed.model, 0)),
      ),
    ).toBeNull();
  });
});

describe("Typst table alignment and borders", () => {
  it("rewrites the alignment array for the selected columns", () => {
    expect(
      run(TABLE, (state, table) =>
        typstAlignmentEdit(state, table, CellSelection.column(table.parsed.model, 1), "right"),
      ),
    ).toBe(TABLE.replace("align: (left, center)", "align: (left, right)"));
    const both = new CellSelection({ row: 0, column: 0 }, { row: 2, column: 1 });
    expect(run(TABLE, (state, table) => typstAlignmentEdit(state, table, both, "center"))).toBe(
      TABLE.replace("align: (left, center)", "align: center"),
    );
  });

  it("adds an alignment argument after the column count", () => {
    expect(
      run("#table(columns: 2, [a], [b])", (state, table) =>
        typstAlignmentEdit(state, table, CellSelection.column(table.parsed.model, 0), "center"),
      ),
    ).toBe("#table(columns: 2, align: (center, left), [a], [b])");
    expect(
      run(TABLE.replace("  align: (left, center),\n", ""), (state, table) =>
        typstAlignmentEdit(state, table, CellSelection.column(table.parsed.model, 0), "right"),
      ),
    ).toBe(TABLE.replace("align: (left, center)", "align: (right, left)"));
  });

  it("will not rewrite computed alignment", () => {
    expect(
      run("#table(columns: 2, align: (x, y) => left, [a], [b])", (state, table) =>
        typstAlignmentEdit(state, table, CellSelection.column(table.parsed.model, 0), "center"),
      ),
    ).toBeNull();
  });

  it("switches borders off and on", () => {
    const off = run("#table(columns: 2, [a], [b])", (state, table) => typstBordersEdit(state, table, false));
    expect(off).toBe("#table(columns: 2, stroke: none, [a], [b])");
    expect(run(off ?? "", (state, table) => typstBordersEdit(state, table, true))).toBe(
      "#table(columns: 2, [a], [b])",
    );
  });
});

describe("removing a Typst table", () => {
  it("removes the whole lines the table occupies", () => {
    const doc = `Before.\n${TABLE}\nAfter.`;
    const { state } = setup(doc);
    const removal = { from: doc.indexOf("#table"), to: doc.indexOf("\nAfter") };
    expect(applied(state, typstRemoveTableEdit(state, removal).changes)).toBe("Before.\nAfter.");
  });
});
