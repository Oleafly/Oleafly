// @vitest-environment jsdom

import { act, render, screen, within } from "@testing-library/react";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import "@/components/notes/tests/setup";

const tauri = vi.hoisted(() => ({
  projectFileSizes: vi.fn<(projectId: string, paths: readonly string[]) => Promise<Record<string, number>>>(),
  readProjectBytes: vi.fn<(projectId: string, path: string) => Promise<ArrayBuffer>>(),
}));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  projectFileSizes: tauri.projectFileSizes,
  readProjectBytes: tauri.readProjectBytes,
}));
const { LIMIT } = vi.hoisted(() => ({ LIMIT: 64 * 1024 }));
vi.mock("@/components/notes/table-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/notes/table-data")>()),
  TABLE_MAX_BYTES: LIMIT,
}));
const log = vi.hoisted(() => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/log", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/log")>()), ...log }));

import { SheetFilePreview } from "./SheetFilePreview";

const table = enNotes.blocks.table;

function open(path: string, content: string) {
  act(() => useFilesStore.setState({ files: { [path]: { content, dirty: false } } } as never));
}

function workbookBytes(rows: (string | number)[][]): ArrayBuffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Results");
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

beforeEach(() => {
  tauri.projectFileSizes.mockImplementation(async (_id, paths) => Object.fromEntries(paths.map((path) => [path, 512])));
});

afterEach(() => {
  vi.clearAllMocks();
  useFilesStore.setState({ files: {} } as never);
});

describe("SheetFilePreview", () => {
  it("shows a CSV file as a table with its header, and follows edits", () => {
    open("results.csv", "model,bleu\nTransformer,28.4\nRNN,24.6\n");
    render(<SheetFilePreview projectId="p1" path="results.csv" />);
    const grid = screen.getByRole("table");
    expect(within(grid).getByText("model")).toBeInTheDocument();
    expect(within(grid).getByText("RNN")).toBeInTheDocument();

    open("results.csv", "model,bleu\nTransformer,28.4\nRNN,24.6\nConvS2S,26.4\n");
    expect(within(grid).getByText("ConvS2S")).toBeInTheDocument();
  });

  it("splits a TSV file on tabs", () => {
    open("runs.tsv", "run\tnote\nfirst\twarm start\n");
    render(<SheetFilePreview projectId="p1" path="runs.tsv" />);
    expect(within(screen.getByRole("table")).getByText("warm start")).toBeInTheDocument();
  });

  it("explains an empty file instead of drawing an empty table", () => {
    open("empty.csv", "");
    render(<SheetFilePreview projectId="p1" path="empty.csv" />);
    expect(screen.getByText(table.empty)).toBeInTheDocument();
  });

  it("reads the first sheet of a workbook from the project", async () => {
    tauri.readProjectBytes.mockResolvedValue(workbookBytes([["model", "bleu"], ["Transformer", 28.4]]));
    render(<SheetFilePreview projectId="p1" path="data/results.xlsx" workbook />);
    expect(await screen.findByText("Transformer")).toBeInTheDocument();
    expect(tauri.projectFileSizes).toHaveBeenCalledWith("p1", ["data/results.xlsx"]);
    expect(tauri.readProjectBytes).toHaveBeenCalledWith("p1", "data/results.xlsx");
  });

  it("says why a workbook cannot be shown, and logs it", async () => {
    const denied = new Error("denied");
    tauri.readProjectBytes.mockRejectedValue(denied);
    render(<SheetFilePreview projectId="p1" path="broken.xlsx" workbook />);
    expect(await screen.findByText(table.unreadable.replace("{{path}}", "broken.xlsx"))).toBeInTheDocument();
    expect(log.logError).toHaveBeenCalledWith("open a spreadsheet", denied);
  });

  it("does not read a workbook over the table limit", async () => {
    tauri.projectFileSizes.mockResolvedValue({ "big.xlsx": LIMIT + 1 });
    render(<SheetFilePreview projectId="p1" path="big.xlsx" workbook />);
    expect(await screen.findByText(enNotes.blocks.table.tooLarge)).toBeInTheDocument();
    expect(tauri.readProjectBytes).not.toHaveBeenCalled();
    expect(log.logError).not.toHaveBeenCalled();
  });

  it("does not parse a text sheet over the table limit", () => {
    open("big.csv", `a,b\n${"1,2\n".repeat(LIMIT / 4 + 1)}`);
    render(<SheetFilePreview projectId="p1" path="big.csv" />);
    expect(screen.getByText(enNotes.blocks.table.tooLarge)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("counts the bytes of a text sheet, not its characters", () => {
    open("wide.csv", `a\n${"é".repeat(LIMIT / 2 + 1)}\n`);
    render(<SheetFilePreview projectId="p1" path="wide.csv" />);
    expect(screen.getByText(enNotes.blocks.table.tooLarge)).toBeInTheDocument();
  });
});
