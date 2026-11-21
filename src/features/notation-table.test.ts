import { beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  insertAtCursor: vi.fn(),
  insertUsepackage: vi.fn(async (_main: string, _name: string, _options: string) => "editor"),
  mainDoc: "main.tex" as string | null,
  texts: {} as Record<string, string>,
  info: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("@/components/editor/cm/controller", () => ({ insertAtCursor: mocks.insertAtCursor }));
vi.mock("@/components/packages/latex-document", () => ({
  insertUsepackage: mocks.insertUsepackage,
  latexMainDocument: () => mocks.mainDoc,
}));
vi.mock("@/lib/toast", () => ({ toast: { info: mocks.info }, notifyError: mocks.notifyError }));
vi.mock("./document-insights-load", () => ({
  projectTexts: (pattern: RegExp) => Object.fromEntries(Object.entries(mocks.texts).filter(([path]) => pattern.test(path))),
}));

import { insertNotationTable, notationTableLatex } from "./notation-table";

const TABLE = [
  "\\begin{table}[htbp]",
  "  \\centering",
  "  \\caption{Notation}",
  "  \\begin{tabular}{ll}",
  "    \\toprule",
  "    Symbol & Meaning \\\\",
  "    \\midrule",
  "    $\\mathbf{n}$ & Surface normal at each pixel \\\\",
  "    $N$ & Number of images \\\\",
  "    \\bottomrule",
  "  \\end{tabular}",
  "\\end{table}",
  "",
].join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mainDoc = "main.tex";
  mocks.insertUsepackage.mockImplementation(async () => "editor");
  mocks.texts = {
    "sections/method.tex": "where $N$ is the number of light directions.\n",
    "main.tex": [
      "\\documentclass{article}",
      "\\begin{document}",
      "Let $\\mathbf{n}$ be the surface normal at each pixel, and $N$ denotes the number of images.",
      "\\input{sections/method}",
      "\\end{document}",
    ].join("\n"),
    "refs.bib": "@misc{a, note = {where $q$ is the bib note}}",
  };
});

describe("notationTableLatex", () => {
  it("writes a booktabs table with the symbols in math mode", () => {
    expect(
      notationTableLatex([
        { symbol: "\\mathbf{n}", meaning: "the surface normal at each pixel" },
        { symbol: "N", meaning: "the number of images" },
      ]),
    ).toBe(TABLE);
  });

  it("falls back to plain rules without booktabs", () => {
    const table = notationTableLatex([{ symbol: "\\lambda", meaning: "a weight" }], false);
    expect(table).toContain("\\hline\n    Symbol & Meaning \\\\\n    \\hline\n    $\\lambda$ & Weight \\\\");
    expect(table).not.toContain("\\toprule");
  });
});

describe("insertNotationTable", () => {
  it("loads booktabs in the main document and inserts the table at the cursor", async () => {
    await insertNotationTable();
    expect(mocks.insertUsepackage).toHaveBeenCalledWith("main.tex", "booktabs", "");
    expect(mocks.insertAtCursor).toHaveBeenCalledWith(TABLE);
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("uses plain rules when the main document has no preamble", async () => {
    mocks.insertUsepackage.mockImplementation(async () => "no-preamble");
    await insertNotationTable();
    expect(mocks.insertAtCursor).toHaveBeenCalledWith(expect.stringContaining("\\hline"));
  });

  it("says so when the project defines no symbols", async () => {
    mocks.texts = { "main.tex": "\\begin{document}\nWe write $x$, the input.\n\\end{document}" };
    await insertNotationTable();
    expect(mocks.info).toHaveBeenCalledWith(enShell.commands.notationTable.empty);
    expect(mocks.insertUsepackage).not.toHaveBeenCalled();
    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
  });

  it("reports a failed preamble write and inserts nothing", async () => {
    const failure = new Error("disk full");
    mocks.insertUsepackage.mockImplementation(async () => {
      throw failure;
    });
    await insertNotationTable();
    expect(mocks.notifyError).toHaveBeenCalledWith("insert notation table", failure);
    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
  });

  it("does nothing without a project", async () => {
    mocks.mainDoc = null;
    await insertNotationTable();
    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalled();
  });
});
