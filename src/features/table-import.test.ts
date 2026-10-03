import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

const mocks = vi.hoisted(() => ({
  readPickedFileBase64: vi.fn(),
  registerPickedFileForE2E: vi.fn(),
  writeProjectBytes: vi.fn(),
  refreshTree: vi.fn(),
  notifyProjectFilesChanged: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  readPickedFileBase64: mocks.readPickedFileBase64,
  registerPickedFileForE2E: mocks.registerPickedFileForE2E,
  writeProjectBytes: mocks.writeProjectBytes,
}));
vi.mock("@/lib/cross-window", () => ({
  notifyProjectFilesChanged: mocks.notifyProjectFilesChanged,
}));
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ projectId: "paper", refreshTree: mocks.refreshTree }) },
}));
vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, read: vi.fn(actual.read) };
});

import {
  MAX_TABLE_COLUMNS,
  MAX_TABLE_CHARACTERS,
  MAX_TABLE_ROWS,
  emitLinkedTable,
  emitTable,
  hasValidTableLabel,
  planLinkedTable,
  readTableFile,
  readTableRows,
  writeLinkedTableData,
  type TableFile,
} from "./table-import";

function csvBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function workbookBase64(sheet: XLSX.WorkSheet, bookType: "xlsx" | "xls" = "xlsx"): string {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Results");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Other sheet"]]), "Notes");
  return XLSX.write(workbook, { type: "base64", bookType });
}

describe("readTableRows", () => {
  it("parses CSV with quoted commas through the backend read", async () => {
    mocks.readPickedFileBase64.mockResolvedValue(
      csvBase64('Method,Note\nours,"beats, the rest"\n'),
    );
    const rows = await readTableRows("/tmp/results.csv");
    expect(rows).toEqual([
      ["Method", "Note"],
      ["ours", "beats, the rest"],
    ]);
  });

  it("throws the backend error for oversized files", async () => {
    mocks.readPickedFileBase64.mockRejectedValue(
      new Error("that file is larger than the 16 MB table-import limit"),
    );
    await expect(readTableRows("/tmp/huge.csv")).rejects.toThrow(/16 MB/);
  });

  it.each(["xlsx", "xls"] as const)("imports the first %s sheet with cached formula results and merged cells", async (extension) => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Metric", "Value", "Note"],
      ["Mean", 2.5, 'comma, tab\t and "quotes"\nnext line'],
      ["Merged", null, null],
    ]);
    sheet.B2.f = "SUM(1,1.5)";
    sheet["!merges"] = [XLSX.utils.decode_range("A3:C3")];
    mocks.readPickedFileBase64.mockResolvedValue(workbookBase64(sheet, extension));

    await expect(readTableRows(`/tmp/results.${extension.toUpperCase()}`)).resolves.toEqual([
      ["Metric", "Value", "Note"],
      ["Mean", "2.5", 'comma, tab\t and "quotes"\nnext line'],
      ["Merged", "", ""],
    ]);
    expect(mocks.readPickedFileBase64).toHaveBeenCalledWith(`/tmp/results.${extension.toUpperCase()}`);
  });

  it("imports an empty worksheet as an empty table", async () => {
    mocks.readPickedFileBase64.mockResolvedValue(workbookBase64(XLSX.utils.aoa_to_sheet([])));
    await expect(readTableRows("/tmp/empty.xlsx")).resolves.toEqual([]);
  });

  it.each([
    ["rows", MAX_TABLE_ROWS, 0],
    ["columns", 0, MAX_TABLE_COLUMNS],
  ] as const)("rejects an XLSX sheet with too many %s before expanding its sparse range", async (_dimension, row, column) => {
    const lastCell = XLSX.utils.encode_cell({ r: row, c: column });
    const sheet: XLSX.WorkSheet = {
      A1: { t: "s", v: "First" },
      [lastCell]: { t: "s", v: "Last" },
      "!ref": `A1:${lastCell}`,
    };
    mocks.readPickedFileBase64.mockResolvedValue(workbookBase64(sheet));
    const expand = vi.spyOn(XLSX.utils, "sheet_to_csv");
    await expect(readTableRows("/tmp/oversized.xlsx")).rejects.toThrow(/Import a smaller range/);
    expect(expand).not.toHaveBeenCalled();
  });

  it("explains when a malformed workbook has no readable worksheet", async () => {
    vi.mocked(XLSX.read).mockReturnValueOnce({ SheetNames: [], Sheets: {} });
    mocks.readPickedFileBase64.mockResolvedValue(csvBase64("malformed workbook"));
    await expect(readTableRows("/tmp/malformed.xlsx")).rejects.toThrow("no sheets to import");
  });

  it("rejects excessive cell text even when the row and column counts are small", async () => {
    mocks.readPickedFileBase64.mockResolvedValue(csvBase64("x".repeat(MAX_TABLE_CHARACTERS + 1)));
    await expect(readTableRows("/tmp/large-cell.csv")).rejects.toThrow("more than 2 MB of text");
  });

  it("rejects table dimensions that would freeze the preview", async () => {
    mocks.readPickedFileBase64.mockResolvedValue(
      csvBase64(`${"a".repeat(1)}\n`.repeat(MAX_TABLE_ROWS + 1)),
    );
    await expect(readTableRows("/tmp/long.csv")).rejects.toThrow(/more than 10,000 rows/);

    mocks.readPickedFileBase64.mockResolvedValue(
      csvBase64(Array.from({ length: MAX_TABLE_COLUMNS + 1 }, (_, index) => String(index)).join(",")),
    );
    await expect(readTableRows("/tmp/wide.csv")).rejects.toThrow(/more than 100 columns/);
  });

  it("only accepts safe LaTex labels", () => {
    expect(hasValidTableLabel("tab:results.v2")).toBe(true);
    expect(hasValidTableLabel("tab:x}\\input{bad}")).toBe(false);
  });
});

describe("emitTable", () => {
  it("routes to the typst emitter and keeps escapes", () => {
    const source = emitTable(
      [
        ["A", "B"],
        ["x&y", "50%"],
      ],
      { header: true, target: "typst" },
    );
    expect(source).toContain("#table(");
    expect(source).toContain("[x&y]"); // & is not special in Typst markup
    expect(source).toContain("[50%]"); // % is not special in Typst markup
  });

  it("passes a caption and label through to the typst figure", () => {
    const source = emitTable(
      [
        ["A", "B"],
        ["x", "1"],
      ],
      { header: true, target: "typst", caption: "Scores", label: "tab:scores" },
    );
    expect(source.startsWith("#figure(\n  table(\n    columns: 2,\n    align: (left, right),")).toBe(true);
    expect(source).toContain("  caption: [Scores],\n) <tab:scores>");
  });

  it("routes to the latex emitter with escaping", () => {
    const source = emitTable(
      [
        ["A", "B"],
        ["x&y", "50%"],
      ],
      { header: true, target: "latex", label: "tab:x" },
    );
    expect(source).toContain("\\begin{tabular}{lr}"); // 50% infers as numeric
    expect(source).toContain("x\\&y & 50\\%");
    expect(source).toContain("\\label{tab:x}");
  });
});

describe("readTableFile", () => {
  it("keeps the decoded text and the delimiter kind for CSV and TSV", async () => {
    mocks.readPickedFileBase64.mockResolvedValue(csvBase64("\uFEFFa,b\n1,2\n"));
    await expect(readTableFile("/tmp/x.csv")).resolves.toEqual({
      rows: [["a", "b"], ["1", "2"]],
      format: "csv",
      text: "a,b\n1,2\n",
    });
    mocks.readPickedFileBase64.mockResolvedValue(csvBase64("a\tb\n"));
    await expect(readTableFile("/tmp/x.TSV")).resolves.toMatchObject({ format: "tsv", text: "a\tb\n" });
  });

  it("reads JSON records with every key as a header column", async () => {
    mocks.readPickedFileBase64.mockResolvedValue(csvBase64('[{"a":1},{"b":"x"}]'));
    await expect(readTableFile("/tmp/runs.json")).resolves.toEqual({
      rows: [["a", "b"], ["1", ""], ["", "x"]],
      format: "json",
      jsonShape: "records",
      text: '[{"a":1},{"b":"x"}]',
    });
  });

  it("explains when a JSON file is not a list of records or rows", async () => {
    mocks.readPickedFileBase64.mockResolvedValue(csvBase64('{"a":1}'));
    await expect(readTableFile("/tmp/config.json")).rejects.toThrow(/list of records or rows/);
  });

  it("marks a workbook as a spreadsheet with no text to copy", async () => {
    mocks.readPickedFileBase64.mockResolvedValue(workbookBase64(XLSX.utils.aoa_to_sheet([["a"], [1]])));
    await expect(readTableFile("/tmp/book.xlsx")).resolves.toEqual({
      rows: [["a"], ["1"]],
      format: "spreadsheet",
      text: null,
    });
  });
});

describe("planLinkedTable", () => {
  const tree = [
    { path: "data", name: "data", is_dir: true },
    { path: "data/results.csv", name: "results.csv", is_dir: false },
  ] as never[];

  it("copies a CSV next to the others in data/ and points the source at it from the document", () => {
    const file: TableFile = { rows: [["a"], ["1"]], format: "csv", text: "a\n1\n" };
    expect(planLinkedTable(file, "results.csv", tree, "sections/results.typ")).toEqual({
      dataPath: "data/results-2.csv",
      content: "a\n1\n",
      source: { format: "csv", path: "../data/results-2.csv" },
    });
  });

  it("passes the tab delimiter for TSV files and for CSV files that use tabs", () => {
    const tsv: TableFile = { rows: [["a", "b"]], format: "tsv", text: "a\tb\n" };
    expect(planLinkedTable(tsv, "Run Log.tsv", [], "main.typ")).toEqual({
      dataPath: "data/Run-Log.tsv",
      content: "a\tb\n",
      source: { format: "csv", path: "data/Run-Log.tsv", delimiter: "\t" },
    });
    const tabbed: TableFile = { rows: [["a", "b"]], format: "csv", text: "a\tb\n" };
    expect(planLinkedTable(tabbed, "x.csv", [], "main.typ").source.delimiter).toBe("\t");
  });

  it("converts a workbook to CSV on import", () => {
    const book: TableFile = { rows: [["Name", "Note"], ["A", "x, y"]], format: "spreadsheet", text: null };
    expect(planLinkedTable(book, "Book1.xlsx", [], "main.typ")).toEqual({
      dataPath: "data/Book1.csv",
      content: 'Name,Note\nA,"x, y"\n',
      source: { format: "csv", path: "data/Book1.csv" },
    });
  });

  it.each([
    [String.raw`C:\Users\me\-.Run..2026-.csv`, "data/Run..2026.csv"],
    ["../in/--...--.csv", "data/table.csv"],
    [".hidden.csv", "data/hidden.csv"],
    ["a-.-.-.-.-b.csv", "data/a-.-.-.-.-b.csv"],
    ["  Spaces & más!  .csv", "data/Spaces-más.csv"],
    ["-.-.-x-.-.-.csv", "data/x.csv"],
    ["noext", "data/noext.csv"],
  ])("cleans the file name %j into %j", (fileName, dataPath) => {
    const file: TableFile = { rows: [["a"]], format: "csv", text: "a\n" };
    expect(planLinkedTable(file, fileName, [], "main.typ").dataPath).toBe(dataPath);
  });

  it("keeps JSON as JSON with its shape", () => {
    const json: TableFile = { rows: [["a"], ["1"]], format: "json", text: "[[1]]", jsonShape: "rows" };
    expect(planLinkedTable(json, "grid.json", [], "main.typ")).toEqual({
      dataPath: "data/grid.json",
      content: "[[1]]",
      source: { format: "json", path: "data/grid.json", shape: "rows" },
    });
  });
});

describe("linked tables", () => {
  it("emits the compile-time reader for the planned file", () => {
    const source = emitLinkedTable([["A"], ["1"]], {
      header: true,
      label: "tab:x",
      source: { format: "csv", path: "data/x.csv" },
    });
    expect(source.split("\n")[0]).toBe('#let x-data = csv("data/x.csv")');
    expect(source).toContain(") <tab:x>");
  });

  it("writes the data file as UTF-8 and refreshes the file tree", async () => {
    mocks.refreshTree.mockResolvedValue(true);
    await writeLinkedTableData("paper", { dataPath: "data/é.csv", content: "é\n", source: { format: "csv", path: "data/é.csv" } });
    expect(mocks.writeProjectBytes).toHaveBeenCalledWith("paper", "data/é.csv", btoa("\u00c3\u00a9\n"));
    expect(mocks.refreshTree).toHaveBeenCalled();
    expect(mocks.notifyProjectFilesChanged).toHaveBeenCalledWith("paper", ["data/é.csv"]);
  });
});
