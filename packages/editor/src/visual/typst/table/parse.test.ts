import { beforeAll, describe, expect, it } from "vitest";
import { loadTypstParser } from "../../../typst";
import { tableOf } from "./test-support";

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

function cellTexts(doc: string): string[][] {
  const { table } = tableOf(doc);
  if (!table) throw new Error("the table did not parse");
  return table.parsed.model.rows.map((row) => row.cells.map((cell) => cell.content));
}

describe("parseTypstTable", () => {
  it("reads columns, alignment, the header and the body cells", () => {
    const { state, table } = tableOf(TABLE);
    expect(table).not.toBeNull();
    if (!table) return;
    expect(table.columnCount).toBe(2);
    expect(table.headerRow).toBe(true);
    expect(table.alignments).toEqual(["left", "center"]);
    expect(table.alignEditable).toBe(true);
    expect(table.bordered).toBe(true);
    expect(cellTexts(TABLE)).toEqual([
      ["*A*", "*B*"],
      ["a", "b"],
      ["c", "d"],
    ]);
    const cell = table.parsed.model.rows[2].cells[1];
    expect(state.sliceDoc(cell.from, cell.to)).toBe("d");
    expect(table.parsed.model.columns.map((column) => column.alignment)).toEqual(["left", "center"]);
  });

  it("reads single-line tables, numeric and array column specs", () => {
    expect(cellTexts("#table(columns: 3, [a], [b], [c])")).toEqual([["a", "b", "c"]]);
    expect(cellTexts("#table(columns: (1fr, auto), [a], [], [c], [d])")).toEqual([
      ["a", ""],
      ["c", "d"],
    ]);
    expect(cellTexts("#table([only], [one])")).toEqual([["only"], ["one"]]);
  });

  it("maps alignment values to the grid", () => {
    expect(tableOf("#table(columns: 2, align: center + horizon, [a], [b])").table?.alignments).toEqual([
      "center",
      "center",
    ]);
    expect(tableOf("#table(columns: 3, align: (right, left), [a], [b], [c])").table?.alignments).toEqual([
      "right",
      "left",
      "right",
    ]);
    const computed = tableOf("#table(columns: 2, align: (x, y) => left, [a], [b])").table;
    expect(computed?.alignEditable).toBe(false);
  });

  it("draws only explicit rules when the stroke is none", () => {
    const { table } = tableOf("#table(columns: 1, stroke: none, [a], table.hline(), [b])");
    expect(table?.bordered).toBe(false);
    expect(table?.parsed.model.rows.map((row) => row.rulesAbove)).toEqual([[], ["hline"]]);
  });

  it.each([
    ["merged cells", "#table(columns: 2, table.cell(colspan: 2)[x], [a], [b])"],
    ["computed cells", "#table(columns: 2, ..range(4).map(str))"],
    ["a partial last row", "#table(columns: 2, [a], [b], [c])"],
    ["computed columns", "#table(columns: (1fr,) * 2, [a], [b])"],
    ["trailing content blocks", "#table(columns: 1)[a][b]"],
    ["non-content cells", '#table(columns: 1, image("a.png"))'],
    ["a short header", "#table(columns: 2, table.header([a]), [b], [c])"],
    ["vertical lines", "#table(columns: 2, table.vline(x: 1), [a], [b])"],
    ["a footer", "#table(columns: 1, [a], table.footer([b]))"],
    ["an unclosed call", "#table(columns: 2, [a], [b]"],
  ])("falls back to source for %s", (_name, doc) => {
    expect(tableOf(doc).table).toBeNull();
  });
});
