import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { type ColumnAlignment, plainColumn } from "../../table/column-spec";
import { type CellData, type ParsedTable, type RowData, type RowLayout, TableModel } from "../../table/model";
import {
  argumentNodes,
  calleeName,
  closingParenthesis,
  contentBody,
  hasErrorNode,
  insideParentheses,
  namedValue,
  type TextRange,
  trailingContentBlocks,
} from "../syntax";

export type TypstAlignment = Exclude<ColumnAlignment, "paragraph">;

export interface TypstCell extends CellData {
  node: TextRange;
}

export interface TypstRow {
  cells: TypstCell[];
  header: boolean;
  range: TextRange;
  rulesAbove: TextRange[];
}

export interface TypstNamedArgument {
  name: string;
  named: TextRange;
  value: TextRange;
  kind: string;
  items: TextRange[];
}

export interface TypstTable {
  parsed: ParsedTable;
  call: TextRange;
  open: number;
  close: number;
  columnCount: number;
  columns: TypstNamedArgument | null;
  align: TypstNamedArgument | null;
  stroke: TypstNamedArgument | null;
  named: TypstNamedArgument[];
  rows: TypstRow[];
  headerRow: boolean;
  alignments: TypstAlignment[];
  alignEditable: boolean;
  bordered: boolean;
  firstItem: TextRange | null;
}

const MAX_COLUMNS = 64;
const HLINE = "hline";

function range(node: TextRange): TextRange {
  return { from: node.from, to: node.to };
}

function arrayItems(node: SyntaxNode): TextRange[] {
  return argumentNodes(node).map(range);
}

function readNamed(state: EditorState, node: SyntaxNode): TypstNamedArgument | null {
  const value = namedValue(node);
  const key = node.firstChild;
  if (!value || !key) return null;
  return {
    name: state.sliceDoc(key.from, key.to),
    named: range(node),
    value: range(value),
    kind: value.name,
    items: value.name === "Array" ? arrayItems(value) : [],
  };
}

export function typstAlignment(text: string): TypstAlignment {
  if (/\bcenter\b/u.test(text)) return "center";
  if (/\b(?:right|end)\b/u.test(text)) return "right";
  return "left";
}

function columnCountOf(state: EditorState, columns: TypstNamedArgument | null): number | null {
  if (!columns) return 1;
  if (columns.kind === "Int") {
    const count = Number.parseInt(state.sliceDoc(columns.value.from, columns.value.to), 10);
    return Number.isInteger(count) && count > 0 && count <= MAX_COLUMNS ? count : null;
  }
  if (columns.kind === "Array" && columns.items.length > 0 && columns.items.length <= MAX_COLUMNS) {
    return columns.items.length;
  }
  return null;
}

function alignmentsOf(
  state: EditorState,
  align: TypstNamedArgument | null,
  count: number,
): { alignments: TypstAlignment[]; editable: boolean } {
  const all = (alignment: TypstAlignment) => Array.from({ length: count }, () => alignment);
  if (!align) return { alignments: all("left"), editable: true };
  if (align.kind === "Ident" || align.kind === "Binary") {
    return { alignments: all(typstAlignment(state.sliceDoc(align.value.from, align.value.to))), editable: true };
  }
  if (align.kind === "Array" && align.items.length > 0) {
    const values = align.items.map((item) => typstAlignment(state.sliceDoc(item.from, item.to)));
    return {
      alignments: Array.from({ length: count }, (_, index) => values[index % values.length]),
      editable: true,
    };
  }
  return { alignments: all("left"), editable: false };
}

function cellOf(state: EditorState, block: SyntaxNode): TypstCell | null {
  if (block.name !== "ContentBlock") return null;
  const body = contentBody(block);
  if (!body) return null;
  return { content: state.sliceDoc(body.from, body.to), from: body.from, to: body.to, node: range(block) };
}

interface Collected {
  cells: TypstCell[];
  header: { cells: TypstCell[]; range: TextRange } | null;
  rules: Map<number, TextRange[]>;
  named: TypstNamedArgument[];
  firstItem: TextRange | null;
}

function headerCells(state: EditorState, call: SyntaxNode): TypstCell[] | null {
  const args = call.getChild("Args");
  if (!args || !insideParentheses(args) || trailingContentBlocks(args).length > 0) return null;
  const cells: TypstCell[] = [];
  for (const node of argumentNodes(args)) {
    if (node.name === "Named") continue;
    const cell = cellOf(state, node);
    if (!cell) return null;
    cells.push(cell);
  }
  return cells;
}

function collectCall(state: EditorState, node: SyntaxNode, collected: Collected): boolean {
  const name = calleeName(state, node);
  if (name === "table.header" && !collected.header && collected.cells.length === 0) {
    const cells = headerCells(state, node);
    if (!cells) return false;
    collected.header = { cells, range: range(node) };
    return true;
  }
  if (name !== "table.hline") return false;
  const at = collected.cells.length;
  collected.rules.set(at, [...(collected.rules.get(at) ?? []), range(node)]);
  return true;
}

function collectItem(state: EditorState, node: SyntaxNode, collected: Collected): boolean {
  if (node.name === "Named") {
    const named = readNamed(state, node);
    if (!named) return false;
    collected.named.push(named);
    return true;
  }
  collected.firstItem ??= range(node);
  if (node.name === "ContentBlock") {
    const cell = cellOf(state, node);
    if (!cell) return false;
    collected.cells.push(cell);
    return true;
  }
  return node.name === "FuncCall" && collectCall(state, node, collected);
}

function collect(state: EditorState, args: SyntaxNode): Collected | null {
  const collected: Collected = { cells: [], header: null, rules: new Map(), named: [], firstItem: null };
  for (const node of argumentNodes(args)) {
    if (!collectItem(state, node, collected)) return null;
  }
  return collected;
}

function rowsOf(collected: Collected, count: number): TypstRow[] | null {
  const rows: TypstRow[] = [];
  if (collected.header) {
    if (collected.header.cells.length !== count) return null;
    rows.push({ cells: collected.header.cells, header: true, range: collected.header.range, rulesAbove: [] });
  }
  if (collected.cells.length % count !== 0) return null;
  for (let start = 0; start < collected.cells.length; start += count) {
    const cells = collected.cells.slice(start, start + count);
    rows.push({
      cells,
      header: false,
      range: { from: cells[0].node.from, to: (cells.at(-1) as TypstCell).node.to },
      rulesAbove: collected.rules.get(start) ?? [],
    });
  }
  for (const [at] of collected.rules) {
    if (at % count !== 0) return null;
  }
  return rows.length > 0 ? rows : null;
}

function gridModel(table: Omit<TypstTable, "parsed">, trailingRule: boolean): TableModel {
  const lastIndex = table.rows.length - 1;
  const rows: RowData[] = table.rows.map((row, index) => ({
    cells: row.cells,
    rulesAbove: table.bordered || row.rulesAbove.length > 0 ? [HLINE] : [],
    rulesBelow: index === lastIndex && (table.bordered || trailingRule) ? [HLINE] : [],
  }));
  const columns = table.alignments.map((alignment, index) => {
    const column = plainColumn(alignment);
    column.borderLeft = table.bordered && index === 0 ? 1 : 0;
    column.borderRight = table.bordered ? 1 : 0;
    return column;
  });
  return new TableModel(rows, columns);
}

export function parseTypstTable(state: EditorState, call: SyntaxNode): TypstTable | null {
  if (calleeName(state, call) !== "table" || hasErrorNode(call)) return null;
  const args = call.getChild("Args");
  const open = args?.firstChild;
  const close = args ? closingParenthesis(args) : null;
  if (!args || open?.name !== "LeftParen" || !close) return null;
  if (trailingContentBlocks(args).length > 0) return null;
  const collected = collect(state, args);
  if (!collected) return null;
  const find = (name: string) => collected.named.find((named) => named.name === name) ?? null;
  const columns = find("columns");
  const count = columnCountOf(state, columns);
  if (count === null) return null;
  const rows = rowsOf(collected, count);
  if (!rows) return null;
  const align = find("align");
  const stroke = find("stroke");
  const { alignments, editable } = alignmentsOf(state, align, count);
  const bordered = !stroke || state.sliceDoc(stroke.value.from, stroke.value.to).trim() !== "none";
  const trailingRule = collected.rules.has(collected.cells.length) && collected.cells.length > 0;
  const base = {
    call: range(call),
    open: open.to,
    close: close.from,
    columnCount: count,
    columns,
    align,
    stroke,
    named: collected.named,
    rows,
    headerRow: rows[0].header,
    alignments,
    alignEditable: editable,
    bordered,
    firstItem: collected.firstItem,
  };
  const layout: RowLayout[] = rows.map((row) => ({ range: row.range, rulesAbove: row.rulesAbove, rulesBelow: [] }));
  const parsed: ParsedTable = {
    model: gridModel(base, trailingRule),
    tabular: range(call),
    spec: { from: open.to, to: open.to },
    body: { from: open.to, to: close.from },
    rows: layout,
    rowSeparators: [],
    cellSeparators: rows.map(() => []),
  };
  return { ...base, parsed };
}
