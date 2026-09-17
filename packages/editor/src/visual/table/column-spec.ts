export type ColumnAlignment = "left" | "center" | "right" | "paragraph";

export type AbsoluteWidthUnit = "cm" | "mm" | "in" | "pt";

export type RelativeWidthCommand = "linewidth" | "textwidth" | "columnwidth";

export type ColumnWidth =
  | { kind: "absolute"; value: number; unit: AbsoluteWidthUnit }
  | { kind: "relative"; fraction: number; command: RelativeWidthCommand }
  | { kind: "custom"; raw: string };

export interface ColumnSpec {
  alignment: ColumnAlignment;
  borderLeft: number;
  borderRight: number;
  content: string;
  spacingLeft: string;
  spacingRight: string;
  prefix: string;
  paragraph: boolean;
  width?: ColumnWidth;
}

export class ColumnSpecError extends Error {}

const ALIGNMENT_LETTERS: Record<string, ColumnAlignment> = {
  l: "left",
  c: "center",
  r: "right",
};

const PARAGRAPH_LETTERS = new Set(["p", "m", "b"]);

const ABSOLUTE_WIDTH = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(cm|mm|in|pt)\s*$/u;

const RELATIVE_WIDTH = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*\\(linewidth|textwidth|columnwidth)\s*$/u;

const PREFIX_ALIGNMENT = /\\(raggedright|raggedleft|centering)\b/u;

function readBraced(spec: string, openIndex: number): number {
  if (spec.charAt(openIndex) !== "{") {
    throw new ColumnSpecError("Expected an opening brace in the column specification");
  }
  let depth = 0;
  for (let index = openIndex; index < spec.length; index++) {
    const char = spec.charAt(index);
    if (char === "{") depth++;
    else if (char === "}") depth--;
    if (depth === 0) return index;
  }
  throw new ColumnSpecError("Unclosed brace in the column specification");
}

export function parseColumnWidth(argument: string): ColumnWidth {
  const absolute = ABSOLUTE_WIDTH.exec(argument);
  if (absolute) {
    return { kind: "absolute", value: Number.parseFloat(absolute[1]), unit: absolute[2] as AbsoluteWidthUnit };
  }
  const relative = RELATIVE_WIDTH.exec(argument);
  if (relative) {
    return {
      kind: "relative",
      fraction: Number.parseFloat(relative[1]),
      command: relative[2] as RelativeWidthCommand,
    };
  }
  return { kind: "custom", raw: argument.trim() };
}

function alignmentFromPrefix(prefix: string): ColumnAlignment | null {
  const match = PREFIX_ALIGNMENT.exec(prefix);
  if (!match) return null;
  if (match[1] === "raggedright") return "left";
  if (match[1] === "raggedleft") return "right";
  return "center";
}

function emptyColumn(): ColumnSpec {
  return {
    alignment: "left",
    borderLeft: 0,
    borderRight: 0,
    content: "",
    spacingLeft: "",
    spacingRight: "",
    prefix: "",
    paragraph: false,
  };
}

interface SpecReader {
  columns: ColumnSpec[];
  pending: ColumnSpec;
  hasAlignment: boolean;
}

function commitColumn(reader: SpecReader): void {
  if (!reader.hasAlignment) return;
  reader.columns.push(reader.pending);
  reader.pending = emptyColumn();
  reader.hasAlignment = false;
}

function startsColumn(char: string): boolean {
  return char in ALIGNMENT_LETTERS || PARAGRAPH_LETTERS.has(char) || char === "X" || char === ">";
}

function readBorder(reader: SpecReader): void {
  if (reader.hasAlignment) reader.pending.borderRight++;
  else reader.pending.borderLeft++;
}

function readAlignmentLetter(reader: SpecReader, char: string): void {
  reader.pending.alignment = ALIGNMENT_LETTERS[char];
  reader.pending.content = char;
  reader.hasAlignment = true;
}

function readParagraphColumn(reader: SpecReader, spec: string, index: number): number {
  const close = readBraced(spec, index + 1);
  const argument = spec.slice(index + 2, close);
  reader.pending.paragraph = true;
  reader.pending.alignment = alignmentFromPrefix(reader.pending.prefix) ?? "paragraph";
  reader.pending.content = spec.slice(index, close + 1);
  reader.pending.width = parseColumnWidth(argument);
  reader.hasAlignment = true;
  return close;
}

function readStretchColumn(reader: SpecReader): void {
  reader.pending.paragraph = true;
  reader.pending.alignment = alignmentFromPrefix(reader.pending.prefix) ?? "paragraph";
  reader.pending.content = "X";
  reader.hasAlignment = true;
}

function readSpacing(reader: SpecReader, spec: string, index: number): number {
  const close = readBraced(spec, index + 1);
  const argument = spec.slice(index, close + 1);
  if (reader.hasAlignment) reader.pending.spacingRight += argument;
  else reader.pending.spacingLeft += argument;
  return close;
}

function readPrefix(reader: SpecReader, spec: string, index: number): number {
  const close = readBraced(spec, index + 1);
  reader.pending.prefix = spec.slice(index, close + 1);
  return close;
}

function readSpecifier(reader: SpecReader, spec: string, index: number): number {
  const char = spec.charAt(index);
  if (char === "|") readBorder(reader);
  else if (char in ALIGNMENT_LETTERS) readAlignmentLetter(reader, char);
  else if (PARAGRAPH_LETTERS.has(char)) return readParagraphColumn(reader, spec, index);
  else if (char === "X") readStretchColumn(reader);
  else if (char === "@" || char === "!") return readSpacing(reader, spec, index);
  else if (char === ">") return readPrefix(reader, spec, index);
  else if (!/\s/u.test(char)) throw new ColumnSpecError(`Unsupported column specifier "${char}"`);
  return index;
}

function closeTrailingSpec(reader: SpecReader): void {
  if (reader.pending.prefix) throw new ColumnSpecError("A column prefix must be followed by a column");
  if (reader.pending.borderLeft <= 0 && !reader.pending.spacingLeft) return;
  const last = reader.columns.at(-1);
  if (!last) throw new ColumnSpecError("The column specification declares no columns");
  last.borderRight += reader.pending.borderLeft;
  last.spacingRight += reader.pending.spacingLeft;
}

export function parseColumnSpec(spec: string): ColumnSpec[] {
  const reader: SpecReader = { columns: [], pending: emptyColumn(), hasAlignment: false };
  let index = 0;
  while (index < spec.length) {
    if (startsColumn(spec.charAt(index))) commitColumn(reader);
    index = readSpecifier(reader, spec, index) + 1;
  }
  commitColumn(reader);
  closeTrailingSpec(reader);
  return reader.columns;
}

export function serializeColumnSpec(columns: readonly ColumnSpec[]): string {
  return columns
    .map(
      (column) =>
        `${"|".repeat(column.borderLeft)}${column.spacingLeft}${column.prefix}${column.content}${column.spacingRight}${"|".repeat(column.borderRight)}`,
    )
    .join("");
}

export function plainColumn(alignment: Exclude<ColumnAlignment, "paragraph">): ColumnSpec {
  return { ...emptyColumn(), alignment, content: alignment.charAt(0) };
}

export function paragraphPrefix(alignment: ColumnAlignment): string {
  if (alignment === "left") return String.raw`>{\raggedright\arraybackslash}`;
  if (alignment === "right") return String.raw`>{\raggedleft\arraybackslash}`;
  if (alignment === "center") return String.raw`>{\centering\arraybackslash}`;
  return "";
}

export function widthArgument(width: ColumnWidth): string {
  if (width.kind === "absolute") return `${trimNumber(width.value)}${width.unit}`;
  if (width.kind === "relative") return `${trimNumber(width.fraction)}\\${width.command}`;
  return width.raw;
}

export function formatColumnWidth(width: ColumnWidth): string {
  if (width.kind === "absolute") return `${trimNumber(width.value)}${width.unit}`;
  if (width.kind === "relative") return `${trimNumber(width.fraction * 100)}%`;
  return width.raw;
}

export function trimNumber(value: number): string {
  return Number.parseFloat(value.toFixed(3)).toString();
}
