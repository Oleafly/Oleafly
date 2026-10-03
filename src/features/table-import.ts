/**
 * CSV/XLSX to LaTeX/Typst table import (G17). SheetJS parses binary
 * spreadsheets in the webview; the emitter and its escaping live in
 * @oleafly/conversion-registry so both engines share one proven path.
 */
import type { FileEntry } from "@oleafly/backend-port";
import {
  delimiterOf,
  emitLatexTable,
  emitTypstLinkedTable,
  emitTypstTable,
  inferAlignment,
  isValidLatexLabel,
  parseDelimited,
  parseJsonTable,
  serializeCsv,
  type JsonTable,
  type LinkedTableOptions,
  type LinkedTableSource,
  type TableOptions,
} from "@oleafly/conversion-registry/table";
import { latexGraphicsPath, uniqueProjectPath } from "@/components/editor/figure-import";
import { i18n } from "@/i18n";
import { bytesToBase64 } from "@/lib/base64";
import { notifyProjectFilesChanged } from "@/lib/cross-window";
import { readPickedFileBase64, registerPickedFileForE2E, writeProjectBytes } from "@/lib/tauri";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { logError } from "@/lib/log";
import { useFilesStore } from "@/store/files";

export type TableTarget = "latex" | "typst";

export const MAX_TABLE_ROWS = 10_000;
export const MAX_TABLE_COLUMNS = 100;
export const MAX_TABLE_CHARACTERS = 2 * 1024 * 1024;

export interface TableImportOptions extends TableOptions {
  target: TableTarget;
}

function bytesFromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function validateTableRows(rows: string[][]): string[][] {
  if (rows.length > MAX_TABLE_ROWS) {
    throw new Error(`this table has more than ${MAX_TABLE_ROWS.toLocaleString()} rows. Split the file before importing it.`);
  }
  let characters = 0;
  for (const row of rows) {
    if (row.length > MAX_TABLE_COLUMNS) {
      throw new Error(`this table has more than ${MAX_TABLE_COLUMNS} columns. Import a smaller range instead.`);
    }
    for (const cell of row) {
      characters += cell.length;
      if (characters > MAX_TABLE_CHARACTERS) {
        throw new Error("this table contains more than 2 MB of text. Split the file before importing it.");
      }
    }
  }
  return rows;
}

function validateSheetRange(XLSX: typeof import("xlsx"), sheet: import("xlsx").WorkSheet): void {
  const ref = sheet["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  if (range.e.r - range.s.r + 1 > MAX_TABLE_ROWS || range.e.c - range.s.c + 1 > MAX_TABLE_COLUMNS) {
    throw new Error(`this spreadsheet is larger than ${MAX_TABLE_ROWS.toLocaleString()} rows by ${MAX_TABLE_COLUMNS} columns. Import a smaller range instead.`);
  }
}

export type TableFileFormat = "csv" | "tsv" | "spreadsheet" | "json";

export interface TableFile {
  rows: string[][];
  format: TableFileFormat;
  text: string | null;
  jsonShape?: JsonTable["shape"];
}

export const LINKED_DATA_DIRECTORY = "data";

export interface LinkedTablePlan {
  dataPath: string;
  content: string;
  source: LinkedTableSource;
}

function decodeText(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes);
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

export async function readTableFileFromBytes(fileName: string, bytes: Uint8Array): Promise<TableFile> {
  if (/\.(xlsx|xls)$/i.test(fileName)) {
    return { rows: await readTableRowsFromBytes(fileName, bytes), format: "spreadsheet", text: null };
  }
  const text = decodeText(bytes);
  if (/\.json$/i.test(fileName)) {
    const table = parseJsonTable(text);
    if (!table) throw new Error(i18n.t(($) => $.editor.tableImport.jsonNotTable));
    return { rows: validateTableRows(table.rows), format: "json", jsonShape: table.shape, text };
  }
  return {
    rows: validateTableRows(parseDelimited(text)),
    format: /\.tsv$/i.test(fileName) ? "tsv" : "csv",
    text,
  };
}

export async function readTableFile(path: string): Promise<TableFile> {
  const base64 = await readPickedFileBase64(path);
  return readTableFileFromBytes(path, bytesFromBase64(base64));
}

function fileStem(fileName: string): string {
  const name = fileName.replace(/^.*[/\\]/u, "");
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const safe = stem.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[-.]+|[-.]+$/gu, "");
  return safe || "table";
}

export function planLinkedTable(
  file: TableFile,
  fileName: string,
  tree: readonly FileEntry[],
  documentPath: string,
): LinkedTablePlan {
  const text = file.text ?? "";
  const tabbed = file.format === "tsv" || (file.format === "csv" && delimiterOf(text) === "\t");
  const extension = file.format === "json" ? "json" : file.format === "tsv" ? "tsv" : "csv";
  const content = file.format === "spreadsheet" ? serializeCsv(file.rows) : text;
  const dataPath = uniqueProjectPath(`${LINKED_DATA_DIRECTORY}/${fileStem(fileName)}.${extension}`, tree);
  const path = latexGraphicsPath(dataPath, documentPath);
  const source: LinkedTableSource = file.format === "json"
    ? { format: "json", path, shape: file.jsonShape ?? "records" }
    : tabbed
      ? { format: "csv", path, delimiter: "\t" }
      : { format: "csv", path };
  return { dataPath, content, source };
}

export function emitLinkedTable(rows: string[][], options: LinkedTableOptions): string {
  return emitTypstLinkedTable(rows, options);
}

export async function writeLinkedTableData(projectId: string, plan: LinkedTablePlan): Promise<void> {
  await writeProjectBytes(projectId, plan.dataPath, bytesToBase64(new TextEncoder().encode(plan.content)));
  if (useFilesStore.getState().projectId !== projectId) return;
  await useFilesStore
    .getState()
    .refreshTree()
    .catch((error) => logError("refresh files after linking a table", error));
  notifyProjectFilesChanged(projectId, [plan.dataPath]);
}

/** Parse CSV/TSV/XLSX bytes without reading outside the supplied payload. */
export async function readTableRowsFromBytes(
  fileName: string,
  bytes: Uint8Array,
): Promise<string[][]> {
  if (/\.json$/i.test(fileName)) {
    return (await readTableFileFromBytes(fileName, bytes)).rows;
  }
  if (/\.(xlsx|xls)$/i.test(fileName)) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(bytes, {
      type: "array",
      // Avoid materializing every row before the range guard can reject a
      // large spreadsheet. The extra row makes the later limit check exact.
      sheetRows: MAX_TABLE_ROWS + 1,
    });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) {
      throw new Error("that spreadsheet has no sheets to import");
    }
    validateSheetRange(XLSX, sheet);
    // Tab-separated so quoted cells survive the round trip through the
    // shared delimited parser. Merged cells read as their value in the
    // top-left cell; formulas export their cached result.
    const text = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
    return validateTableRows(parseDelimited(text));
  }
  return validateTableRows(parseDelimited(new TextDecoder().decode(bytes)));
}

/** Parse a picked CSV/TSV/XLSX file into rows of cells. */
export async function readTableRows(path: string): Promise<string[][]> {
  const base64 = await readPickedFileBase64(path);
  return readTableRowsFromBytes(path, bytesFromBase64(base64));
}

/** Emit the table source for the active engine. */
export function emitTable(rows: string[][], options: TableImportOptions): string {
  return options.target === "typst"
    ? emitTypstTable(rows, options)
    : emitLatexTable(rows, options);
}

/** Alignment the preview shows for the current options. */
export function previewAlignment(rows: string[][], hasHeader: boolean): string {
  return inferAlignment(rows, hasHeader);
}

export function hasValidTableLabel(label: string): boolean {
  return isValidLatexLabel(label.trim());
}

if (E2E_HOOKS && typeof window !== "undefined") {
  const w = window as unknown as Record<string, unknown>;
  // Drives the full convert path (backend read + SheetJS + emitter) without
  // the file dialog, for the conversion-matrix e2e spec.
  w.__e2eConvertTableFile = async (
    path: string,
    options: Partial<TableImportOptions> & { target: TableTarget },
  ) => {
    const rows = await readTableRows(await registerPickedFileForE2E(path));
    return emitTable(rows, {
      header: options.header ?? true,
      caption: options.caption,
      label: options.label,
      alignment: options.alignment,
      boldHeader: options.boldHeader,
      target: options.target,
    });
  };
}
