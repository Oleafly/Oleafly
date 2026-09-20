import { describe, expect, it } from "vitest";
import {
  alignmentEdit,
  borderPresetEdit,
  captionEdit,
  clearCellsEdit,
  columnWidthEdit,
  deleteSelectionEdit,
  insertColumnsEdit,
  insertRowsEdit,
  mergeCellsEdit,
  removeColumnWidthEdit,
  removeTableEdit,
  sanitizeCellInput,
  unmergeCellsEdit,
  writeCellEdit,
} from "./commands";
import { CellSelection } from "./table-selection";
import { applied, fixtureOf, tabularSource } from "./test-support";

const BASIC = `\\begin{table}
\\centering
\\begin{tabular}{lcr}
A & B & C \\\\
1 & 2 & 3 \\\\
\\end{tabular}
\\caption{Cap}
\\label{tab:x}
\\end{table}
`;

const BORDERED = `\\begin{tabular}{|l|c|r|}
\\hline
A & B & C \\\\
\\hline
1 & 2 & 3 \\\\ \\hline
\\end{tabular}`;

const BOOKTABS = `\\begin{tabular}{lcr}
\\toprule
A & B & C \\\\
\\midrule
1 & 2 & 3 \\\\ \\bottomrule
\\end{tabular}`;

describe("row commands", () => {
  it("inserts a row below the selected row", () => {
    const { state, parsed } = fixtureOf(BASIC);
    const edit = insertRowsEdit(state, parsed, CellSelection.cell(0, 1), "below");
    expect(tabularSource(applied(state, edit))).toBe(
      "\\begin{tabular}{lcr}\nA & B & C \\\\\n& & \\\\\n1 & 2 & 3 \\\\\n\\end{tabular}",
    );
    expect(edit.selection?.bounds).toEqual({ minRow: 1, maxRow: 1, minColumn: 0, maxColumn: 2 });
  });

  it("inserts a row above the selected row", () => {
    const { state, parsed } = fixtureOf(BASIC);
    const edit = insertRowsEdit(state, parsed, CellSelection.cell(1, 0), "above");
    expect(tabularSource(applied(state, edit))).toBe(
      "\\begin{tabular}{lcr}\nA & B & C \\\\\n& & \\\\\n1 & 2 & 3 \\\\\n\\end{tabular}",
    );
  });

  it("keeps every rule single in a fully bordered table", () => {
    const { state, parsed } = fixtureOf(BORDERED);
    const below = applied(state, insertRowsEdit(state, parsed, CellSelection.cell(0, 0), "below"));
    expect(below).toBe("\\begin{tabular}{|l|c|r|}\n\\hline\nA & B & C \\\\ \\hline\n& & \\\\\n\\hline\n1 & 2 & 3 \\\\ \\hline\n\\end{tabular}");
    expect(fixtureOf(below).parsed.model.borderPreset()).toBe("all");
    const above = applied(state, insertRowsEdit(state, parsed, CellSelection.cell(1, 0), "above"));
    expect(fixtureOf(above).parsed.model.borderPreset()).toBe("all");
    expect(fixtureOf(above).parsed.model.rowCount).toBe(3);
  });

  it("appends a row before the bottom rule of a booktabs table", () => {
    const { state, parsed } = fixtureOf(BOOKTABS);
    const result = applied(state, insertRowsEdit(state, parsed, CellSelection.cell(1, 2), "below"));
    expect(result).toContain("1 & 2 & 3 \\\\\n& & \\\\ \\bottomrule");
    expect(fixtureOf(result).parsed.model.borderPreset()).toBe("booktabs");
  });

  it("deletes the first, a middle and the last row while keeping the rules coherent", () => {
    const first = fixtureOf(BOOKTABS);
    const withoutFirst = applied(first.state, deleteSelectionEdit(first.state, first.parsed, CellSelection.row(first.parsed.model, 0)));
    expect(withoutFirst).toBe("\\begin{tabular}{lcr}\n\\toprule\n1 & 2 & 3 \\\\ \\bottomrule\n\\end{tabular}");
    const last = fixtureOf(BOOKTABS);
    const withoutLast = applied(last.state, deleteSelectionEdit(last.state, last.parsed, CellSelection.row(last.parsed.model, 1)));
    expect(withoutLast).toBe("\\begin{tabular}{lcr}\n\\toprule\nA & B & C \\\\ \\bottomrule\n\\end{tabular}");
    const basic = fixtureOf(BASIC);
    const edit = deleteSelectionEdit(basic.state, basic.parsed, CellSelection.row(basic.parsed.model, 0));
    expect(tabularSource(applied(basic.state, edit))).toBe("\\begin{tabular}{lcr}\n1 & 2 & 3 \\\\\n\\end{tabular}");
    expect(edit?.selection?.head).toEqual({ row: 0, column: 0 });
  });

  it("empties the table when every cell is selected", () => {
    const { state, parsed } = fixtureOf(BORDERED);
    const selection = new CellSelection({ row: 0, column: 0 }, { row: 1, column: 2 });
    const result = applied(state, deleteSelectionEdit(state, parsed, selection));
    expect(result).toBe("\\begin{tabular}{l}\n\\\\\n\\end{tabular}");
    expect(fixtureOf(result).parsed.model.rowCount).toBe(1);
  });
});

describe("column commands", () => {
  it("inserts columns on either side", () => {
    const right = fixtureOf(BASIC);
    const afterRight = applied(right.state, insertColumnsEdit(right.state, right.parsed, CellSelection.cell(0, 2), "right"));
    expect(tabularSource(afterRight)).toBe("\\begin{tabular}{lcrl}\nA & B & C & \\\\\n1 & 2 & 3 & \\\\\n\\end{tabular}");
    const left = fixtureOf(BASIC);
    const edit = insertColumnsEdit(left.state, left.parsed, CellSelection.cell(1, 0), "left");
    expect(tabularSource(applied(left.state, edit))).toBe(
      "\\begin{tabular}{llcr}\n& A & B & C \\\\\n& 1 & 2 & 3 \\\\\n\\end{tabular}",
    );
    expect(edit.selection?.bounds).toEqual({ minRow: 0, maxRow: 1, minColumn: 0, maxColumn: 0 });
  });

  it("keeps the outer borders when inserting into a bordered table", () => {
    const { state, parsed } = fixtureOf(BORDERED);
    const result = applied(state, insertColumnsEdit(state, parsed, CellSelection.cell(0, 0), "left"));
    expect(result).toContain("\\begin{tabular}{|l|l|c|r|}");
    expect(fixtureOf(result).parsed.model.borderPreset()).toBe("all");
  });

  it("deletes the first and a middle column", () => {
    const first = fixtureOf(BASIC);
    const withoutFirst = applied(first.state, deleteSelectionEdit(first.state, first.parsed, CellSelection.column(first.parsed.model, 0)));
    expect(tabularSource(withoutFirst)).toBe("\\begin{tabular}{cr}\n B & C \\\\\n 2 & 3 \\\\\n\\end{tabular}");
    const middle = fixtureOf(BASIC);
    const withoutMiddle = applied(middle.state, deleteSelectionEdit(middle.state, middle.parsed, CellSelection.column(middle.parsed.model, 1)));
    expect(tabularSource(withoutMiddle)).toBe("\\begin{tabular}{lr}\nA  & C \\\\\n1  & 3 \\\\\n\\end{tabular}");
  });

  it("refuses to delete a plain cell selection", () => {
    const { state, parsed } = fixtureOf(BASIC);
    expect(deleteSelectionEdit(state, parsed, CellSelection.cell(0, 1))).toBeNull();
  });
});

describe("merging", () => {
  it("merges cells in one row into a multicolumn and unmerges them again", () => {
    const { state, parsed } = fixtureOf(BASIC);
    const selection = new CellSelection({ row: 0, column: 0 }, { row: 0, column: 1 });
    const merged = applied(state, mergeCellsEdit(parsed, selection));
    expect(tabularSource(merged)).toContain("\\multicolumn{2}{c}{A B} & C \\\\");
    const next = fixtureOf(merged);
    const restored = applied(next.state, unmergeCellsEdit(next.parsed, CellSelection.cell(0, 0).expand(next.parsed.model)));
    expect(tabularSource(restored)).toContain("A B & & C \\\\");
  });

  it("uses bordered multicolumn specifications in fully bordered tables", () => {
    const { parsed } = fixtureOf(BORDERED);
    const edit = mergeCellsEdit(parsed, new CellSelection({ row: 1, column: 1 }, { row: 1, column: 2 }));
    expect(edit?.changes[0]).toMatchObject({ insert: "\\multicolumn{2}{|c|}{2 3}" });
  });
});

describe("alignment and width", () => {
  it("rewrites the specification for selected columns", () => {
    const { state, parsed } = fixtureOf(BASIC);
    const result = applied(state, alignmentEdit(state, parsed, CellSelection.column(parsed.model, 1), "right"));
    expect(result).toContain("\\begin{tabular}{lrr}");
  });

  it("rewrites the specification of a merged cell", () => {
    const merged = fixtureOf("\\begin{tabular}{ll}\n\\multicolumn{2}{|c|}{AB} \\\\\n\\end{tabular}");
    const selection = CellSelection.cell(0, 0).expand(merged.parsed.model);
    expect(applied(merged.state, alignmentEdit(merged.state, merged.parsed, selection, "right"))).toContain(
      "\\multicolumn{2}{|r|}{AB}",
    );
  });

  it("turns columns into paragraph columns and back", () => {
    const { state, parsed } = fixtureOf(BASIC);
    const fixed = applied(state, columnWidthEdit(state, parsed, CellSelection.column(parsed.model, 0), { kind: "absolute", value: 2, unit: "cm" }));
    expect(fixed).toContain("\\begin{tabular}{>{\\raggedright\\arraybackslash}p{2cm}cr}");
    const relative = applied(state, columnWidthEdit(state, parsed, CellSelection.column(parsed.model, 1), { kind: "relative", fraction: 0.5, command: "linewidth" }));
    expect(relative).toContain("\\begin{tabular}{l>{\\centering\\arraybackslash}p{0.5\\linewidth}r}");
    const next = fixtureOf(fixed);
    const plain = applied(next.state, removeColumnWidthEdit(next.state, next.parsed, CellSelection.column(next.parsed.model, 0)));
    expect(plain).toContain("\\begin{tabular}{lcr}");
  });
});

describe("border presets", () => {
  it("applies all borders and removes them again", () => {
    const { state, parsed } = fixtureOf(BASIC);
    const bordered = applied(state, borderPresetEdit(state, parsed, "all"));
    expect(tabularSource(bordered)).toBe(BORDERED);
    const next = fixtureOf(bordered);
    expect(next.parsed.model.borderPreset()).toBe("all");
    expect(tabularSource(applied(next.state, borderPresetEdit(next.state, next.parsed, "none")))).toBe(tabularSource(BASIC));
  });

  it("applies booktabs rules", () => {
    const { state, parsed } = fixtureOf(BASIC);
    const result = applied(state, borderPresetEdit(state, parsed, "booktabs"));
    expect(tabularSource(result)).toBe(BOOKTABS);
    expect(fixtureOf(result).parsed.model.borderPreset()).toBe("booktabs");
  });

  it("converts between presets and strips multicolumn borders", () => {
    const { state, parsed } = fixtureOf(
      "\\begin{tabular}{|l|l|}\n\\hline\n\\multicolumn{2}{|c|}{AB} \\\\ \\hline\n1 & 2 \\\\ \\hline\n\\end{tabular}",
    );
    const result = applied(state, borderPresetEdit(state, parsed, "booktabs"));
    expect(result).toBe(
      "\\begin{tabular}{ll}\n\\toprule\n\\multicolumn{2}{c}{AB} \\\\ \\midrule\n1 & 2 \\\\ \\bottomrule\n\\end{tabular}",
    );
  });
});

describe("captions and removal", () => {
  it("moves the caption and label above the tabular and back", () => {
    const { state, parsed, environment } = fixtureOf(BASIC);
    const above = applied(state, captionEdit(state, parsed, environment, "above"));
    expect(above).toBe(
      "\\begin{table}\n\\centering\n\\caption{Cap}\n\\label{tab:x}\n\\begin{tabular}{lcr}\nA & B & C \\\\\n1 & 2 & 3 \\\\\n\\end{tabular}\n\\end{table}\n",
    );
    const next = fixtureOf(above);
    expect(applied(next.state, captionEdit(next.state, next.parsed, next.environment, "below"))).toBe(BASIC);
    expect(captionEdit(next.state, next.parsed, next.environment, "above")).toBeNull();
  });

  it("adds a caption with a label when the table has none", () => {
    const { state, parsed, environment } = fixtureOf("\\begin{table}\n\\begin{tabular}{l}\nA \\\\\n\\end{tabular}\n\\end{table}\n");
    expect(applied(state, captionEdit(state, parsed, environment, "below"))).toBe(
      "\\begin{table}\n\\begin{tabular}{l}\nA \\\\\n\\end{tabular}\n\\caption{Caption}\n\\label{tab:my_table}\n\\end{table}\n",
    );
  });

  it("removes the caption and its label", () => {
    const { state, parsed, environment } = fixtureOf(BASIC);
    expect(applied(state, captionEdit(state, parsed, environment, "none"))).toBe(
      "\\begin{table}\n\\centering\n\\begin{tabular}{lcr}\nA & B & C \\\\\n1 & 2 & 3 \\\\\n\\end{tabular}\n\\end{table}\n",
    );
  });

  it("refuses caption changes outside a table environment", () => {
    const { state, parsed, environment } = fixtureOf(BOOKTABS);
    expect(captionEdit(state, parsed, environment, "above")).toBeNull();
  });

  it("removes the whole table environment", () => {
    const { state, parsed, environment } = fixtureOf(BASIC);
    expect(applied(state, removeTableEdit(state, parsed, environment))).toBe("");
  });
});

describe("cell content", () => {
  it("writes and clears cells", () => {
    const { state, parsed } = fixtureOf(BASIC);
    expect(tabularSource(applied(state, writeCellEdit(parsed, 0, 1, "X")))).toContain("A & X & C \\\\");
    expect(tabularSource(applied(state, clearCellsEdit(parsed, CellSelection.row(parsed.model, 0))))).toContain(" &  &  \\\\");
  });

  it("escapes characters that would break the table", () => {
    expect(sanitizeCellInput("a & b % c \\\\ d")).toBe("a \\& b \\% c  d");
    expect(sanitizeCellInput("already \\& fine")).toBe("already \\& fine");
  });

  it("keeps line breaks inside nested command arguments", () => {
    const content = String.raw`\shortstack{{one}\\[2pt]two\\three}`;
    expect(sanitizeCellInput(content)).toBe(content);
    expect(sanitizeCellInput(String.raw`\{one\\two\}`)).toBe(String.raw`\{onetwo\}`);
    expect(sanitizeCellInput(String.raw`\shortstack{\{one\}\\two}\\`))
      .toBe(String.raw`\shortstack{\{one\}\\two}`);
  });
});
