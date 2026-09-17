import { describe, expect, it } from "vitest";
import { TableParseError, isRenderableTable, parseTabular } from "./parse";
import { fixtureOf, stateOf, tabularNodeOf } from "./test-support";

const TABLE = `\\begin{table}[h]
\\centering
\\begin{tabular}{|l|c r|}
\\hline
Name & Value & Note \\\\ \\hline
$x$ & 1 & % trailing
first \\\\[2pt]
\\multicolumn{2}{|c|}{merged} & last \\\\
\\hline
\\end{tabular}
\\caption{A caption}
\\label{tab:sample}
\\end{table}
`;

describe("tabular parsing", () => {
  it("splits rows on line breaks and cells on ampersands", () => {
    const { parsed } = fixtureOf(TABLE);
    const { model } = parsed;
    expect(model.rowCount).toBe(3);
    expect(model.columnCount).toBe(3);
    expect(model.rows[0].cells.map((cell) => cell.content)).toEqual(["Name", "Value", "Note"]);
    expect(model.rows[1].cells.map((cell) => cell.content)).toEqual(["$x$", "1", "first"]);
    expect(parsed.rowSeparators).toHaveLength(3);
    expect(parsed.cellSeparators[0]).toHaveLength(2);
  });

  it("records cell ranges that exclude surrounding whitespace", () => {
    const { state, parsed } = fixtureOf(TABLE);
    const cell = parsed.model.rows[0].cells[1];
    expect(state.sliceDoc(cell.from, cell.to)).toBe("Value");
    const separator = parsed.rowSeparators[1];
    expect(state.sliceDoc(separator.from, separator.to)).toBe("\\\\[2pt]");
  });

  it("attaches rules to the row below them and the final rule to the last row", () => {
    const { parsed } = fixtureOf(TABLE);
    const rows = parsed.model.rows;
    expect(rows[0].rulesAbove).toEqual(["\\hline"]);
    expect(rows[1].rulesAbove).toEqual(["\\hline"]);
    expect(rows[2].rulesAbove).toEqual([]);
    expect(rows[2].rulesBelow).toEqual(["\\hline"]);
    expect(parsed.rows[2].rulesBelow).toHaveLength(1);
  });

  it("reads multicolumn cells with their span and specification", () => {
    const { state, parsed } = fixtureOf(TABLE);
    const merged = parsed.model.rows[2].cells[0];
    expect(merged.content).toBe("merged");
    expect(merged.multiColumn?.span).toBe(2);
    expect(merged.multiColumn?.columns[0].alignment).toBe("center");
    expect(state.sliceDoc(merged.multiColumn!.preamble.from, merged.multiColumn!.preamble.to)).toBe(
      "\\multicolumn{2}{|c|}{",
    );
    expect(state.sliceDoc(merged.multiColumn!.postamble.from, merged.multiColumn!.postamble.to)).toBe("}");
    expect(parsed.model.cellAt(2, 1)).toBe(merged);
    expect(parsed.model.cellBounds(2, 1)).toEqual({ from: 0, to: 1 });
    expect(isRenderableTable(parsed)).toBe(true);
  });

  it("recognises booktabs rules", () => {
    const { parsed } = fixtureOf(
      "\\begin{tabular}{ll}\n\\toprule\nA & B \\\\\n\\midrule\n1 & 2 \\\\\n\\bottomrule\n\\end{tabular}",
    );
    expect(parsed.model.borderPreset()).toBe("booktabs");
  });

  it("recognises fully bordered and border-free tables", () => {
    expect(fixtureOf("\\begin{tabular}{|l|l|}\n\\hline\nA & B \\\\ \\hline\n\\end{tabular}").parsed.model.borderPreset()).toBe(
      "all",
    );
    expect(fixtureOf("\\begin{tabular}{ll}\nA & B \\\\\n\\end{tabular}").parsed.model.borderPreset()).toBe("none");
    expect(fixtureOf("\\begin{tabular}{l|l}\nA & B \\\\\n\\end{tabular}").parsed.model.borderPreset()).toBeNull();
  });

  it("takes the last brace argument as the specification for tabularx", () => {
    const { parsed } = fixtureOf("\\begin{tabularx}{\\textwidth}{lX}\nA & B \\\\\n\\end{tabularx}");
    expect(parsed.model.columns.map((column) => column.content)).toEqual(["l", "X"]);
  });

  it("flags tables whose rows do not match the column count", () => {
    const { parsed } = fixtureOf("\\begin{tabular}{lll}\nA & B \\\\\n\\end{tabular}");
    expect(isRenderableTable(parsed)).toBe(false);
  });

  it("rejects partial rules, nested tables and rules inside a row", () => {
    const docs = [
      "\\begin{tabular}{ll}\nA & B \\\\ \\cline{1-2}\nC & D \\\\\n\\end{tabular}",
      "\\begin{tabular}{l}\n\\begin{tabular}{c}\nx\n\\end{tabular} \\\\\n\\end{tabular}",
      "\\begin{tabular}{ll}\nA & B \\hline \\\\\n\\end{tabular}",
      "\\begin{tabular}{ll}\nA & \\multirow{2}{*}{B} \\\\\n\\end{tabular}",
    ];
    for (const doc of docs) {
      const state = stateOf(doc);
      expect(() => parseTabular(tabularNodeOf(state), state)).toThrow(TableParseError);
    }
  });

  it("reads the caption and label of the enclosing table environment", () => {
    const { state, environment } = fixtureOf(TABLE);
    expect(environment).not.toBeNull();
    expect(state.sliceDoc(environment!.caption!.from, environment!.caption!.to)).toBe("\\caption{A caption}");
    expect(state.sliceDoc(environment!.label!.from, environment!.label!.to)).toBe("\\label{tab:sample}");
  });
});
