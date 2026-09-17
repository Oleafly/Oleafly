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

const ABSOLUTE_WIDTH = /^\s*(\d*\.?\d+)\s*(cm|mm|in|pt)\s*$/u;

const RELATIVE_WIDTH = /^\s*(\d*\.?\d+)\s*\\(linewidth|textwidth|columnwidth)\s*$/u;

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

export function parseColumnSpec(spec: string): ColumnSpec[] {
  const columns: ColumnSpec[] = [];
  let pending = emptyColumn();
  let hasAlignment = false;

  const commit = () => {
    if (!hasAlignment) return;
    columns.push(pending);
    pending = emptyColumn();
    hasAlignment = false;
  };

  for (let index = 0; index < spec.length; index++) {
    const char = spec.charAt(index);
    if (char in ALIGNMENT_LETTERS || PARAGRAPH_LETTERS.has(char) || char === "X" || char === ">") {
      commit();
    }
    if (char === "|") {
      if (hasAlignment) pending.borderRight++;
      else pending.borderLeft++;
    } else if (char in ALIGNMENT_LETTERS) {
      pending.alignment = ALIGNMENT_LETTERS[char];
      pending.content = char;
      hasAlignment = true;
    } else if (PARAGRAPH_LETTERS.has(char)) {
      const close = readBraced(spec, index + 1);
      const argument = spec.slice(index + 2, close);
      pending.paragraph = true;
      pending.alignment = alignmentFromPrefix(pending.prefix) ?? "paragraph";
      pending.content = spec.slice(index, close + 1);
      pending.width = parseColumnWidth(argument);
      hasAlignment = true;
      index = close;
    } else if (char === "X") {
      pending.paragraph = true;
      pending.alignment = alignmentFromPrefix(pending.prefix) ?? "paragraph";
      pending.content = "X";
      hasAlignment = true;
    } else if (char === "@" || char === "!") {
      const close = readBraced(spec, index + 1);
      const argument = spec.slice(index, close + 1);
      if (hasAlignment) pending.spacingRight += argument;
      else pending.spacingLeft += argument;
      index = close;
    } else if (char === ">") {
      const close = readBraced(spec, index + 1);
      pending.prefix = spec.slice(index, close + 1);
      index = close;
    } else if (!/\s/u.test(char)) {
      throw new ColumnSpecError(`Unsupported column specifier "${char}"`);
    }
  }
  commit();
  if (pending.prefix) throw new ColumnSpecError("A column prefix must be followed by a column");
  if (pending.borderLeft > 0 || pending.spacingLeft) {
    const last = columns[columns.length - 1];
    if (!last) throw new ColumnSpecError("The column specification declares no columns");
    last.borderRight += pending.borderLeft;
    last.spacingRight += pending.spacingLeft;
  }
  return columns;
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
  if (alignment === "left") return ">{\\raggedright\\arraybackslash}";
  if (alignment === "right") return ">{\\raggedleft\\arraybackslash}";
  if (alignment === "center") return ">{\\centering\\arraybackslash}";
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
