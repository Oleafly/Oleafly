import { describe, expect, it } from "vitest";
import { parseNotebook, pickCells, stripAnsi, type NotebookCell } from "./notebook-file";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

function notebook(cells: unknown[], metadata: unknown = { language_info: { name: "Python" } }): string {
  return JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata, cells });
}

function only(text: string): NotebookCell[] {
  const parsed = parseNotebook(text);
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.notebook.cells;
}

function outputs(...items: unknown[]) {
  const [cell] = only(notebook([{ cell_type: "code", source: "x", outputs: items }]));
  if (cell.type !== "code") throw new Error("not code");
  return cell.outputs;
}

describe("notebook files", () => {
  it.each(["", "{", "not json", "[1, 2"])("calls %j invalid JSON", (text) => {
    expect(parseNotebook(text)).toEqual({ ok: false, problem: "json" });
  });

  it.each([
    "null",
    "[]",
    '"text"',
    JSON.stringify({ nbformat: 3, worksheets: [] }),
    JSON.stringify({ nbformat: "4", cells: [] }),
    JSON.stringify({ nbformat: 4, cells: {} }),
    JSON.stringify({ nbformat: 4 }),
  ])("calls %j a format it cannot show", (text) => {
    expect(parseNotebook(text)).toEqual({ ok: false, problem: "format" });
  });

  it("reads markdown, raw and code cells with joined source lines", () => {
    const cells = only(
      notebook([
        { cell_type: "markdown", source: ["# Loss\n", "Run $x^2$"] },
        { cell_type: "raw", source: "raw text" },
        { cell_type: "code", source: ["import numpy\n", 42, "print(1)"], execution_count: 3, outputs: [] },
        { cell_type: "code", source: "pass", execution_count: null },
        { cell_type: "heading", source: "old" },
        "not a cell",
        null,
      ]),
    );
    expect(cells).toEqual([
      { type: "markdown", source: "# Loss\nRun $x^2$" },
      { type: "raw", source: "raw text" },
      { type: "code", source: "import numpy\nprint(1)", count: 3, outputs: [] },
      { type: "code", source: "pass", count: null, outputs: [] },
    ]);
  });

  it("treats a missing source as empty", () => {
    expect(only(notebook([{ cell_type: "markdown" }]))).toEqual([{ type: "markdown", source: "" }]);
  });

  it.each([
    [{ language_info: { name: " Python " }, kernelspec: { language: "r" } }, "python"],
    [{ kernelspec: { language: "R" } }, "r"],
    [{ language_info: { name: 3 }, kernelspec: { language: "julia" } }, "julia"],
    [{ language_info: "python" }, ""],
    [{}, ""],
    [null, ""],
  ])("reads the language from %j", (metadata, language) => {
    const parsed = parseNotebook(notebook([], metadata));
    expect(parsed.ok && parsed.notebook.language).toBe(language);
  });

  it("reads stream output, stdout by default, without terminal colours", () => {
    expect(
      outputs(
        { output_type: "stream", name: "stderr", text: [`${ESC}[31mwarn`, "ing\n"] },
        { output_type: "stream", text: "plain" },
      ),
    ).toEqual([
      { type: "stream", name: "stderr", text: "warning\n" },
      { type: "stream", name: "stdout", text: "plain" },
    ]);
  });

  it("prefers PNG, then JPEG, then SVG over text", () => {
    expect(
      outputs(
        { output_type: "display_data", data: { "text/plain": "<Figure>", "image/png": "iVBO\nRw0K\n", "image/jpeg": "/9j/" } },
        { output_type: "execute_result", data: { "image/jpeg": ["/9j/", "4AAQ"], "text/html": "<b>x</b>" } },
        { output_type: "display_data", data: { "image/svg+xml": ["<svg>", "<circle/></svg>"], "text/plain": "svg" } },
      ),
    ).toEqual([
      { type: "image", src: "data:image/png;base64,iVBORw0K" },
      { type: "image", src: "data:image/jpeg;base64,/9j/4AAQ" },
      { type: "image", src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent("<svg><circle/></svg>")}` },
    ]);
  });

  it("falls back from a broken image to the next kind it can show", () => {
    expect(
      outputs(
        { output_type: "display_data", data: { "image/png": "not base64!", "image/jpeg": "/9j/" } },
        { output_type: "display_data", data: { "image/png": "", "image/svg+xml": "  ", "text/plain": "fallback" } },
      ),
    ).toEqual([
      { type: "image", src: "data:image/jpeg;base64,/9j/" },
      { type: "text", text: "fallback" },
    ]);
  });

  it("prefers Markdown, then HTML, then plain text", () => {
    expect(
      outputs(
        { output_type: "execute_result", data: { "text/markdown": "**bold**", "text/html": "<b>x</b>", "text/plain": "x" } },
        { output_type: "execute_result", data: { "text/html": ["<table>", "</table>"], "text/plain": "x" } },
        { output_type: "execute_result", data: { "text/plain": [`${ESC}[1mOut`, "put"] } },
        { output_type: "execute_result", data: { "application/vnd.jupyter.widget-view+json": {} } },
        { output_type: "execute_result" },
      ),
    ).toEqual([
      { type: "markdown", text: "**bold**" },
      { type: "html", html: "<table></table>" },
      { type: "text", text: "Output" },
    ]);
  });

  it("reads an error with its traceback, without terminal colours", () => {
    expect(
      outputs(
        {
          output_type: "error",
          ename: "ZeroDivisionError",
          evalue: `${ESC}[0mdivision by zero`,
          traceback: [`${ESC}[0;31m---------${ESC}[0m`, 7, `${ESC}[0;31mZeroDivisionError${ESC}[0m: division by zero`],
        },
        { output_type: "error" },
      ),
    ).toEqual([
      {
        type: "error",
        name: "ZeroDivisionError",
        value: "division by zero",
        traceback: "---------\nZeroDivisionError: division by zero",
      },
      { type: "error", name: "Error", value: "", traceback: "" },
    ]);
  });

  it("skips outputs it does not know", () => {
    expect(outputs({ output_type: "update_display_data", data: {} }, "junk", null, { output_type: "stream", text: "ok" })).toEqual([
      { type: "stream", name: "stdout", text: "ok" },
    ]);
  });

  it("strips colour, cursor, title and single-character escapes", () => {
    expect(stripAnsi(`${ESC}[1;32mok${ESC}[0m ${ESC}]0;title${BEL}a${ESC}]8;;link${ESC}\\b ${ESC}[2K${ESC}Mc`)).toBe("ok ab c");
  });

  it("numbers cells from 1 and picks a range", () => {
    const cells = only(notebook([1, 2, 3, 4].map((n) => ({ cell_type: "markdown", source: String(n) }))));
    expect(pickCells(cells, null).map((cell) => cell.number)).toEqual([1, 2, 3, 4]);
    expect(pickCells(cells, { from: 2, to: 3 }).map(({ number, cell }) => [number, cell.type === "markdown" && cell.source])).toEqual([
      [2, "2"],
      [3, "3"],
    ]);
    expect(pickCells(cells, { from: 9, to: 12 })).toEqual([]);
  });
});
