import type { JSONContent } from "@tiptap/core";
import {
  findEnvironment,
  scanMacroArguments,
  splitEnvironmentSource,
  splitTopLevel,
  stripLatexComments,
  type EnvironmentParts,
} from "./arguments";
import { paragraphOf, parseInlineSource } from "./inline-source";
import type { ParseContext } from "./parse-inline";
import { isBareStatement, scanStatements, singleMandatory, type LatexStatement } from "./statements";
import { tableSpecToColumns, type TableColumn } from "./table-spec";

const UNSUPPORTED_TABULAR = /\\(?:cline|multirow|begin|tabularnewline)(?![A-Za-z])|\\\\\s*\[/u;
const ROW_RULE = /^\s*\\(hline|toprule|midrule|bottomrule)(?![A-Za-z])/u;

interface CellDraft {
  colspan: number;
  columnSpec: string | null;
  content: string;
}

interface RowDraft {
  cells: CellDraft[];
  borderTop: string[];
  borderBottom: string[];
}

interface FloatState {
  centering: boolean;
  caption: string | null;
  captionPosition: "above" | "below" | null;
  label: string | null;
}

function parseCellDraft(cell: string): CellDraft | null {
  if (!/^\\multicolumn(?![A-Za-z])/u.test(cell)) return { colspan: 1, columnSpec: null, content: cell };
  const scanned = scanMacroArguments(cell, "\\multicolumn".length);
  const mandatory = scanned.args.filter((arg) => arg.kind === "mandatory");
  if (scanned.args.length !== 3 || mandatory.length !== 3 || scanned.end < cell.length) return null;
  const colspan = Number(mandatory[0].value.trim());
  if (!Number.isInteger(colspan) || colspan < 1) return null;
  return { colspan, columnSpec: mandatory[1].value, content: mandatory[2].value };
}

function parseRowSegment(segment: string): { rules: string[]; cells: CellDraft[] | null } | null {
  let rest = segment;
  const rules: string[] = [];
  for (;;) {
    const match = ROW_RULE.exec(rest);
    if (!match) break;
    rules.push(match[1]);
    rest = rest.slice(match[0].length);
    if (/^\s*\[/u.test(rest)) return null;
  }
  if (rest.trim() === "") return { rules, cells: null };
  const cells: CellDraft[] = [];
  for (const cell of splitTopLevel(rest, "&")) {
    const draft = parseCellDraft(cell.trim());
    if (!draft) return null;
    cells.push(draft);
  }
  return { rules, cells };
}

function rowsFromBody(body: string): RowDraft[] | null {
  const segments = splitTopLevel(body, "\\\\");
  const rows: RowDraft[] = [];
  for (const [index, segment] of segments.entries()) {
    const parsed = parseRowSegment(segment);
    if (!parsed) return null;
    if (parsed.cells) {
      rows.push({ cells: parsed.cells, borderTop: parsed.rules, borderBottom: [] });
      continue;
    }
    if (index !== segments.length - 1) {
      rows.push({ cells: [{ colspan: 1, columnSpec: null, content: "" }], borderTop: parsed.rules, borderBottom: [] });
      continue;
    }
    const last = rows.at(-1);
    if (parsed.rules.length === 0) continue;
    if (!last) return null;
    last.borderBottom = parsed.rules;
  }
  return rows.length ? rows : null;
}

function rulesAttribute(rules: string[]): string | null {
  return rules.length ? rules.join(" ") : null;
}

function cellJSON(cell: CellDraft, type: string, context: ParseContext): JSONContent {
  return {
    type,
    attrs: { colspan: cell.colspan, rowspan: 1, columnSpec: cell.columnSpec },
    content: [paragraphOf(parseInlineSource(cell.content, context))],
  };
}

function rowJSON(row: RowDraft, width: number, header: boolean, context: ParseContext): JSONContent | null {
  const span = row.cells.reduce((sum, cell) => sum + cell.colspan, 0);
  if (span > width) return null;
  const filler = Array.from({ length: width - span }, (): CellDraft => ({ colspan: 1, columnSpec: null, content: "" }));
  return {
    type: "tableRow",
    attrs: { borderTop: rulesAttribute(row.borderTop), borderBottom: rulesAttribute(row.borderBottom) },
    content: [...row.cells, ...filler].map((cell) => cellJSON(cell, header ? "tableHeader" : "tableCell", context)),
  };
}

function tableJSON(rows: RowDraft[], columns: TableColumn[], context: ParseContext): JSONContent | null {
  const header = rows.length > 1 && (rows[0].borderBottom.length > 0 || rows[1].borderTop.length > 0);
  const content: JSONContent[] = [];
  for (const [index, row] of rows.entries()) {
    const node = rowJSON(row, columns.length, header && index === 0, context);
    if (!node) return null;
    content.push(node);
  }
  return { type: "table", content };
}

function tabularParts(inner: string): { spec: string; body: string } | null {
  const scanned = scanMacroArguments(inner, 0);
  if (scanned.starred || scanned.args.length !== 1 || scanned.args[0].kind !== "mandatory") return null;
  return { spec: scanned.args[0].value, body: inner.slice(scanned.end) };
}

function parseTabular(inner: string, context: ParseContext): { table: JSONContent; columns: TableColumn[] } | null {
  const parts = tabularParts(stripLatexComments(inner));
  const columns = parts ? tableSpecToColumns(parts.spec) : null;
  if (!parts || !columns || UNSUPPORTED_TABULAR.test(parts.body)) return null;
  const rows = rowsFromBody(parts.body);
  const table = rows ? tableJSON(rows, columns, context) : null;
  return table ? { table, columns } : null;
}

const FLOAT_HANDLERS: Record<string, (state: FloatState, statement: LatexStatement, position: "above" | "below") => boolean> = {
  centering: (state, statement) => {
    if (state.centering || !isBareStatement(statement)) return false;
    state.centering = true;
    return true;
  },
  caption: (state, statement, position) => {
    const value = singleMandatory(statement);
    if (value === null || state.caption !== null) return false;
    state.caption = value;
    state.captionPosition = position;
    return true;
  },
  label: (state, statement) => {
    const value = singleMandatory(statement);
    if (value === null || state.label !== null) return false;
    state.label = value;
    return true;
  },
};

function applyFloatStatements(state: FloatState, source: string, position: "above" | "below"): boolean {
  const statements = scanStatements(source);
  if (!statements) return false;
  return statements.every((statement) => {
    const handler = Object.hasOwn(FLOAT_HANDLERS, statement.name) ? FLOAT_HANDLERS[statement.name] : null;
    return handler !== null && handler(state, statement, position);
  });
}

function floatJSON(
  parsed: { table: JSONContent; columns: TableColumn[] },
  state: FloatState,
  placement: string | null,
  floating: boolean,
  context: ParseContext,
): JSONContent {
  const caption =
    state.caption === null ? [] : [{ type: "tableCaption", content: parseInlineSource(state.caption, context) }];
  return {
    type: "tableFloat",
    attrs: {
      placement,
      centering: state.centering,
      label: state.label,
      captionPosition: state.captionPosition,
      columns: parsed.columns,
      floating,
    },
    content: [parsed.table, ...caption],
  };
}

function bareTabular(parts: EnvironmentParts, context: ParseContext): JSONContent | null {
  if (parts.optional !== null) return null;
  const parsed = parseTabular(parts.body, context);
  if (!parsed) return null;
  const state: FloatState = { centering: false, caption: null, captionPosition: null, label: null };
  return floatJSON(parsed, state, null, false, context);
}

function tableFloat(parts: EnvironmentParts, context: ParseContext): JSONContent | null {
  const body = stripLatexComments(parts.body);
  const found = findEnvironment(body, "tabular");
  if (!found) return null;
  const before = body.slice(0, found.start);
  const after = body.slice(found.end);
  if (/\\begin\{/u.test(before + after)) return null;
  const state: FloatState = { centering: false, caption: null, captionPosition: null, label: null };
  if (!applyFloatStatements(state, before, "above") || !applyFloatStatements(state, after, "below")) return null;
  const parsed = parseTabular(found.inner, context);
  return parsed ? floatJSON(parsed, state, parts.optional, true, context) : null;
}

export function parseTableEnvironment(source: string, context: ParseContext): JSONContent | null {
  const parts = splitEnvironmentSource(source);
  if (!parts) return null;
  if (parts.name === "tabular") return bareTabular(parts, context);
  if (parts.name === "table") return tableFloat(parts, context);
  return null;
}
