import type { CellRange } from "./notebook-block";

export type NotebookOutput =
  | { type: "stream"; name: string; text: string }
  | { type: "image"; src: string }
  | { type: "markdown"; text: string }
  | { type: "html"; html: string }
  | { type: "text"; text: string }
  | { type: "error"; name: string; value: string; traceback: string };

export type NotebookCell =
  | { type: "markdown"; source: string }
  | { type: "code"; source: string; count: number | null; outputs: NotebookOutput[] }
  | { type: "raw"; source: string };

export interface Notebook {
  language: string;
  cells: NotebookCell[];
}

export type NotebookParse = { ok: true; notebook: Notebook } | { ok: false; problem: "json" | "format" };

type Json = Record<string, unknown>;

const ESC = String.fromCodePoint(27);
const BEL = String.fromCodePoint(7);
const ANSI = new RegExp(String.raw`${ESC}(?:\[[0-?]*[ -/]*[@-~]|\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\)?|[@-_])`, "gu");
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((line) => typeof line === "string").join("");
  return "";
}

export function stripAnsi(value: string): string {
  return value.replaceAll(ANSI, "");
}

function image(mime: string, value: unknown): NotebookOutput | null {
  const data = text(value);
  if (mime === "image/svg+xml") {
    return data.trim() ? { type: "image", src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}` } : null;
  }
  const encoded = data.replaceAll(/\s+/gu, "");
  return BASE64.test(encoded) ? { type: "image", src: `data:${mime};base64,${encoded}` } : null;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/svg+xml"] as const;

function richOutput(data: Json): NotebookOutput | null {
  for (const mime of IMAGE_TYPES) {
    if (!(mime in data)) continue;
    const shown = image(mime, data[mime]);
    if (shown) return shown;
  }
  if ("text/markdown" in data) return { type: "markdown", text: text(data["text/markdown"]) };
  if ("text/html" in data) return { type: "html", html: text(data["text/html"]) };
  if ("text/plain" in data) return { type: "text", text: stripAnsi(text(data["text/plain"])) };
  return null;
}

function output(value: unknown): NotebookOutput | null {
  if (!isObject(value)) return null;
  switch (value.output_type) {
    case "stream":
      return { type: "stream", name: typeof value.name === "string" ? value.name : "stdout", text: stripAnsi(text(value.text)) };
    case "execute_result":
    case "display_data":
      return isObject(value.data) ? richOutput(value.data) : null;
    case "error":
      return {
        type: "error",
        name: typeof value.ename === "string" ? value.ename : "Error",
        value: typeof value.evalue === "string" ? stripAnsi(value.evalue) : "",
        traceback: stripAnsi(Array.isArray(value.traceback) ? value.traceback.filter((line) => typeof line === "string").join("\n") : ""),
      };
    default:
      return null;
  }
}

function cell(value: unknown): NotebookCell | null {
  if (!isObject(value)) return null;
  const source = text(value.source);
  switch (value.cell_type) {
    case "markdown":
      return { type: "markdown", source };
    case "raw":
      return { type: "raw", source };
    case "code": {
      const count = typeof value.execution_count === "number" ? value.execution_count : null;
      const outputs = Array.isArray(value.outputs) ? value.outputs.flatMap((item) => output(item) ?? []) : [];
      return { type: "code", source, count, outputs };
    }
    default:
      return null;
  }
}

function language(metadata: unknown): string {
  if (!isObject(metadata)) return "";
  const info = isObject(metadata.language_info) ? metadata.language_info.name : undefined;
  if (typeof info === "string") return info.trim().toLowerCase();
  const kernel = isObject(metadata.kernelspec) ? metadata.kernelspec.language : undefined;
  return typeof kernel === "string" ? kernel.trim().toLowerCase() : "";
}

export function parseNotebook(source: string): NotebookParse {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return { ok: false, problem: "json" };
  }
  if (!isObject(data) || data.nbformat !== 4 || !Array.isArray(data.cells)) return { ok: false, problem: "format" };
  return {
    ok: true,
    notebook: { language: language(data.metadata), cells: data.cells.flatMap((item) => cell(item) ?? []) },
  };
}

export interface NumberedCell {
  number: number;
  cell: NotebookCell;
}

export function pickCells(cells: readonly NotebookCell[], range: CellRange | null): NumberedCell[] {
  const numbered = cells.map((item, index) => ({ number: index + 1, cell: item }));
  return range ? numbered.filter(({ number }) => number >= range.from && number <= range.to) : numbered;
}
