/**
 * Delimited-spreadsheet to LaTeX/Typst table conversion (G17).
 *
 * Parsing handles RFC 4180 CSV (quotes, embedded commas, embedded newlines,
 * embedded quotes doubled), TSV as produced by SheetJS `sheet_to_csv`, and
 * pads ragged rows. Emission escapes every LaTeX- or Typst-special character
 * in a single pass: a chained `.replace()` approach re-escapes the braces it
 * just inserted into `\textbackslash{}`, so each character is mapped exactly
 * once here instead.
 */

export type MetricDirection = "higher" | "lower";

export interface TableHighlight {
  directions: readonly (MetricDirection | null)[];
  best: boolean;
  second: boolean;
}

export interface TableOptions {
  header: boolean;
  /** Table caption (LaTeX) or figure caption (Typst). */
  caption?: string;
  label?: string;
  alignment?: string;
  boldHeader?: boolean;
  highlight?: TableHighlight;
}

export interface DelimitedOptions {
  delimiter?: string;
  limit?: number;
  trim?: boolean;
}

const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
const QUOTE = '"';
const BYTE_ORDER_MARK = 0xfeff;

export function delimiterOf(text: string): string {
  return detectDelimiter(text);
}

function detectDelimiter(text: string): string {
  let quoted = false;
  let tabs = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) break;
    if (!quoted && character === "\t") tabs += 1;
  }
  return tabs > 0 ? "\t" : ",";
}

function quotedText(text: string): string {
  return text.includes("\r") ? text.replaceAll(/\r\n?/g, "\n") : text;
}

function readQuotedField(text: string, start: number): { value: string; next: number } {
  let value = "";
  let index = start;
  while (index < text.length) {
    const close = text.indexOf(QUOTE, index);
    if (close === -1) return { value: value + quotedText(text.slice(index)), next: text.length };
    value += quotedText(text.slice(index, close));
    if (text[close + 1] !== QUOTE) return { value, next: close + 1 };
    value += QUOTE;
    index = close + 2;
  }
  return { value, next: index };
}

function unquotedFieldEnd(text: string, start: number, separator: number | undefined): number {
  let stop = start;
  while (stop < text.length) {
    const code = text.codePointAt(stop);
    if (code === separator || code === LINE_FEED || code === CARRIAGE_RETURN) return stop;
    stop += 1;
  }
  return stop;
}

function lineBreakWidth(text: string, index: number): number {
  return text.codePointAt(index) === CARRIAGE_RETURN && text.codePointAt(index + 1) === LINE_FEED ? 2 : 1;
}

function scanDelimited(text: string, delimiter: string, limit: number): string[][] {
  const rows: string[][] = [];
  const separator = delimiter.codePointAt(0);
  const end = text.length;
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = text.codePointAt(0) === BYTE_ORDER_MARK ? 1 : 0;
  const finishRow = () => {
    row.push(field);
    if (row.length > 1 || field !== "" || quoted) rows.push(row);
    row = [];
    field = "";
    quoted = false;
  };
  while (index < end && rows.length < limit) {
    if (text[index] === QUOTE && field === "" && !quoted) {
      const quotedField = readQuotedField(text, index + 1);
      field = quotedField.value;
      quoted = true;
      index = quotedField.next;
      continue;
    }
    const stop = unquotedFieldEnd(text, index, separator);
    field += text.slice(index, stop);
    index = stop;
    if (index >= end) break;
    if (text.codePointAt(index) === separator) {
      row.push(field);
      field = "";
      quoted = false;
      index += 1;
      continue;
    }
    finishRow();
    index += lineBreakWidth(text, index);
  }
  if (rows.length < limit && (row.length > 0 || field !== "" || quoted)) finishRow();
  return rows;
}

export function parseDelimited(text: string, options: DelimitedOptions = {}): string[][] {
  const rows = scanDelimited(
    text,
    options.delimiter ?? detectDelimiter(text),
    options.limit ?? Number.POSITIVE_INFINITY,
  );
  if (options.trim === false) return rows;
  const trimmed = rows.map((row) => row.map((cell) => cell.trim()));
  while (trimmed.at(-1)?.every((cell) => cell === "")) {
    trimmed.pop();
  }
  return trimmed;
}

function padRows(rows: string[][]): { rows: string[][]; width: number } {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return {
    rows: rows.map((row) => {
      const padded = [...row];
      while (padded.length < width) {
        padded.push("");
      }
      return padded;
    }),
    width,
  };
}

function isNumericCell(value: string): boolean {
  let text = value;
  if (text.endsWith("%")) text = text.slice(0, -1);
  if (!text) return false;
  if (text.startsWith("-") || text.startsWith("+")) text = text.slice(1);
  if (!text) return false;

  let decimal = false;
  let comma = false;
  let digitsInGroup = 0;
  let firstGroup = true;
  for (const character of text) {
    if (character >= "0" && character <= "9") {
      digitsInGroup += 1;
      continue;
    }
    if (character === ".") {
      if (decimal || digitsInGroup === 0 || (comma && digitsInGroup !== 3)) return false;
      decimal = true;
      comma = false;
      digitsInGroup = 0;
      continue;
    }
    if (character === ",") {
      if (decimal || digitsInGroup === 0 || (!firstGroup && digitsInGroup !== 3)) return false;
      comma = true;
      firstGroup = false;
      digitsInGroup = 0;
      continue;
    }
    return false;
  }
  return digitsInGroup > 0 && (!comma || digitsInGroup === 3);
}

function explicitAlignment(value: string | undefined, width: number): string | null {
  if (!value || value === "auto") return null;
  const alignment = value.trim().toLowerCase();
  if (!alignment || ![...alignment].every((letter) => letter === "l" || letter === "c" || letter === "r")) {
    return null;
  }
  return alignment.padEnd(width, "l").slice(0, width);
}

export function isValidLatexLabel(value: string): boolean {
  if (!value) return false;
  for (const character of value) {
    const isLower = character >= "a" && character <= "z";
    const isUpper = character >= "A" && character <= "Z";
    const isDigit = character >= "0" && character <= "9";
    if (!isLower && !isUpper && !isDigit && character !== ":" && character !== "-" && character !== "_" && character !== ".") {
      return false;
    }
  }
  return true;
}

export function inferAlignment(rows: string[][], hasHeader: boolean): string {
  const { rows: padded, width } = padRows(rows);
  const body = hasHeader ? padded.slice(1) : padded;
  let alignment = "";
  for (let column = 0; column < width; column++) {
    const values = body.map((row) => row[column]).filter((value) => value !== "");
    const numeric = values.length > 0 && values.every(isNumericCell);
    alignment += numeric ? "r" : "l";
  }
  return alignment || "l".repeat(width || 1);
}

function flattenCell(value: string): string {
  const lines = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  return lines.length === 1 ? value : lines.map((line) => line.trim()).join(" ");
}

export function escapeLatexCell(value: string): string {
  let out = "";
  for (const ch of flattenCell(value)) {
    switch (ch) {
      case "\\":
        out += "\\textbackslash{}";
        break;
      case "&":
      case "%":
      case "$":
      case "#":
      case "_":
      case "{":
      case "}":
        out += `\\${ch}`;
        break;
      case "~":
        out += "\\textasciitilde{}";
        break;
      case "^":
        out += "\\textasciicircum{}";
        break;
      default:
        out += ch;
    }
  }
  return out;
}

const TYPST_ESCAPED_CHARACTERS = new Set(["\\", "[", "]", "#", "$", "@", "*", "_", "`", "<", ">", '"', "~"]);

function isTypstSpace(character: string | undefined): boolean {
  return character?.trim() === "";
}

function typstLeadingMarkerIndex(text: string): number {
  let start = 0;
  while (isTypstSpace(text[start])) start += 1;
  const first = text[start];
  if (first === "-" || first === "+" || first === "/") {
    return isTypstSpace(text[start + 1]) ? start : -1;
  }
  let end = start;
  if (first === "=") {
    while (text[end] === "=") end += 1;
    return isTypstSpace(text[end]) ? start : -1;
  }
  while (text[end] >= "0" && text[end] <= "9") end += 1;
  return end > start && text[end] === "." && isTypstSpace(text[end + 1]) ? end : -1;
}

/** Escape Typst markup content: backslash, brackets, and meaning-changers. */
export function escapeTypstCell(value: string): string {
  const text = flattenCell(value);
  const marker = typstLeadingMarkerIndex(text);
  let out = "";
  for (let index = 0; index < text.length; index++) {
    const ch = text[index];
    const opensComment = ch === "/" && (text[index + 1] === "/" || text[index + 1] === "*");
    if (index === marker || opensComment || TYPST_ESCAPED_CHARACTERS.has(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return out;
}

const UP_ARROW = /\\uparrow(?![A-Za-z])|↑/u;
const DOWN_ARROW = /\\downarrow(?![A-Za-z])|↓/u;
const ERROR_METRIC = /(?<![A-Za-z0-9])(?:error|err|loss|wer|cer)(?![A-Za-z])/iu;
const HIGHER_METRIC = /(?<![A-Za-z0-9])(?:psnr|ssim|accuracy|acc|f1|f-score|bleu|rouge|meteor|cider|auc|recall|precision|iou|miou|top-[15]|dice|r@(?:\d+|k)|ndcg|hit\s+rate)(?![A-Za-z])/iu;
const HIGHER_ACRONYM = /(?<![A-Za-z0-9])m?AP(?![A-Za-z])/u;
const LOWER_METRIC = /(?<![A-Za-z0-9])(?:mae|mse|rmse|lpips|fid|kid|epe|perplexity|ppl|latency|time|runtime|memory|[gmt]?flops|params?)(?![A-Za-z])/iu;
const LOWER_ACRONYM = /(?<![A-Za-z0-9])CD(?![A-Za-z])/u;

export function metricDirection(header: string): MetricDirection | null {
  const up = UP_ARROW.test(header);
  const down = DOWN_ARROW.test(header);
  if (up !== down) return up ? "higher" : "lower";
  if (up) return null;
  const words = header.replaceAll(/\\[A-Za-z]+/gu, " ");
  if (ERROR_METRIC.test(words)) return "lower";
  const higher = HIGHER_METRIC.test(words) || HIGHER_ACRONYM.test(words);
  const lower = LOWER_METRIC.test(words) || LOWER_ACRONYM.test(words);
  if (higher === lower) return null;
  return higher ? "higher" : "lower";
}

const METRIC_NUMBER = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?%?$/u;

export function parseMetricNumber(text: string): number | null {
  let value = text.replaceAll(/\\(?:cellcolor|rowcolor|color|textcolor)(?:\s*\[[^\][]{0,80}\])?\s*\{[^{}]{0,80}\}/gu, "");
  const cut = value.search(/\\pm(?![A-Za-z])|±|(?<!\\)\(/u);
  if (cut >= 0) value = value.slice(0, cut);
  value = value
    .replaceAll("\\%", "%")
    .replaceAll(/\\[A-Za-z]+\*?|\\[,;:! ]/gu, "")
    .replaceAll(/[\s{}$^_~*†‡]/gu, "")
    .replaceAll(/[−–]/gu, "-");
  if (!/\d/u.test(value) || !METRIC_NUMBER.test(value)) return null;
  const number = Number(value.replaceAll(",", "").replace(/%$/u, ""));
  return Number.isFinite(number) ? number : null;
}

export function metricRanks(values: readonly (number | null)[], direction: MetricDirection): { best: number[]; second: number[] } {
  const numbers = values.filter((value): value is number => value !== null);
  if (numbers.length < 2) return { best: [], second: [] };
  const order = [...new Set(numbers)].sort((left, right) => (direction === "higher" ? right - left : left - right));
  const at = (target: number | undefined) =>
    target === undefined ? [] : values.flatMap((value, index) => (value === target ? [index] : []));
  return { best: at(order[0]), second: at(order[1]) };
}

export type CellHighlight = "best" | "second" | null;

export function tableHighlights(rows: readonly (readonly string[])[], options: Pick<TableOptions, "header" | "highlight">): CellHighlight[][] {
  const marks: CellHighlight[][] = rows.map((row) => row.map(() => null));
  const highlight = options.highlight;
  if (!highlight || (!highlight.best && !highlight.second)) return marks;
  const first = options.header ? 1 : 0;
  highlight.directions.forEach((direction, column) => {
    if (!direction) return;
    const values = rows.map((row, index) => (index < first ? null : parseMetricNumber(row[column] ?? "")));
    const { best, second } = metricRanks(values, direction);
    if (highlight.second) for (const index of second) marks[index][column] = "second";
    if (highlight.best) for (const index of best) marks[index][column] = "best";
  });
  return marks;
}

function latexTableLines(rowsInput: string[][], options: TableOptions): string[] {
  const { rows } = padRows(rowsInput);
  if (rows.length === 0) {
    return [];
  }
  const bold = options.boldHeader ?? true;
  const marks = tableHighlights(rows, options);
  const alignment = explicitAlignment(options.alignment, rows[0].length)
    ?? inferAlignment(rowsInput, options.header);
  const lines: string[] = ["\\begin{table}[htbp]", "  \\centering"];
  if (options.caption) {
    lines.push(String.raw`  \caption{${escapeLatexCell(options.caption)}}`);
  }
  const label = options.label?.trim();
  if (label && isValidLatexLabel(label)) {
    lines.push(String.raw`  \label{${label}}`);
  }
  lines.push(String.raw`  \begin{tabular}{${alignment}}`, "    \\toprule");
  rows.forEach((row, index) => {
    const cells = row.map(escapeLatexCell);
    const isHeader = options.header && index === 0;
    const shown = cells.map((cell, column) => {
      if (isHeader) return bold ? String.raw`\textbf{${cell}}` : cell;
      const mark = marks[index][column];
      if (mark === "best") return String.raw`\textbf{${cell}}`;
      return mark === "second" ? String.raw`\underline{${cell}}` : cell;
    });
    lines.push(`    ${shown.join(" & ")} \\\\`);
    if (isHeader) {
      lines.push("    \\midrule");
    }
  });
  lines.push("    \\bottomrule", "  \\end{tabular}", "\\end{table}");
  return lines;
}

export function emitLatexTable(rowsInput: string[][], options: TableOptions): string {
  return latexTableLines(rowsInput, options).join("\n");
}

function typstAlignment(letter: string): string {
  if (letter === "r") return "right";
  if (letter === "c") return "center";
  return "left";
}

export function emitTypstTable(rowsInput: string[][], options: TableOptions): string {
  const { rows } = padRows(rowsInput);
  if (rows.length === 0) {
    return "";
  }
  const bold = options.boldHeader ?? true;
  const alignment = explicitAlignment(options.alignment, rows[0].length)
    ?? inferAlignment(rowsInput, options.header);
  const alignments = [...alignment].map(typstAlignment);
  const alignArg = alignments.length === 1 ? alignments[0] : `(${alignments.join(", ")})`;
  const body: string[] = [
    `columns: ${alignments.length},`,
    `align: ${alignArg},`,
    "stroke: none,",
    "table.hline(),",
  ];
  const marks = tableHighlights(rows, options);
  rows.forEach((row, index) => {
    const cells = row.map(escapeTypstCell);
    if (options.header && index === 0) {
      const headerCells = cells.map((cell) => (bold && cell ? `[*${cell}*]` : `[${cell}]`));
      body.push(`table.header(${headerCells.join(", ")}),`, "table.hline(stroke: 0.5pt),");
    } else {
      const bracketed = cells.map((cell, column) => {
        const mark = marks[index][column];
        if (mark === "best") return `[*${cell}*]`;
        return mark === "second" ? `[#underline[${cell}]]` : `[${cell}]`;
      }).join(", ");
      body.push(`${bracketed},`);
    }
  });
  body.push("table.hline(),");

  const caption = options.caption?.trim();
  const label = options.label?.trim();
  const validLabel = label && isValidLatexLabel(label) ? label : undefined;
  if (!caption && !validLabel) {
    return ["#table(", ...body.map((line) => `  ${line}`), ")"].join("\n");
  }
  const lines = ["#figure(", "  table(", ...body.map((line) => `    ${line}`), "  ),"];
  if (caption) {
    lines.push(`  caption: [${escapeTypstCell(caption)}],`);
  }
  lines.push(validLabel ? `) <${validLabel}>` : ")");
  return lines.join("\n");
}

function csvCell(value: string): string {
  const needsQuotes = /[",\r\n]/u.test(value) || value !== value.trim();
  return needsQuotes ? `"${value.replaceAll('"', '""')}"` : value;
}

export function serializeCsv(rowsInput: string[][]): string {
  const { rows } = padRows(rowsInput);
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + (rows.length > 0 ? "\n" : "");
}

export interface JsonTable {
  shape: "records" | "rows";
  rows: string[][];
}

function jsonCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonTable(text: string): JsonTable | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) return null;
  if (data.every(isRecord)) {
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const record of data) {
      for (const key of Object.keys(record)) {
        if (!seen.has(key)) {
          seen.add(key);
          keys.push(key);
        }
      }
    }
    return { shape: "records", rows: [keys, ...data.map((record) => keys.map((key) => jsonCell(record[key])))] };
  }
  if (data.every(Array.isArray)) {
    return { shape: "rows", rows: data.map((row: unknown[]) => row.map(jsonCell)) };
  }
  return null;
}

export interface LinkedTableSource {
  format: "csv" | "json";
  path: string;
  delimiter?: string;
  shape?: JsonTable["shape"];
}

export interface LinkedTableOptions extends TableOptions {
  source: LinkedTableSource;
}

export function typstDataName(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  const stem = (dot > 0 ? file.slice(0, dot) : file).toLowerCase();
  let name = "";
  for (const character of stem) {
    const plain = (character >= "a" && character <= "z") || (character >= "0" && character <= "9");
    if (plain) name += character;
    else if (!name.endsWith("-")) name += "-";
  }
  while (name.startsWith("-")) name = name.slice(1);
  while (name.endsWith("-")) name = name.slice(0, -1);
  if (!name) return "data";
  return name[0] >= "0" && name[0] <= "9" ? `data-${name}` : name;
}

function typstStringLiteral(value: string): string {
  let out = "";
  for (const character of value) {
    if (character === "\\" || character === '"') out += `\\${character}`;
    else if (character === "\n") out += String.raw`\n`;
    else if (character === "\r") out += String.raw`\r`;
    else if (character === "\t") out += String.raw`\t`;
    else out += character;
  }
  return `"${out}"`;
}

function linkedTableLines(name: string, options: LinkedTableOptions): { prelude: string[]; columns: string; header: string; body: string } {
  const { source } = options;
  const data = `${name}-data`;
  const cell = `${name}-cell`;
  const bold = options.boldHeader ?? true;
  const strong = (cells: string) => (bold ? `${cells}.map(strong)` : cells);
  const delimiter = source.format === "csv" && source.delimiter && source.delimiter !== ","
    ? `, delimiter: ${typstStringLiteral(source.delimiter)}`
    : "";
  const prelude = [`#let ${data} = ${source.format}(${typstStringLiteral(source.path)}${delimiter})`];
  const cellHelper = `#let ${cell}(value) = if value == none { "" } else if type(value) == str { value } else { repr(value) }`;
  if (source.format === "json" && (source.shape ?? "records") === "records") {
    const columns = `${name}-columns`;
    prelude.push(
      `#let ${columns} = ${data}.fold((), (keys, row) => keys + row.keys().filter(key => key not in keys))`,
      cellHelper,
    );
    return {
      prelude,
      columns: `${columns}.len()`,
      header: `table.header(..${strong(columns)}),`,
      body: `..${data}.map(row => ${columns}.map(key => ${cell}(row.at(key, default: none)))).flatten(),`,
    };
  }
  if (source.format === "json") {
    prelude.push(cellHelper);
    const jsonHeader = strong(`${data}.first().map(${cell})`);
    return {
      prelude,
      columns: `${data}.first().len()`,
      header: `table.header(..${jsonHeader}),`,
      body: options.header ? `..${data}.slice(1).flatten().map(${cell}),` : `..${data}.flatten().map(${cell}),`,
    };
  }
  const csvHeader = strong(`${data}.first()`);
  return {
    prelude,
    columns: `${data}.first().len()`,
    header: `table.header(..${csvHeader}),`,
    body: options.header ? `..${data}.slice(1).flatten(),` : `..${data}.flatten(),`,
  };
}

export function emitTypstLinkedTable(rowsInput: string[][], options: LinkedTableOptions): string {
  const { rows } = padRows(rowsInput);
  if (rows.length === 0) {
    return "";
  }
  const alignment = explicitAlignment(options.alignment, rows[0].length)
    ?? inferAlignment(rowsInput, options.header);
  const alignments = [...alignment].map(typstAlignment);
  const alignArg = alignments.length === 1 ? alignments[0] : `(${alignments.join(", ")})`;
  const parts = linkedTableLines(typstDataName(options.source.path), options);
  const body = [`columns: ${parts.columns},`, `align: ${alignArg},`, "stroke: none,", "table.hline(),"];
  if (options.header) {
    body.push(parts.header, "table.hline(stroke: 0.5pt),");
  }
  body.push(parts.body, "table.hline(),");

  const caption = options.caption?.trim();
  const label = options.label?.trim();
  const validLabel = label && isValidLatexLabel(label) ? label : undefined;
  if (!caption && !validLabel) {
    return [...parts.prelude, "#table(", ...body.map((line) => `  ${line}`), ")"].join("\n");
  }
  const lines = [...parts.prelude, "#figure(", "  table(", ...body.map((line) => `    ${line}`), "  ),"];
  if (caption) {
    lines.push(`  caption: [${escapeTypstCell(caption)}],`);
  }
  lines.push(validLabel ? `) <${validLabel}>` : ")");
  return lines.join("\n");
}

export interface LinkedLatexTableOptions extends TableOptions {
  format: LinkedTableSource["format"];
  delimiter?: string;
}

export interface LinkedLatexTable {
  v: 1;
  source: string;
  hash: string;
  options: LinkedLatexTableOptions;
}

export interface LinkedLatexTableMatch {
  from: number;
  to: number;
  table: LinkedLatexTable;
  tableFrom: number;
  tableTo: number;
  begin: string;
}

const LATEX_TABLE_MARK = "oleafly-table-v1:";
const LATEX_TABLE_MARK_LINE = /^([ \t]*)(%[ \t]*oleafly-table-v1:[ \t]*([A-Za-z0-9_-]+))[ \t]*\r?$/gmu;
const LATEX_TABLE_BEGIN = /\\begin\s*\{table\*?\}(?:[ \t]*\[[^\][\n]{0,40}\])?/gu;
const LATEX_TABLE_END = /\\end\s*\{table\*?\}/gu;

function base64UrlText(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCodePoint(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function textFromBase64Url(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0));
}

function linkedHighlight(value: unknown): TableHighlight | undefined {
  if (!isRecord(value) || !Array.isArray(value.directions)) return undefined;
  return {
    directions: value.directions.map((direction) => (direction === "higher" || direction === "lower" ? direction : null)),
    best: value.best === true,
    second: value.second === true,
  };
}

function linkedLatexTable(value: unknown): LinkedLatexTable | null {
  if (!isRecord(value) || value.v !== 1 || typeof value.source !== "string" || typeof value.hash !== "string") return null;
  const options = value.options;
  if (!isRecord(options) || (options.format !== "csv" && options.format !== "json")) return null;
  const text = (key: string) => (typeof options[key] === "string" ? { [key]: options[key] } : {});
  const highlight = linkedHighlight(options.highlight);
  return {
    v: 1,
    source: value.source,
    hash: value.hash,
    options: {
      header: options.header !== false,
      format: options.format,
      ...text("caption"),
      ...text("label"),
      ...text("alignment"),
      ...(typeof options.boldHeader === "boolean" ? { boldHeader: options.boldHeader } : {}),
      ...(typeof options.delimiter === "string" && options.delimiter.length === 1 ? { delimiter: options.delimiter } : {}),
      ...(highlight ? { highlight } : {}),
    },
  };
}

function decodeLinkedLatexTable(value: string): LinkedLatexTable | null {
  try {
    return linkedLatexTable(JSON.parse(textFromBase64Url(value)));
  } catch {
    return null;
  }
}

export function emitLatexLinkedTable(rows: string[][], table: LinkedLatexTable): string {
  const lines = latexTableLines(rows, table.options);
  if (lines.length === 0) return "";
  lines.splice(1, 0, `  % ${LATEX_TABLE_MARK} ${base64UrlText(JSON.stringify(table))}`);
  return lines.join("\n");
}

export function findLinkedLatexTables(text: string): LinkedLatexTableMatch[] {
  if (!text.includes(LATEX_TABLE_MARK)) return [];
  const begins = [...text.matchAll(LATEX_TABLE_BEGIN)];
  const ends = [...text.matchAll(LATEX_TABLE_END)];
  const found: LinkedLatexTableMatch[] = [];
  for (const match of text.matchAll(LATEX_TABLE_MARK_LINE)) {
    const table = decodeLinkedLatexTable(match[3]);
    if (!table) continue;
    const from = match.index + match[1].length;
    const to = from + match[2].length;
    const begin = begins.filter((candidate) => candidate.index < from).at(-1);
    const end = ends.find((candidate) => candidate.index > to);
    if (!begin || !end || ends.some((candidate) => candidate.index > begin.index && candidate.index < from)) continue;
    found.push({ from, to, table, tableFrom: begin.index, tableTo: end.index + end[0].length, begin: begin[0] });
  }
  return found;
}

export function linkedTableRows(data: string, options: Pick<LinkedLatexTableOptions, "format" | "delimiter">): string[][] {
  if (options.format === "json") return parseJsonTable(data)?.rows ?? [];
  return parseDelimited(data, { delimiter: options.delimiter });
}

export function relinkLatexTable(match: LinkedLatexTableMatch, rows: string[][], hash: string): { from: number; to: number; insert: string } | null {
  const fresh = emitLatexLinkedTable(rows, { ...match.table, hash });
  if (!fresh) return null;
  return { from: match.tableFrom, to: match.tableTo, insert: match.begin + fresh.slice(fresh.indexOf("\n")) };
}
