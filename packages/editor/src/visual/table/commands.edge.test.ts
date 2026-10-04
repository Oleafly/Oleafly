import { describe, expect, it } from "vitest";
import {
  alignmentEdit,
  borderPresetEdit,
  captionEdit,
  captionPlacementOf,
  clearCellsEdit,
  columnWidthEdit,
  deleteSelectionEdit,
  insertRowsEdit,
  mergeCellsEdit,
  removeColumnWidthEdit,
  removeTableEdit,
  unmergeCellsEdit,
} from "./commands";
import { CellSelection } from "./table-selection";
import { applied, fixtureOf, tabularSource } from "./test-support";

const INLINE = "\\begin{tabular}{ll}A & B \\\\ C & D \\\\ \\end{tabular}";

describe("border presets on unusual layouts", () => {
  it("adds rules inline when the rows share a line with the table opener", () => {
    const { state, parsed } = fixtureOf(INLINE);
    expect(applied(state, borderPresetEdit(state, parsed, "all"))).toBe(
      "\\begin{tabular}{|l|l|}\\hline A & B \\\\ \\hline C & D \\\\ \\hline \\end{tabular}",
    );
  });

  it("closes an unterminated last row before adding the bottom rule", () => {
    const { state, parsed } = fixtureOf("\\begin{tabular}{ll}\nA & B \\\\\nC & D\n\\end{tabular}");
    expect(tabularSource(applied(state, borderPresetEdit(state, parsed, "booktabs")))).toBe(
      "\\begin{tabular}{ll}\n\\toprule\nA & B \\\\\n\\midrule\nC & D \\\\ \\bottomrule\n\\end{tabular}",
    );
  });

  it("rewrites existing rules and removes doubled ones", () => {
    const { state, parsed } = fixtureOf(
      "\\begin{tabular}{|l|l|}\n\\hline\\hline\nA & B \\\\\n\\hline\nC & D \\\\ \\hline \\hline\n\\end{tabular}",
    );
    expect(tabularSource(applied(state, borderPresetEdit(state, parsed, "booktabs")))).toBe(
      "\\begin{tabular}{ll}\n\\toprule\nA & B \\\\\n\\midrule\nC & D \\\\ \\bottomrule\n\\end{tabular}",
    );
  });
});

describe("column alignment and widths", () => {
  const PARAGRAPH = "\\begin{tabular}{p{2cm}m{3cm}l}\nA & B & C \\\\\n\\end{tabular}";

  it("keeps a paragraph column's width while aligning it", () => {
    const { state, parsed } = fixtureOf(PARAGRAPH);
    const edit = alignmentEdit(state, parsed, CellSelection.column(parsed.model, 0), "center");
    expect(tabularSource(applied(state, edit))).toContain(">{\\centering\\arraybackslash}p{2cm}");
  });

  it("does not justify a plain column", () => {
    const { state, parsed } = fixtureOf(PARAGRAPH);
    const edit = alignmentEdit(state, parsed, CellSelection.column(parsed.model, 2), "paragraph");
    expect(edit.changes).toEqual([]);
  });

  it("aligns a merged cell and ignores justification there", () => {
    const { state, parsed } = fixtureOf("\\begin{tabular}{ll}\n\\multicolumn{2}{c}{AB} \\\\\nC & D \\\\\n\\end{tabular}");
    const merged = CellSelection.cell(0, 0).expand(parsed.model);
    expect(tabularSource(applied(state, alignmentEdit(state, parsed, merged, "right")))).toContain("\\multicolumn{2}{r}{AB}");
    expect(alignmentEdit(state, parsed, merged, "paragraph").changes).toEqual([]);
  });

  it("keeps the m column type when its width changes", () => {
    const { state, parsed } = fixtureOf(PARAGRAPH);
    const edit = columnWidthEdit(state, parsed, CellSelection.column(parsed.model, 1), { kind: "absolute", value: 4, unit: "cm" });
    expect(tabularSource(applied(state, edit))).toContain("m{4cm}");
  });

  it("turns a justified column back into a left column when its width is removed", () => {
    const { state, parsed } = fixtureOf(PARAGRAPH);
    const edit = removeColumnWidthEdit(state, parsed, CellSelection.column(parsed.model, 0));
    expect(tabularSource(applied(state, edit))).toContain("{lm{3cm}l}");
  });
});

describe("rows and cells", () => {
  it("inserts rows above inline rows on the same line", () => {
    const { state, parsed } = fixtureOf(INLINE);
    const edit = insertRowsEdit(state, parsed, CellSelection.cell(1, 0), "above");
    expect(applied(state, edit)).toBe("\\begin{tabular}{ll}A & B \\\\ & \\\\ C & D \\\\ \\end{tabular}");
  });

  it("deletes the last rows through their separator or the end of the last cell", () => {
    const separated = fixtureOf("\\begin{tabular}{ll}\nA & B \\\\\nC & D \\\\\n\\end{tabular}");
    expect(tabularSource(applied(separated.state, deleteSelectionEdit(separated.state, separated.parsed, CellSelection.row(separated.parsed.model, 1)))))
      .toBe("\\begin{tabular}{ll}\nA & B \\\\\n\\end{tabular}");
    const open = fixtureOf("\\begin{tabular}{ll}\nA & B \\\\\nC & D\n\\end{tabular}");
    expect(tabularSource(applied(open.state, deleteSelectionEdit(open.state, open.parsed, CellSelection.row(open.parsed.model, 1)))))
      .toBe("\\begin{tabular}{ll}\nA & B \\\\\n\\end{tabular}");
  });

  it("refuses to delete a partial column or plain cells", () => {
    const { state, parsed } = fixtureOf("\\begin{tabular}{ll}\nA & B \\\\\nC & D \\\\\n\\end{tabular}");
    expect(deleteSelectionEdit(state, parsed, CellSelection.cell(0, 0))).toBeNull();
  });

  it("keeps the left border of a fully ruled table when deleting its first column", () => {
    const { state, parsed } = fixtureOf("\\begin{tabular}{|l|l|l|}\n\\hline\nA & B & C \\\\ \\hline\n\\end{tabular}");
    const edit = deleteSelectionEdit(state, parsed, CellSelection.column(parsed.model, 0));
    expect(tabularSource(applied(state, edit))).toContain("{|l|l|}");
  });

  it("merges cells without empty content and refuses to unmerge plain cells", () => {
    const { state, parsed } = fixtureOf("\\begin{tabular}{lll}\nA & & C \\\\\n\\end{tabular}");
    const edit = mergeCellsEdit(parsed, new CellSelection({ row: 0, column: 0 }, { row: 0, column: 2 }));
    expect(tabularSource(applied(state, edit))).toContain("\\multicolumn{3}{c}{A C}");
    expect(unmergeCellsEdit(parsed, CellSelection.cell(0, 0))).toBeNull();
  });

  it("clears only cells that have content", () => {
    const { parsed } = fixtureOf("\\begin{tabular}{ll}\nA & \\\\\n\\end{tabular}");
    expect(clearCellsEdit(parsed, CellSelection.row(parsed.model, 0)).changes).toHaveLength(1);
  });
});

describe("captions", () => {
  const TABLE = (inner: string) => `\\begin{table}\n${inner}\\begin{tabular}{l}\nA \\\\\n\\end{tabular}\n\\end{table}\n`;

  it("adds a default caption and label above or below a table without one", () => {
    const above = fixtureOf(TABLE(""));
    expect(captionPlacementOf(above.parsed, above.environment)).toBe("none");
    expect(applied(above.state, captionEdit(above.state, above.parsed, above.environment, "above"))).toBe(
      TABLE("\\caption{Caption}\n\\label{tab:my_table}\n"),
    );
    expect(applied(above.state, captionEdit(above.state, above.parsed, above.environment, "below"))).toBe(
      "\\begin{table}\n\\begin{tabular}{l}\nA \\\\\n\\end{tabular}\n\\caption{Caption}\n\\label{tab:my_table}\n\\end{table}\n",
    );
    expect(captionEdit(above.state, above.parsed, above.environment, "none")).toBeNull();
  });

  it("moves a caption that holds its label without duplicating the label", () => {
    const { state, parsed, environment } = fixtureOf(TABLE("\\caption{Cap \\label{tab:x}}\n"));
    expect(captionPlacementOf(parsed, environment)).toBe("above");
    expect(captionEdit(state, parsed, environment, "above")).toBeNull();
    const moved = applied(state, captionEdit(state, parsed, environment, "below"));
    expect(moved.match(/\\label/gu)).toHaveLength(1);
    expect(moved.indexOf("\\caption")).toBeGreaterThan(moved.indexOf("\\end{tabular}"));
    expect(applied(state, captionEdit(state, parsed, environment, "none"))).toBe(TABLE(""));
  });

  it("does nothing for a bare tabular and removes it on its own", () => {
    const { state, parsed, environment } = fixtureOf("Text\n\\begin{tabular}{l}\nA \\\\\n\\end{tabular}\n");
    expect(captionEdit(state, parsed, environment, "above")).toBeNull();
    expect(applied(state, removeTableEdit(state, parsed, environment))).toBe("Text\n");
  });
});
