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

/**
 * Parse CSV or TSV text into rows of cells. Embedded newlines inside quoted
 * CSV cells are supported by stitching physical lines while quotes stay
 * open. Delimiter: tab when the first line contains one, else comma.
 */
export function parseDelimited(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const firstLine = normalized.slice(0, normalized.indexOf("\n") === -1 ? undefined : normalized.indexOf("\n"));
  const delimiter = firstLine.includes("\t") ? "\t" : ",";
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

const NUMBER = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:[.,]\d+)?%?$/;

/** Infer one alignment letter per column: r for numeric, l otherwise. */
export function inferAlignment(rows: string[][], hasHeader: boolean): string {
  const { rows: padded, width } = padRows(rows);
  const body = hasHeader ? padded.slice(1) : padded;
  let alignment = "";
  for (let column = 0; column < width; column++) {
    const values = body.map((row) => row[column]).filter((value) => value !== "");
    const numeric = values.length > 0 && values.every((value) => NUMBER.test(value));
    alignment += numeric ? "r" : "l";
  }
  return alignment || "l".repeat(width || 1);
}

function flattenCell(value: string): string {
  // A cell cannot contain a row break; join wrapped lines with a space.
  return value.replace(/\s*\n\s*/g, " ");
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

/** Escape Typst markup content: backslash, brackets, and meaning-changers. */
export function escapeTypstCell(value: string): string {
  let out = "";
  for (const ch of flattenCell(value)) {
    switch (ch) {
      case "\\":
        out += "\\\\";
        break;
      case "[":
      case "]":
      case "#":
      case "$":
      case "@":
      case "*":
      case "_":
      case "`":
        out += `\\${ch}`;
        break;
      default:
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
  const alignment = options.alignment && options.alignment !== "auto"
    ? options.alignment.padEnd(rows[0].length, "l").slice(0, rows[0].length)
    : inferAlignment(rowsInput, options.header);
  const lines: string[] = ["\\begin{table}[htbp]", "  \\centering"];
  if (options.caption) {
    lines.push(`  \\caption{${options.caption}}`);
  }
  if (options.label) {
    lines.push(`  \\label{${options.label}}`);
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
  const alignment = options.alignment && options.alignment !== "auto"
    ? options.alignment.padEnd(rows[0].length, "l").slice(0, rows[0].length)
    : inferAlignment(rowsInput, options.header);
  const alignArg = alignment
    .split("")
    .map((letter) =>
      letter === "r" ? "right" : letter === "c" ? "center" : "left",
    )
    .join(", ");
  const lines: string[] = [];
  if (options.caption) {
    lines.push(`#figure(`);
  }
  lines.push(`#table(`);
  lines.push(`  columns: (${alignArg}),`);
  rows.forEach((row, index) => {
    const cells = row.map(escapeTypstCell);
    if (options.header && index === 0) {
      const headerCells = cells.map((cell) => (bold ? `[*${cell}*]` : `[${cell}]`));
      lines.push(`  table.header(${headerCells.join(", ")}),`);
    } else {
      lines.push(`  ${cells.map((cell) => `[${cell}]`).join(", ")},`);
    }
  });
  lines.push(")");
  if (options.caption) {
    lines.push(`  caption: [${options.caption}],`);
    lines.push(")");
  }
  return lines.join("\n");
}
