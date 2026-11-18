// @vitest-environment jsdom

import { act, render, screen, within } from "@testing-library/react";
import * as XLSX from "xlsx";
import { afterEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import "@/components/notes/tests/setup";

const tauri = vi.hoisted(() => ({ readFileBase64: vi.fn() }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readFileBase64: tauri.readFileBase64,
}));

import { SheetFilePreview } from "./SheetFilePreview";

const table = enNotes.blocks.table;

function open(path: string, content: string) {
  act(() => useFilesStore.setState({ files: { [path]: { content, dirty: false } } } as never));
}

function workbookBase64(rows: (string | number)[][]): string {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Results");
  return Buffer.from(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer).toString("base64");
}

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
    tauri.readFileBase64.mockResolvedValue(workbookBase64([["model", "bleu"], ["Transformer", 28.4]]));
    render(<SheetFilePreview projectId="p1" path="data/results.xlsx" workbook />);
    expect(await screen.findByText("Transformer")).toBeInTheDocument();
    expect(tauri.readFileBase64).toHaveBeenCalledWith("p1", "data/results.xlsx");
  });

  it("says why a workbook cannot be shown", async () => {
    tauri.readFileBase64.mockRejectedValue(new Error("denied"));
    render(<SheetFilePreview projectId="p1" path="broken.xlsx" workbook />);
    expect(await screen.findByText(table.unreadable.replace("{{path}}", "broken.xlsx"))).toBeInTheDocument();
  });
});
