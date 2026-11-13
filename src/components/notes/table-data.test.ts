import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { BlockFileTooLargeError } from "./note-blocks";
import {
  buildTable,
  columnKeyCache,
  columnKeys,
  detectTypes,
  filterRows,
  loadTableFile,
  parseBoolean,
  parseDate,
  parseNumber,
  pickSheet,
  readSpreadsheetRows,
  sortRows,
  spreadsheetCellText,
  summarizeColumn,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  type TableData,
  TableFileError,
  tableDelimiter,
  tableSource,
} from "./table-data";

function textUrl(text: string): string {
  return `data:text/csv;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(text)))}`;
}

function bytesUrl(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:application/octet-stream;base64,${btoa(binary)}`;
}

function workbook(sheets: Record<string, unknown[][]>): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

function table(header: string[], rows: string[][]): TableData {
  const result = buildTable([header, ...rows]);
  if (!result.ok) throw new Error("bad table");
  return result.table;
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

describe("delimiters", () => {
  it("follows the fence and reads spreadsheet pastes in csv blocks", () => {
    expect(tableDelimiter("tsv", "a,b")).toBe("\t");
    expect(tableDelimiter("csv", "a\tb")).toBe("\t");
    expect(tableDelimiter("csv", "\n\na\tb\n1\t2")).toBe("\t");
    expect(tableDelimiter("csv", '"a\tb",c')).toBe(",");
    expect(tableDelimiter("csv", "a,b\n1\t2")).toBe(",");
    expect(tableDelimiter(undefined, "")).toBe(",");
  });
});

describe("values", () => {
  it.each([
    ["42", 42],
    ["-3.5", -3.5],
    ["+.5", 0.5],
    ["6.02e23", 6.02e23],
    ["1E-3", 0.001],
    ["−2", -2],
    [" 7 ", 7],
  ])("reads %s as a number", (text, value) => {
    expect(parseNumber(text)).toBe(value);
  });

  it.each(["1,234", "abc", "", "1e999", "1.2.3", "--1"])("does not read %s as a number", (text) => {
    expect(parseNumber(text)).toBeNull();
  });

  it("reads thousands separators only when asked", () => {
    expect(parseNumber("1,234.5", true)).toBe(1234.5);
    expect(parseNumber("12,34", true)).toBeNull();
  });

  it("reads booleans", () => {
    expect(parseBoolean("TRUE")).toBe(1);
    expect(parseBoolean("yes")).toBe(1);
    expect(parseBoolean("False")).toBe(0);
    expect(parseBoolean("no")).toBe(0);
    expect(parseBoolean("maybe")).toBeNull();
  });

  it("reads ISO dates and times with zones", () => {
    expect(parseDate("2024-03-01")).toBe(Date.UTC(2024, 2, 1));
    expect(parseDate("2024-03-01 10:30")).toBe(Date.UTC(2024, 2, 1, 10, 30));
    expect(parseDate("2024-03-01T10:30:15.25Z")).toBe(Date.UTC(2024, 2, 1, 10, 30, 15, 250));
    expect(parseDate("2024-03-01T10:30:00+05:30")).toBe(Date.UTC(2024, 2, 1, 5, 0));
    expect(parseDate("2024-03-01T10:30:00-0100")).toBe(Date.UTC(2024, 2, 1, 11, 30));
  });

  it.each(["2024-02-30", "2024-13-01", "2024-00-10", "2024-01-00", "2024-01-01T24:00", "2024-01-01T10:60", "2024-01-01T10:00:61", "01/02/2024"])(
    "rejects %s as a date",
    (text) => {
      expect(parseDate(text)).toBeNull();
    },
  );

  it("detects column types and ignores empty cells", () => {
    const rows = [
      ["1", "true", "2024-01-01", "a", "", "3"],
      ["-2.5", "no", "2024-01-02", "1", "", "x"],
      ["", "", "", "", "", ""],
    ];
    expect(detectTypes(rows, 6)).toEqual(["number", "boolean", "date", "text", "text", "text"]);
  });

  it("detects grouped numbers when thousands separators are on", () => {
    expect(detectTypes([["1,234"], ["5"]], 1, true)).toEqual(["number"]);
    expect(detectTypes([["1,234"], ["5"]], 1)).toEqual(["text"]);
  });
});

describe("buildTable", () => {
  it("pads ragged rows to the widest row", () => {
    const result = buildTable([["a"], ["1", "2"], ["3"]]);
    expect(result).toEqual({
      ok: true,
      table: {
        header: ["a", ""],
        rows: [
          ["1", "2"],
          ["3", ""],
        ],
        types: ["number", "number"],
        thousands: false,
        truncated: false,
      },
    });
  });

  it("reports a table without data rows", () => {
    expect(buildTable([])).toEqual({ ok: false, problem: "empty" });
    expect(buildTable([["a", "b"]])).toEqual({ ok: false, problem: "empty" });
  });

  it("reports too many columns", () => {
    expect(buildTable([Array(TABLE_MAX_COLUMNS + 1).fill("x"), ["1"]])).toEqual({ ok: false, problem: "columns" });
  });

  it("keeps the first rows of a very long table", () => {
    const rows = [["n"], ...Array.from({ length: TABLE_MAX_ROWS + 1 }, (_, index) => [String(index)])];
    const result = buildTable(rows);
    expect(result.ok && result.table.rows.length).toBe(TABLE_MAX_ROWS);
    expect(result.ok && result.table.truncated).toBe(true);
  });
});

describe("tableSource", () => {
  it("reads inline data with an optional thousands switch", () => {
    expect(tableSource("a,b\n1,2")).toEqual({ kind: "inline", text: "a,b\n1,2", thousands: false });
    expect(tableSource("thousands: yes\na\n1,000")).toEqual({ kind: "inline", text: "a\n1,000", thousands: true });
  });

  it("reads file sources with a sheet", () => {
    expect(tableSource("path: ./assets/results.csv")).toEqual({
      kind: "file",
      path: "assets/results.csv",
      format: "csv",
      sheet: null,
      thousands: false,
    });
    expect(tableSource("path: data/r.TSV")).toMatchObject({ format: "tsv" });
    expect(tableSource("path: book.xlsx\nsheet: Runs")).toMatchObject({ format: "spreadsheet", sheet: "Runs" });
    expect(tableSource("path: book.xls\nsheet:")).toMatchObject({ format: "spreadsheet", sheet: null });
  });

  it("rejects paths outside the note and other file types", () => {
    expect(tableSource("path: ../secret.csv")).toEqual({ kind: "invalid", problem: "path", path: "../secret.csv" });
    expect(tableSource("path: /etc/passwd")).toMatchObject({ kind: "invalid", problem: "path" });
    expect(tableSource("path: notes.txt")).toEqual({ kind: "invalid", problem: "unsupported", path: "notes.txt" });
  });
});

describe("spreadsheets", () => {
  it("picks a sheet by exact name, then ignoring case, else the first", () => {
    expect(pickSheet(["One", "Two", "two"], "two")).toBe("two");
    expect(pickSheet(["One", "Two"], "TWO")).toBe("Two");
    expect(pickSheet(["One"], null)).toBe("One");
    expect(pickSheet([], null)).toBeNull();
    expect(pickSheet(["One"], "Other")).toBeNull();
  });

  it("writes cell values as text", () => {
    expect(spreadsheetCellText(0.1 + 0.2)).toBe("0.3");
    expect(spreadsheetCellText(Number.NaN)).toBe("");
    expect(spreadsheetCellText(true)).toBe("TRUE");
    expect(spreadsheetCellText(false)).toBe("FALSE");
    expect(spreadsheetCellText(new Date(Date.UTC(2024, 0, 2)))).toBe("2024-01-02");
    expect(spreadsheetCellText(new Date(Date.UTC(2024, 0, 2, 9, 5)))).toBe("2024-01-02 09:05");
    expect(spreadsheetCellText(new Date(Date.UTC(2024, 0, 2, 9, 5, 7)))).toBe("2024-01-02 09:05:07");
    expect(spreadsheetCellText(new Date(Number.NaN))).toBe("");
    expect(spreadsheetCellText("text")).toBe("text");
    expect(spreadsheetCellText(null)).toBe("");
  });

  it("reads the chosen sheet of a workbook", async () => {
    const bytes = workbook({
      First: [["a"], [1]],
      Runs: [
        ["run", "loss", "ok"],
        [1, 0.5, true],
        [2, 0.25, false],
      ],
    });
    expect(await readSpreadsheetRows(bytes, "runs")).toEqual([
      ["run", "loss", "ok"],
      ["1", "0.5", "TRUE"],
      ["2", "0.25", "FALSE"],
    ]);
    expect(await readSpreadsheetRows(bytes, null)).toEqual([["a"], ["1"]]);
  });

  it("names the sheets when the chosen one is missing", async () => {
    const bytes = workbook({ First: [["a"]], Second: [["b"]] });
    await expect(readSpreadsheetRows(bytes, "Third")).rejects.toMatchObject({
      problem: "sheet",
      sheets: ["First", "Second"],
    });
  });

  it("reads an empty sheet as no rows", async () => {
    expect(await readSpreadsheetRows(workbook({ Empty: [] }), null)).toEqual([]);
  });

  it("rejects sheets wider than the column limit", async () => {
    const bytes = workbook({ Wide: [Array.from({ length: TABLE_MAX_COLUMNS + 1 }, (_, index) => index)] });
    await expect(readSpreadsheetRows(bytes, null)).rejects.toMatchObject({ problem: "columns" });
  });

  it("reports a workbook the reader can't open", async () => {
    await expect(readSpreadsheetRows(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), null)).rejects.toMatchObject({
      problem: "unreadable",
    });
  });
});

describe("loadTableFile", () => {
  it("reads CSV and TSV files", async () => {
    const csv = await loadTableFile(
      { kind: "file", path: "a.csv", format: "csv", sheet: null, thousands: true },
      async () => textUrl('n,label\n"1,200",x\n'),
    );
    expect(csv).toMatchObject({ ok: true, table: { rows: [["1,200", "x"]], types: ["number", "text"] } });
    const tsv = await loadTableFile(
      { kind: "file", path: "a.tsv", format: "tsv", sheet: null, thousands: false },
      async () => textUrl("n\tm\n1\t2\n"),
    );
    expect(tsv).toMatchObject({ ok: true, table: { header: ["n", "m"] } });
  });

  it("reads spreadsheets", async () => {
    const url = bytesUrl(workbook({ Sheet1: [["x"], [3]] }));
    const result = await loadTableFile({ kind: "file", path: "b.xlsx", format: "spreadsheet", sheet: null, thousands: false }, async () => url);
    expect(result).toMatchObject({ ok: true, table: { rows: [["3"]], types: ["number"] } });
  });

  it("reports missing, unreadable and oversized files", async () => {
    const csv = { kind: "file", path: "a.csv", format: "csv", sheet: null, thousands: false } as const;
    const xlsx = { ...csv, path: "a.xlsx", format: "spreadsheet" } as const;
    await expect(loadTableFile(csv, async () => null)).rejects.toBeInstanceOf(TableFileError);
    await expect(loadTableFile(csv, async () => "not a data url")).rejects.toMatchObject({ problem: "unreadable" });
    await expect(loadTableFile(xlsx, async () => "not a data url")).rejects.toMatchObject({ problem: "unreadable" });
    const huge = `data:text/csv;base64,${"A".repeat(9 * 1024 * 1024)}`;
    await expect(loadTableFile(csv, async () => huge)).rejects.toBeInstanceOf(BlockFileTooLargeError);
  });
});

describe("sorting, filtering and summaries", () => {
  const data = table(
    ["name", "score", "ok", "when"],
    [
      ["beta", "10", "yes", "2024-01-03"],
      ["Alpha", "", "no", "2024-01-01"],
      ["gamma 2", "-4", "", ""],
      ["gamma 10", "2.5e1", "yes", "2024-01-02"],
    ],
  );

  it("builds sort keys for each type", () => {
    expect(columnKeys(data, 0)).toEqual(["beta", "Alpha", "gamma 2", "gamma 10"]);
    expect(columnKeys(data, 1)).toEqual([10, null, -4, 25]);
    expect(columnKeys(data, 2)).toEqual([1, 0, null, 1]);
    expect(columnKeys(data, 3)).toEqual([Date.UTC(2024, 0, 3), Date.UTC(2024, 0, 1), null, Date.UTC(2024, 0, 2)]);
  });

  it("caches keys per column", () => {
    const keys = columnKeyCache(data);
    expect(keys(1)).toBe(keys(1));
  });

  it("sorts numbers and text both ways with empty cells last", () => {
    const all = [0, 1, 2, 3];
    expect(sortRows(all, columnKeys(data, 1), "ascending", collator)).toEqual([2, 0, 3, 1]);
    expect(sortRows(all, columnKeys(data, 1), "descending", collator)).toEqual([3, 0, 2, 1]);
    expect(sortRows(all, columnKeys(data, 0), "ascending", collator)).toEqual([1, 0, 2, 3]);
    expect(sortRows(all, columnKeys(data, 0), "descending", collator)).toEqual([3, 2, 0, 1]);
    expect(sortRows(all, [null, null, 1, null], "ascending", collator)).toEqual([2, 0, 1, 3]);
  });

  it("filters rows that match in any column", () => {
    expect(filterRows(data, "")).toEqual([0, 1, 2, 3]);
    expect(filterRows(data, "  GAMMA ")).toEqual([2, 3]);
    expect(filterRows(data, "2024-01-0")).toEqual([0, 1, 3]);
    expect(filterRows(data, "zzz")).toEqual([]);
  });

  it("summarizes the numbers of the shown rows", () => {
    const keys = columnKeys(data, 1);
    expect(summarizeColumn(data, [0, 1, 2, 3], keys, 1)).toEqual({
      count: 3,
      mean: 31 / 3,
      min: -4,
      max: 25,
      minText: "-4",
      maxText: "2.5e1",
    });
    expect(summarizeColumn(data, [1], keys, 1)).toBeNull();
  });
});
