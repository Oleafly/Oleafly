import { describe, expect, it } from "vitest";
import { CellSelection, clampSelection } from "./table-selection";
import { fixtureOf } from "./test-support";

const MERGED = "\\begin{tabular}{lll}\n\\multicolumn{2}{c}{AB} & C \\\\\nD & E & F \\\\\n\\end{tabular}";

describe("cell selection", () => {
  it("expands over merged cells", () => {
    const { parsed } = fixtureOf(MERGED);
    const selection = CellSelection.cell(0, 0).expand(parsed.model);
    expect(selection.bounds).toEqual({ minRow: 0, maxRow: 0, minColumn: 0, maxColumn: 1 });
    expect(selection.isMergedCell(parsed.model)).toBe(true);
    expect(selection.contains(parsed.model, 0, 1)).toBe(true);
    expect(selection.contains(parsed.model, 1, 1)).toBe(false);
  });

  it("moves across merged cells and wraps at row ends", () => {
    const { parsed } = fixtureOf(MERGED);
    const { model } = parsed;
    expect(CellSelection.cell(0, 0).expand(model).moveRight(model).bounds.minColumn).toBe(2);
    expect(CellSelection.cell(1, 1).moveUp(model).bounds).toEqual({ minRow: 0, maxRow: 0, minColumn: 0, maxColumn: 1 });
    expect(CellSelection.cell(0, 2).next(model)!.head).toEqual({ row: 1, column: 0 });
    expect(CellSelection.cell(1, 2).next(model)).toBeNull();
    expect(CellSelection.cell(1, 0).previous(model).head).toEqual({ row: 0, column: 2 });
  });

  it("extends selections and reports full rows and columns", () => {
    const { parsed } = fixtureOf(MERGED);
    const { model } = parsed;
    const column = CellSelection.column(model, 2);
    expect(column.isColumnSelected(model, 2)).toBe(true);
    expect(column.anyRowSelected(model)).toBe(false);
    const row = CellSelection.row(model, 1);
    expect(row.isRowSelected(model, 1)).toBe(true);
    expect(row.canMerge(model)).toBe(true);
    const extended = CellSelection.cell(1, 0).extendRight(model).extendUp(model);
    expect(extended.bounds).toEqual({ minRow: 0, maxRow: 1, minColumn: 0, maxColumn: 1 });
    expect(extended.canMerge(model)).toBe(false);
    expect(CellSelection.row(model, 0).selectRow(model, 1, true).coversTable(model)).toBe(true);
  });

  it("clamps stale selections to the table", () => {
    const { parsed } = fixtureOf(MERGED);
    const clamped = clampSelection(parsed.model, new CellSelection({ row: 5, column: 9 }, { row: 1, column: 1 }));
    expect(clamped?.bounds).toEqual({ minRow: 1, maxRow: 1, minColumn: 1, maxColumn: 2 });
    expect(clampSelection(parsed.model, null)).toBeNull();
  });
});
