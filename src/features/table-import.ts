import type { FileEntry } from "@oleafly/backend-port";
import {
  delimiterOf,
  emitLatexLinkedTable,
  emitLatexTable,
  emitTypstLinkedTable,
  emitTypstTable,
  inferAlignment,
  isValidLatexLabel,
  linkedTableRows,
  metricDirection,
  parseDelimited,
  parseJsonTable,
  parseMetricNumber,
  relinkLatexTable,
  serializeCsv,
  type JsonTable,
  type LinkedLatexTableMatch,
  type LinkedTableSource,
  type MetricDirection,
  type TableOptions,
} from "@oleafly/conversion-registry/table";
import { latexGraphicsPath, uniqueProjectPath } from "@/components/editor/figure-import";
import { i18n } from "@/i18n";
import { bytesToBase64 } from "@/lib/base64";
import { notifyProjectFilesChanged } from "@/lib/cross-window";
import { diskHash } from "@/lib/disk-hash";
import { readPickedFileBase64, registerPickedFileForE2E, writeProjectBytes } from "@/lib/tauri";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { logError, logWarning } from "@/lib/log";
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

function isDashOrDot(character: string | undefined): boolean {
  return character === "-" || character === ".";
}

function trimDashesAndDots(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isDashOrDot(text[start])) start += 1;
  while (end > start && isDashOrDot(text[end - 1])) end -= 1;
  return text.slice(start, end);
}

function fileStem(fileName: string): string {
  const name = fileName.replace(/^.*[/\\]/u, "");
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const safe = trimDashesAndDots(stem.replaceAll(/[^\p{L}\p{N}._-]+/gu, "-"));
  return safe || "table";
}

function linkedExtension(format: TableFileFormat): string {
  if (format === "json") return "json";
  return format === "tsv" ? "tsv" : "csv";
}

function linkedSource(file: TableFile, path: string, tabbed: boolean): LinkedTableSource {
  if (file.format === "json") return { format: "json", path, shape: file.jsonShape ?? "records" };
  return tabbed ? { format: "csv", path, delimiter: "\t" } : { format: "csv", path };
}

export function planLinkedTable(
  file: TableFile,
  fileName: string,
  tree: readonly FileEntry[],
  documentPath: string,
): LinkedTablePlan {
  const text = file.text ?? "";
  const tabbed = file.format === "tsv" || (file.format === "csv" && delimiterOf(text) === "\t");
  const content = file.format === "spreadsheet" ? serializeCsv(file.rows) : text;
  const dataPath = uniqueProjectPath(`${LINKED_DATA_DIRECTORY}/${fileStem(fileName)}.${linkedExtension(file.format)}`, tree);
  const path = latexGraphicsPath(dataPath, documentPath);
  return { dataPath, content, source: linkedSource(file, path, tabbed) };
}

export function emitLinkedTable(rows: string[][], options: TableImportOptions, plan: LinkedTablePlan): string {
  const { target, ...table } = options;
  if (target === "typst") return emitTypstLinkedTable(rows, { ...table, source: plan.source });
  const { format, delimiter } = plan.source;
  return emitLatexLinkedTable(rows, {
    v: 1,
    source: plan.dataPath,
    hash: diskHash(plan.content),
    options: { ...table, format, ...(delimiter ? { delimiter } : {}) },
  });
}

export function relinkedTable(match: LinkedLatexTableMatch, data: string): { from: number; to: number; insert: string } | null {
  try {
    return relinkLatexTable(match, validateTableRows(linkedTableRows(data, match.table.options)), diskHash(data));
  } catch (error) {
    void logWarning("rebuild a linked table", error);
    return null;
  }
}

export interface ResultColumn {
  column: number;
  title: string;
  direction: MetricDirection | null;
}

export function resultColumns(rows: string[][], header: boolean): ResultColumn[] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const body = header ? rows.slice(1) : rows;
  const columns: ResultColumn[] = [];
  for (let column = 0; column < width; column++) {
    let numbers = 0;
    for (const row of body) {
      if (parseMetricNumber(row[column] ?? "") !== null) numbers += 1;
      if (numbers > 1) break;
    }
    if (numbers < 2) continue;
    const title = header ? (rows[0]?.[column] ?? "").trim() : "";
    columns.push({ column, title, direction: metricDirection(title) });
  }
  return columns;
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
      sheetRows: MAX_TABLE_ROWS + 1,
    });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) {
      throw new Error("that spreadsheet has no sheets to import");
    }
    validateSheetRange(XLSX, sheet);
    const text = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
    return validateTableRows(parseDelimited(text));
  }
  return validateTableRows(parseDelimited(new TextDecoder().decode(bytes)));
}

export async function readTableRows(path: string): Promise<string[][]> {
  const base64 = await readPickedFileBase64(path);
  return readTableRowsFromBytes(path, bytesFromBase64(base64));
}

export function emitTable(rows: string[][], options: TableImportOptions): string {
  return options.target === "typst"
    ? emitTypstTable(rows, options)
    : emitLatexTable(rows, options);
}

export function previewAlignment(rows: string[][], hasHeader: boolean): string {
  return inferAlignment(rows, hasHeader);
}

export function hasValidTableLabel(label: string): boolean {
  return isValidLatexLabel(label.trim());
}

if (E2E_HOOKS && typeof window !== "undefined") {
  const w = window as unknown as Record<string, unknown>;
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
