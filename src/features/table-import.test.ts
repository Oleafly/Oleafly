import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

const mocks = vi.hoisted(() => ({
  readPickedFileBase64: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  readPickedFileBase64: mocks.readPickedFileBase64,
}));
vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, read: vi.fn(actual.read) };
});

import {
  MAX_TABLE_COLUMNS,
  MAX_TABLE_CHARACTERS,
  MAX_TABLE_ROWS,
  emitTable,
  hasValidTableLabel,
  readTableRows,
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
