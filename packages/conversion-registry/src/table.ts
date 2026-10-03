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

export interface TableOptions {
  /** Treat the first row as a header row. */
  header: boolean;
  /** Table caption (LaTeX) or figure caption (Typst). */
  caption?: string;
  /** LaTeX label like `tab:results`. */
  label?: string;
  /**
   * Column alignment: "auto" infers per column (numbers right, text left),
   * or an explicit string like "lcc".
   */
  alignment?: string;
  /** Bold the header row (default true when a header exists). */
  boldHeader?: boolean;
}

/** Quote-aware split of one record; `quoted` tracks being inside quotes. */
function splitRecord(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"' && current === "") {
      quoted = true;
    } else if (ch === delimiter) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

export function delimiterOf(text: string): string {
  return detectDelimiter(text.replace(/\r\n?/g, "\n"));
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
    if (!quoted && character === "\n") break;
    if (!quoted && character === "\t") tabs += 1;
  }
  return tabs > 0 ? "\t" : ",";
}

/**
 * Parse CSV or TSV text into rows of cells. Embedded newlines inside quoted
 * CSV cells are supported by stitching physical lines while quotes stay
 * open. The delimiter is chosen from unquoted cells in the first record.
 */
export function parseDelimited(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const delimiter = detectDelimiter(normalized);
  const physical = normalized.split("\n");

  // Stitch quoted cells that span physical lines: track whether quotes are
  // open; each physical line with an odd number of quotes toggles the state.
  const records: string[] = [];
  let open = false;
  let carry = "";
  for (const line of physical) {
    carry = open ? `${carry}\n${line}` : line;
    const quotes = (line.match(/"/g) ?? []).length;
    if (quotes % 2 === 1) {
      open = !open;
    }
    if (!open) {
      records.push(carry);
      carry = "";
    }
  }
  if (carry !== "" || open) {
    records.push(carry);
  }

  const rows = records
    .filter((record) => record !== "")
    .map((record) => splitRecord(record, delimiter).map((cell) => cell.trim()));
  // Drop fully-empty trailing records.
  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell === "")) {
    rows.pop();
  }
  return rows;
}

/** Normalize row widths so every row has `width` cells. */
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

/**
 * Whether a cell is a plain decimal number, with optional grouping commas,
 * decimal point, sign, and percent suffix. This deliberately uses a bounded
 * character scan instead of a nested regular expression: tables are imported
 * from untrusted files and this runs once for every populated cell.
 */
function isNumericCell(value: string): boolean {
  let text = value;
  if (text.endsWith("%")) text = text.slice(0, -1);
  if (!text) return false;
  if (text[0] === "-" || text[0] === "+") text = text.slice(1);
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

/** Infer one alignment letter per column: r for numeric, l otherwise. */
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
  // A cell cannot contain a row break; join wrapped lines with a space.
  const lines = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  return lines.length === 1 ? value : lines.map((line) => line.trim()).join(" ");
}

/** Escape one character exactly once; see the module comment. */
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
  return character !== undefined && character.trim() === "";
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

/** Emit a booktabs `table`/`tabular` environment. */
export function emitLatexTable(rowsInput: string[][], options: TableOptions): string {
  const { rows } = padRows(rowsInput);
  if (rows.length === 0) {
    return "";
  }
  const bold = options.boldHeader ?? true;
  const alignment = explicitAlignment(options.alignment, rows[0].length)
    ?? inferAlignment(rowsInput, options.header);
  const lines: string[] = ["\\begin{table}[htbp]", "  \\centering"];
  if (options.caption) {
    lines.push(`  \\caption{${escapeLatexCell(options.caption)}}`);
  }
  const label = options.label?.trim();
  if (label && isValidLatexLabel(label)) {
    lines.push(`  \\label{${label}}`);
  }
  lines.push(`  \\begin{tabular}{${alignment}}`, "    \\toprule");
  rows.forEach((row, index) => {
    const cells = row.map(escapeLatexCell);
    const isHeader = options.header && index === 0;
    if (isHeader && bold) {
      lines.push(`    ${cells.map((cell) => `\\textbf{${cell}}`).join(" & ")} \\\\`);
    } else {
      lines.push(`    ${cells.join(" & ")} \\\\`);
    }
    if (isHeader) {
      lines.push("    \\midrule");
    }
  });
  lines.push("    \\bottomrule", "  \\end{tabular}", "\\end{table}");
  return lines.join("\n");
}

/** Emit a Typst `#table` with a strong header row. */
export function emitTypstTable(rowsInput: string[][], options: TableOptions): string {
  const { rows } = padRows(rowsInput);
  if (rows.length === 0) {
    return "";
  }
  const bold = options.boldHeader ?? true;
  const alignment = explicitAlignment(options.alignment, rows[0].length)
    ?? inferAlignment(rowsInput, options.header);
  const alignments = [...alignment].map((letter) =>
    letter === "r" ? "right" : letter === "c" ? "center" : "left",
  );
  const alignArg = alignments.length === 1 ? alignments[0] : `(${alignments.join(", ")})`;
  const body: string[] = [
    `columns: ${alignments.length},`,
    `align: ${alignArg},`,
    "stroke: none,",
    "table.hline(),",
  ];
  rows.forEach((row, index) => {
    const cells = row.map(escapeTypstCell);
    if (options.header && index === 0) {
      const headerCells = cells.map((cell) => (bold && cell ? `[*${cell}*]` : `[${cell}]`));
      body.push(`table.header(${headerCells.join(", ")}),`, "table.hline(stroke: 0.5pt),");
    } else {
      body.push(`${cells.map((cell) => `[${cell}]`).join(", ")},`);
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
    else if (character === "\n") out += "\\n";
    else if (character === "\r") out += "\\r";
    else if (character === "\t") out += "\\t";
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
    return {
      prelude,
      columns: `${data}.first().len()`,
      header: `table.header(..${strong(`${data}.first().map(${cell})`)}),`,
      body: options.header ? `..${data}.slice(1).flatten().map(${cell}),` : `..${data}.flatten().map(${cell}),`,
    };
  }
  return {
    prelude,
    columns: `${data}.first().len()`,
    header: `table.header(..${strong(`${data}.first()`)}),`,
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
  const alignments = [...alignment].map((letter) =>
    letter === "r" ? "right" : letter === "c" ? "center" : "left",
  );
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
