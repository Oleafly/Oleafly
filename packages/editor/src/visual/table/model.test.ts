import { describe, expect, it } from "vitest";
import { TableModel } from "./model";
import { CellSelection } from "./table-selection";
import { fixtureOf } from "./test-support";

function modelOf(source: string): TableModel {
  return fixtureOf(source).parsed.model;
}

describe("table model geometry", () => {
  const model = modelOf("\\begin{tabular}{lll}\n\\multicolumn{2}{c}{AB} & C \\\\\nD & E \\\\\n\\end{tabular}");

  it("locates cells through merged columns and short rows", () => {
    expect(model.cellIndexAt(0, 1)).toBe(0);
    expect(model.cellIndexAt(0, 2)).toBe(1);
    expect(model.cellIndexAt(1, 2)).toBe(1);
    expect(model.columnStartOf(0, 1)).toBe(2);
    expect(model.columnStartOf(1, 1)).toBe(1);
    expect(model.cellBounds(0, 1)).toEqual({ from: 0, to: 1 });
  });

  it("rejects a column beyond the end of the row", () => {
    expect(() => model.cellBounds(1, 2)).toThrow("Column index outside the row");
  });

  it("visits every cell of a range once", () => {
    const visited: Array<[string, number, number]> = [];
    model.forEachCell(0, 1, 1, 1, (cell, row, column) => visited.push([cell.content.trim(), row, column]));
    expect(visited).toEqual([
      ["AB", 0, 0],
      ["E", 1, 1],
    ]);
  });
});

describe("border presets", () => {
  it("reports no preset for an empty model", () => {
    expect(new TableModel([], []).borderPreset()).toBeNull();
  });

  it("recognises every preset with merged cells whose borders match", () => {
    const all = modelOf(
      "\\begin{tabular}{|l|l|}\n\\hline\n\\multicolumn{2}{|c|}{AB} \\\\\n\\hline\nC & D \\\\ \\hline\n\\end{tabular}",
    );
    expect(all.borderPreset()).toBe("all");
    const none = modelOf("\\begin{tabular}{ll}\n\\multicolumn{2}{c}{AB} \\\\\nC & D \\\\\n\\end{tabular}");
    expect(none.borderPreset()).toBe("none");
    const booktabs = modelOf(
      "\\begin{tabular}{ll}\n\\toprule\n\\multicolumn{2}{c}{AB} \\\\\n\\midrule\nC & D \\\\ \\bottomrule\n\\end{tabular}",
    );
    expect(booktabs.borderPreset()).toBe("booktabs");
  });

  it("reports a custom layout when merged cell borders disagree with the table", () => {
    const fullyRuled = modelOf(
      "\\begin{tabular}{|l|l|}\n\\hline\n\\multicolumn{2}{c|}{AB} \\\\\n\\hline\nC & D \\\\ \\hline\n\\end{tabular}",
    );
    expect(fullyRuled.borderPreset()).toBeNull();
    const plain = modelOf("\\begin{tabular}{ll}\n\\multicolumn{2}{|c}{AB} \\\\\nC & D \\\\\n\\end{tabular}");
    expect(plain.borderPreset()).toBeNull();
  });

  it("requires a border on both outer edges and between every column", () => {
    const ruled = (spec: string) =>
      modelOf(`\\begin{tabular}{${spec}}\n\\hline\nA & B \\\\ \\hline\n\\end{tabular}`).borderPreset();
    expect(ruled("|l|l|")).toBe("all");
    expect(ruled("l|l|")).toBeNull();
    expect(ruled("|l|l")).toBeNull();
    expect(ruled("|ll|")).toBeNull();
    expect(ruled("|l||l|")).toBe("all");
  });

  it("treats a single booktabs row without a midrule as booktabs", () => {
    expect(modelOf("\\begin{tabular}{ll}\n\\toprule\nA & B \\\\ \\bottomrule\n\\end{tabular}").borderPreset()).toBe(
      "booktabs",
    );
    expect(
      modelOf(
        "\\begin{tabular}{ll}\n\\toprule\nA & B \\\\\n\\midrule\nC & D \\\\\n\\midrule\nE & F \\\\ \\bottomrule\n\\end{tabular}",
      ).borderPreset(),
    ).toBeNull();
  });
});

describe("cell selection edge cases", () => {
  const model = modelOf("\\begin{tabular}{lll}\nA & \\multicolumn{2}{c}{BC} \\\\\nD & E & F \\\\\n\\end{tabular}");

  it("extends a column selection from its anchor", () => {
    const extended = CellSelection.column(model, 0).selectColumn(model, 1, true);
    expect(extended.bounds).toEqual({ minRow: 0, maxRow: 1, minColumn: 0, maxColumn: 1 });
    expect(extended.expand(model).bounds.maxColumn).toBe(2);
  });

  it("grows a selection whose anchor sits on a merged cell edge", () => {
    const grown = new CellSelection({ row: 0, column: 2 }, { row: 1, column: 2 }).expand(model);
    expect(grown.anchor).toEqual({ row: 0, column: 1 });
    expect(grown.head).toEqual({ row: 1, column: 2 });
  });

  it("stays on the first cell when moving back from the start", () => {
    expect(CellSelection.cell(0, 0).previous(model).head).toEqual({ row: 0, column: 0 });
  });

  it("refuses to merge across an existing merged cell", () => {
    expect(new CellSelection({ row: 0, column: 0 }, { row: 0, column: 2 }).canMerge(model)).toBe(false);
  });
});
