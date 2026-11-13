import { delimiterOf, parseDelimited } from "@oleafly/conversion-registry/table";
import type { SortDirection } from "@/components/ui/table";
import { dataUrlBytes, dataUrlText, type NoteFile, splitBlockOptions } from "./note-blocks";
import { notePath } from "./note-path";

export type ColumnType = "number" | "boolean" | "date" | "text";
export type TableDelimiter = "," | "\t";
export type SortKey = number | string | null;

export interface TableData {
  header: string[];
  rows: string[][];
  types: ColumnType[];
  thousands: boolean;
  truncated: boolean;
}

export type TableProblem = "empty" | "columns";
export type TableResult = { ok: true; table: TableData } | { ok: false; problem: TableProblem };

export type TableFileFormat = "csv" | "tsv" | "spreadsheet";

export type TableSource =
  | { kind: "inline"; text: string; thousands: boolean }
  | { kind: "file"; path: string; format: TableFileFormat; sheet: string | null; thousands: boolean }
  | { kind: "invalid"; problem: "path" | "unsupported"; path: string };

export interface ColumnSummary {
  count: number;
  mean: number;
  min: number;
  max: number;
  minText: string;
  maxText: string;
}

export const TABLE_MAX_ROWS = 200_000;
export const TABLE_MAX_COLUMNS = 500;
export const TABLE_MAX_BYTES = 6 * 1024 * 1024;
export const TABLE_OPTIONS: ReadonlySet<string> = new Set(["path", "sheet", "thousands"]);

const YES = /^(?:yes|true|on|1)$/iu;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu;
const GROUPED = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?(?:e[+-]?\d+)?$/iu;
const BOOLEAN = /^(?:true|false|yes|no)$/iu;
const TRUTHY = /^(?:true|yes)$/iu;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;
const ISO_DAY_LENGTH = "2000-01-01".length;
const ISO_CLOCK = /^[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/u;
const ISO_ZONE_START = /[Z+-]/u;
const ISO_ZONE = /^(?:Z|[+-]\d{2}:?\d{2})$/u;
const SEARCH_SEPARATOR = "\u0000";

export function tableDelimiter(fence: string | undefined, text: string): TableDelimiter {
  return fence === "tsv" || delimiterOf(text.replace(/^\s*\n/u, "")) === "\t" ? "\t" : ",";
}

export function parseNumber(text: string, thousands = false): number | null {
  const value = text.trim().replace(/^−/u, "-");
  let number: number | null = null;
  if (NUMBER.test(value)) number = Number(value);
  else if (thousands && GROUPED.test(value)) number = Number(value.replaceAll(",", ""));
  return number !== null && Number.isFinite(number) ? number : null;
}

export function parseBoolean(text: string): number | null {
  const value = text.trim();
  if (!BOOLEAN.test(value)) return null;
  return TRUTHY.test(value) ? 1 : 0;
}

function zoneMinutes(zone: string | undefined): number {
  if (!zone || zone === "Z") return 0;
  const digits = zone.replace(":", "");
  const minutes = Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5));
  return digits.startsWith("-") ? -minutes : minutes;
}

function isoDateParts(text: string): (string | undefined)[] | null {
  const day = ISO_DAY.exec(text.slice(0, ISO_DAY_LENGTH));
  if (!day) return null;
  const rest = text.slice(ISO_DAY_LENGTH);
  if (!rest) return day.slice(1);
  const zoneAt = rest.search(ISO_ZONE_START);
  const clock = ISO_CLOCK.exec(zoneAt < 0 ? rest : rest.slice(0, zoneAt));
  const zone = zoneAt < 0 ? undefined : rest.slice(zoneAt);
  if (!clock || (zone !== undefined && !ISO_ZONE.test(zone))) return null;
  return [...day.slice(1), ...clock.slice(1), zone];
}

export function parseDate(text: string): number | null {
  const iso = isoDateParts(text.trim());
  if (!iso) return null;
  const [year, month, day, hour = "0", minute = "0", second = "0", fraction = "", zone] = iso;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const [y, mo, d, h, mi, s] = parts;
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const milliseconds = Number(fraction.padEnd(3, "0").slice(0, 3));
  const time = Date.UTC(y, mo - 1, d, h, mi, s, milliseconds);
  if (new Date(time).getUTCDate() !== d) return null;
  return time - zoneMinutes(zone) * 60_000;
}

interface TypeFit {
  number: boolean;
  boolean: boolean;
  date: boolean;
}

function narrowFit(fit: TypeFit, cell: string, thousands: boolean): void {
  if (fit.number && parseNumber(cell, thousands) === null) fit.number = false;
  if (fit.boolean && parseBoolean(cell) === null) fit.boolean = false;
  if (fit.date && parseDate(cell) === null) fit.date = false;
}

function detectType(rows: readonly string[][], column: number, thousands: boolean): ColumnType {
  const fit: TypeFit = { number: true, boolean: true, date: true };
  let seen = false;
  for (const row of rows) {
    const cell = row[column];
    if (cell.trim() === "") continue;
    seen = true;
    narrowFit(fit, cell, thousands);
    if (!fit.number && !fit.boolean && !fit.date) return "text";
  }
  if (!seen) return "text";
  if (fit.number) return "number";
  return fit.boolean ? "boolean" : "date";
}

export function detectTypes(rows: readonly string[][], width: number, thousands = false): ColumnType[] {
  return Array.from({ length: width }, (_, column) => detectType(rows, column, thousands));
}

export function buildTable(parsed: string[][], thousands = false): TableResult {
  if (parsed.length < 2) return { ok: false, problem: "empty" };
  const truncated = parsed.length - 1 > TABLE_MAX_ROWS;
  const body = parsed.slice(1, TABLE_MAX_ROWS + 1);
  let width = parsed[0].length;
  for (const row of body) width = Math.max(width, row.length);
  if (width > TABLE_MAX_COLUMNS) return { ok: false, problem: "columns" };
  const pad = (row: string[]) => (row.length < width ? [...row, ...new Array<string>(width - row.length).fill("")] : row);
  const rows = body.map(pad);
  return {
    ok: true,
    table: { header: pad(parsed[0]), rows, types: detectTypes(rows, width, thousands), thousands, truncated },
  };
}

function fileFormat(path: string): TableFileFormat | null {
  if (/\.csv$/iu.test(path)) return "csv";
  if (/\.tsv$/iu.test(path)) return "tsv";
  if (/\.xlsx?$/iu.test(path)) return "spreadsheet";
  return null;
}

export function tableSource(source: string): TableSource {
  const { options, body } = splitBlockOptions(source, TABLE_OPTIONS);
  const thousands = YES.test(options.get("thousands") ?? "");
  const written = options.get("path");
  if (written === undefined) return { kind: "inline", text: body, thousands };
  const path = notePath(written);
  if (!path) return { kind: "invalid", problem: "path", path: written };
  const format = fileFormat(path);
  if (!format) return { kind: "invalid", problem: "unsupported", path };
  return { kind: "file", path, format, sheet: options.get("sheet") || null, thousands };
}

export type TableFileProblem = "missing" | "unreadable" | "sheet" | "columns";

export class TableFileError extends Error {
  readonly problem: TableFileProblem;
  readonly sheets: readonly string[];

  constructor(problem: TableFileProblem, sheets: readonly string[] = []) {
    super(`The table file could not be read (${problem}).`);
    this.name = "TableFileError";
    this.problem = problem;
    this.sheets = sheets;
  }
}

export function pickSheet(names: readonly string[], wanted: string | null): string | null {
  if (!wanted) return names[0] ?? null;
  const lower = wanted.toLowerCase();
  return names.find((name) => name === wanted) ?? names.find((name) => name.toLowerCase() === lower) ?? null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function spreadsheetCellText(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? String(Number(value.toPrecision(15))) : "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const date = `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
    const hours = value.getUTCHours();
    const minutes = value.getUTCMinutes();
    const seconds = value.getUTCSeconds();
    if (hours === 0 && minutes === 0 && seconds === 0) return date;
    const clock = `${date} ${pad2(hours)}:${pad2(minutes)}`;
    return seconds ? `${clock}:${pad2(seconds)}` : clock;
  }
  return typeof value === "string" ? value : "";
}

export async function readSpreadsheetRows(bytes: Uint8Array, sheet: string | null): Promise<string[][]> {
  const XLSX = await import("xlsx");
  let workbook: import("xlsx").WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "array", cellDates: true, dense: true, sheetRows: TABLE_MAX_ROWS + 2 });
  } catch {
    throw new TableFileError("unreadable");
  }
  const name = pickSheet(workbook.SheetNames, sheet);
  if (!name) throw new TableFileError("sheet", workbook.SheetNames);
  const worksheet = workbook.Sheets[name];
  const ref = worksheet["!ref"];
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    if (range.e.c - range.s.c + 1 > TABLE_MAX_COLUMNS) throw new TableFileError("columns");
  }
  const values = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: true, defval: "", blankrows: false, UTC: true });
  return values.map((row) => row.map(spreadsheetCellText));
}

export async function loadTableFile(
  source: Extract<TableSource, { kind: "file" }>,
  readFile: NoteFile,
): Promise<TableResult> {
  const url = await readFile(source.path);
  if (url === null) throw new TableFileError("missing");
  if (source.format === "spreadsheet") {
    const bytes = dataUrlBytes(url, TABLE_MAX_BYTES);
    if (!bytes) throw new TableFileError("unreadable");
    return buildTable(await readSpreadsheetRows(bytes, source.sheet), source.thousands);
  }
  const text = dataUrlText(url, TABLE_MAX_BYTES);
  if (text === null) throw new TableFileError("unreadable");
  const rows = parseDelimited(text, { delimiter: tableDelimiter(source.format, text), limit: TABLE_MAX_ROWS + 2, trim: false });
  return buildTable(rows, source.thousands);
}

export function columnKeys(table: TableData, column: number): SortKey[] {
  const type = table.types[column];
  return table.rows.map((row) => {
    const cell = row[column];
    if (cell.trim() === "") return null;
    if (type === "number") return parseNumber(cell, table.thousands);
    if (type === "boolean") return parseBoolean(cell);
    if (type === "date") return parseDate(cell);
    return cell;
  });
}

export function columnKeyCache(table: TableData): (column: number) => SortKey[] {
  const cache = new Map<number, SortKey[]>();
  return (column) => {
    let keys = cache.get(column);
    if (!keys) {
      keys = columnKeys(table, column);
      cache.set(column, keys);
    }
    return keys;
  };
}

export function sortRows(
  indices: readonly number[],
  keys: readonly SortKey[],
  direction: SortDirection,
  collator: Intl.Collator,
): number[] {
  const sign = direction === "ascending" ? 1 : -1;
  return [...indices].sort((left, right) => {
    const a = keys[left];
    const b = keys[right];
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    if (typeof a === "number" && typeof b === "number") return (a - b) * sign;
    return collator.compare(String(a), String(b)) * sign;
  });
}

const searchCache = new WeakMap<string[][], string[]>();

function searchText(rows: string[][]): string[] {
  let text = searchCache.get(rows);
  if (!text) {
    text = rows.map((row) => row.join(SEARCH_SEPARATOR).toLowerCase());
    searchCache.set(rows, text);
  }
  return text;
}

export function filterRows(table: TableData, query: string): number[] {
  const needle = query.trim().toLowerCase();
  const all = table.rows.map((_, index) => index);
  if (!needle) return all;
  const text = searchText(table.rows);
  return all.filter((index) => text[index].includes(needle));
}

export function summarizeColumn(
  table: TableData,
  indices: readonly number[],
  keys: readonly SortKey[],
  column: number,
): ColumnSummary | null {
  let count = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let minText = "";
  let maxText = "";
  for (const index of indices) {
    const value = keys[index];
    if (typeof value !== "number") continue;
    count += 1;
    sum += value;
    if (value < min) {
      min = value;
      minText = table.rows[index][column].trim();
    }
    if (value > max) {
      max = value;
      maxText = table.rows[index][column].trim();
    }
  }
  return count === 0 ? null : { count, mean: sum / count, min, max, minText, maxText };
}
