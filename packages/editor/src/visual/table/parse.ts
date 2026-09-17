import type { EditorState } from "@codemirror/state";
import { type ColumnSpec, parseColumnSpec } from "./column-spec";
import {
  type CellData,
  type ParsedTable,
  type RowLayout,
  type TableEnvironmentInfo,
  TableModel,
  cellSpan,
} from "./model";
import { type SyntaxNode, type TextRange, lastChildOfType, rangeContains } from "./syntax";

export class TableParseError extends Error {}

const SKIPPED_NODES = new Set(["NewLine", "Whitespace", "Comment", "BlankLine"]);

const UNSUPPORTED_COMMANDS = new Set(["\\cline", "\\cmidrule", "\\multirow"]);

interface RuleInfo extends TextRange {
  text: string;
}

interface WorkingRow {
  cells: CellData[];
  separators: TextRange[];
  rules: RuleInfo[];
  range: { from: number; to: number };
}

interface WorkingBody {
  rows: WorkingRow[];
  rowSeparators: TextRange[];
}

function newRow(at: number): WorkingRow {
  return { cells: [{ content: "", from: at, to: at }], separators: [], rules: [], range: { from: at, to: at } };
}

function isLineBreak(node: SyntaxNode): boolean {
  return node.type.is("Command") && Boolean(node.getChild("KnownCtrlSym")?.getChild("LineBreak"));
}

function ruleOf(node: SyntaxNode): SyntaxNode | null {
  if (!node.type.is("Command")) return null;
  return node.getChild("KnownCommand")?.getChild("HorizontalLine") ?? null;
}

function multiColumnOf(node: SyntaxNode): SyntaxNode | null {
  if (!node.type.is("Command")) return null;
  return node.getChild("KnownCommand")?.getChild("MultiColumn") ?? null;
}

function unsupportedCommandOf(node: SyntaxNode, state: EditorState): string | null {
  if (!node.type.is("Command")) return null;
  const control = node.getChild("UnknownCommand")?.getChild("CtrlSeq");
  if (!control) return null;
  const name = state.sliceDoc(control.from, control.to);
  return UNSUPPORTED_COMMANDS.has(name) ? name : null;
}

function isNestedTable(node: SyntaxNode): boolean {
  return node.type.is("KnownEnvironment") && Boolean(node.firstChild?.type.is("TabularEnvironment"));
}

function trimCellEnd(cell: CellData): void {
  if (cell.multiColumn) return;
  const trimmed = cell.content.trimEnd();
  cell.to -= cell.content.length - trimmed.length;
  cell.content = trimmed;
}

function readMultiColumn(cell: CellData, command: SyntaxNode, multi: SyntaxNode, state: EditorState): void {
  const span = multi.getChild("SpanArgument")?.getChild("ShortTextArgument")?.getChild("ShortArg");
  const columns = multi.getChild("ColumnArgument")?.getChild("ShortTextArgument")?.getChild("ShortArg");
  const content = multi.getChild("TabularArgument")?.getChild("TabularContent");
  if (!span || !columns || !content) throw new TableParseError("Incomplete multicolumn command");
  if (cell.content.trim() !== "" || cell.multiColumn) {
    throw new TableParseError("A multicolumn must start its cell");
  }
  const count = Number.parseInt(state.sliceDoc(span.from, span.to), 10);
  if (!Number.isInteger(count) || count < 1) throw new TableParseError("Invalid multicolumn span");
  cell.multiColumn = {
    span: count,
    columns: parseColumnSpec(state.sliceDoc(columns.from, columns.to)),
    spec: { from: columns.from, to: columns.to },
    from: command.from,
    to: command.to,
    preamble: { from: command.from, to: content.from },
    postamble: { from: content.to, to: command.to },
  };
  cell.content = state.sliceDoc(content.from, content.to);
  cell.from = content.from;
  cell.to = content.to;
}

function parseBody(body: SyntaxNode, state: EditorState): WorkingBody {
  const rows: WorkingRow[] = [newRow(body.from)];
  const rowSeparators: TextRange[] = [];

  for (let child = body.firstChild; child; child = child.nextSibling) {
    const row = rows[rows.length - 1];
    const cell = row.cells[row.cells.length - 1];
    if (isLineBreak(child)) {
      trimCellEnd(cell);
      row.range.to = child.to;
      rowSeparators.push({ from: child.from, to: child.to });
      rows.push(newRow(child.to));
      continue;
    }
    const multi = multiColumnOf(child);
    const rule = ruleOf(child);
    if (child.type.is("Ampersand")) {
      trimCellEnd(cell);
      row.separators.push({ from: child.from, to: child.to });
      row.cells.push({ content: "", from: child.to, to: child.to });
    } else if (multi) {
      readMultiColumn(cell, child, multi, state);
    } else if (SKIPPED_NODES.has(child.name)) {
      if (!cell.multiColumn) {
        if (cell.content.trim() === "") {
          cell.from = child.to;
          cell.to = child.to;
        } else {
          cell.content += state.sliceDoc(child.from, child.to);
          cell.to = child.to;
        }
      }
    } else if (rule) {
      if (cell.content.trim() !== "" || row.cells.length > 1 || cell.multiColumn) {
        throw new TableParseError("A horizontal rule must start a row");
      }
      cell.from = child.to;
      cell.to = child.to;
      row.rules.push({ from: child.from, to: child.to, text: state.sliceDoc(rule.from, rule.to).trim() });
    } else {
      const unsupported = unsupportedCommandOf(child, state);
      if (unsupported) throw new TableParseError(`Unsupported command ${unsupported}`);
      if (isNestedTable(child)) throw new TableParseError("Nested tables are not supported");
      if (cell.multiColumn) throw new TableParseError("Content after a multicolumn cell");
      cell.content += state.sliceDoc(child.from, child.to);
      cell.to = child.to;
    }
    row.range.to = child.to;
  }
  const lastRow = rows[rows.length - 1];
  trimCellEnd(lastRow.cells[lastRow.cells.length - 1]);
  return { rows, rowSeparators };
}

export function parseTabular(node: SyntaxNode, state: EditorState): ParsedTable {
  const begin = node.getChild("BeginEnv");
  const specArgument = begin ? lastChildOfType(begin, "TextArgument") : null;
  if (!specArgument) throw new TableParseError("Missing column specification");
  const open = specArgument.getChild("OpenBrace");
  const close = specArgument.getChild("CloseBrace");
  if (!open || !close) throw new TableParseError("Unbalanced column specification");
  const spec: TextRange = { from: open.to, to: close.from };
  let columns: ColumnSpec[];
  try {
    columns = parseColumnSpec(state.sliceDoc(spec.from, spec.to));
  } catch (error) {
    throw new TableParseError(error instanceof Error ? error.message : "Invalid column specification");
  }
  const body = node.getChild("Content")?.getChild("TabularContent");
  if (!body) throw new TableParseError("Missing table body");

  const { rows: working, rowSeparators } = parseBody(body, state);
  const trailing = working[working.length - 1];
  let rulesBelow: RuleInfo[] = [];
  if (working.length > 1 && trailing.cells.length === 1 && trailing.cells[0].content.trim() === "") {
    working.pop();
    rulesBelow = trailing.rules;
    const previous = working[working.length - 1];
    if (rulesBelow.length > 0) previous.range.to = rulesBelow[rulesBelow.length - 1].to;
  }

  const lastIndex = working.length - 1;
  const rows = working.map((row, index) => ({
    cells: row.cells,
    rulesAbove: row.rules.map((rule) => rule.text),
    rulesBelow: index === lastIndex ? rulesBelow.map((rule) => rule.text) : [],
  }));
  const layout: RowLayout[] = working.map((row, index) => ({
    range: { ...row.range },
    rulesAbove: row.rules.map(({ from, to }) => ({ from, to })),
    rulesBelow: index === lastIndex ? rulesBelow.map(({ from, to }) => ({ from, to })) : [],
  }));

  return {
    model: new TableModel(rows, columns),
    tabular: { from: node.from, to: node.to },
    spec,
    body: { from: body.from, to: body.to },
    rows: layout,
    rowSeparators,
    cellSeparators: working.map((row) => row.separators),
  };
}

export function isRenderableTable(parsed: ParsedTable): boolean {
  const { model } = parsed;
  if (model.columnCount === 0 || model.rowCount === 0) return false;
  for (const row of model.rows) {
    let width = 0;
    for (const cell of row.cells) {
      if (cell.multiColumn && cell.multiColumn.columns.length !== 1) return false;
      width += cellSpan(cell);
    }
    if (width !== model.columnCount) return false;
  }
  return true;
}

export function parseTableEnvironment(tableNode: SyntaxNode, tabular: TextRange): TableEnvironmentInfo {
  const info: TableEnvironmentInfo = { range: { from: tableNode.from, to: tableNode.to } };
  tableNode.cursor().iterate((ref) => {
    if (info.caption && info.label) return false;
    if (rangeContains(tabular, ref)) return false;
    if (ref.type.is("Caption") && !info.caption) info.caption = { from: ref.from, to: ref.to };
    else if (ref.type.is("Label") && !info.label) info.label = { from: ref.from, to: ref.to };
    return undefined;
  });
  return info;
}
