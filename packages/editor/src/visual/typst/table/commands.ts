import type { ChangeSpec, EditorState } from "@codemirror/state";
import type { TableEdit } from "../../table/commands";
import { CellSelection } from "../../table/table-selection";
import type { TextRange } from "../syntax";
import type { TypstAlignment, TypstNamedArgument, TypstTable } from "./parse";

const EMPTY_CELL = "[]";
const NEW_COLUMN = "auto";

function bracketsBalanced(text: string): boolean {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "\\") index += 1;
    else if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

export function sanitizeTypstCell(text: string): string {
  return bracketsBalanced(text) ? text : text.replaceAll(/(?<!\\)([[\]])/gu, "\\$1");
}

function emptyRow(count: number): string {
  return Array.from({ length: count }, () => EMPTY_CELL).join(", ");
}

function lineStartIndent(state: EditorState, pos: number): string | null {
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos);
  return /^[ \t]*$/u.test(before) ? before : null;
}

function afterSeparator(state: EditorState, pos: number): { comma: boolean; end: number } {
  let end = pos;
  const text = state.sliceDoc(pos, Math.min(state.doc.length, pos + 256));
  const match = /^[ \t]*(,)?[ \t]*/u.exec(text);
  if (match) end += match[0].length;
  return { comma: Boolean(match?.[1]), end };
}

function commaBefore(state: EditorState, pos: number): number | null {
  const text = state.sliceDoc(Math.max(0, pos - 256), pos);
  const match = /,\s*$/u.exec(text);
  return match ? pos - match[0].length : null;
}

export function deleteArgumentSpan(state: EditorState, span: TextRange): ChangeSpec {
  const { doc } = state;
  const indent = lineStartIndent(state, span.from);
  const after = afterSeparator(state, span.to);
  const endLine = doc.lineAt(span.to);
  if (indent !== null && after.end >= endLine.to && endLine.to < doc.length) {
    return { from: doc.lineAt(span.from).from, to: endLine.to + 1, insert: "" };
  }
  if (after.comma) {
    const next = state.sliceDoc(after.end, after.end + 1);
    if (next !== ")" && next !== "") return { from: span.from, to: after.end, insert: "" };
  }
  const comma = commaBefore(state, span.from);
  if (comma !== null) return { from: comma, to: span.to, insert: "" };
  return { from: span.from, to: after.comma ? after.end : span.to, insert: "" };
}

function rowSpan(table: TypstTable, row: number): TextRange {
  return table.rows[row].range;
}

function rowAbove(state: EditorState, table: TypstTable, row: number, count: number): ChangeSpec {
  const start = rowSpan(table, row).from;
  const indent = lineStartIndent(state, start);
  const text = emptyRow(table.columnCount);
  if (indent !== null) {
    return { from: state.doc.lineAt(start).from, insert: `${indent}${text},\n`.repeat(count) };
  }
  return { from: start, insert: `${text}, `.repeat(count) };
}

function rowBelowLast(state: EditorState, table: TypstTable, count: number): ChangeSpec {
  const last = rowSpan(table, table.rows.length - 1);
  const indent = lineStartIndent(state, last.from);
  const text = emptyRow(table.columnCount);
  if (indent !== null) return { from: last.to, insert: `,\n${indent}${text}`.repeat(count) };
  return { from: last.to, insert: `, ${text}`.repeat(count) };
}

function firstBodyRow(table: TypstTable): number {
  const index = table.rows.findIndex((row) => !row.header);
  return index === -1 ? table.rows.length : index;
}

export function typstInsertRowsEdit(
  state: EditorState,
  table: TypstTable,
  selection: CellSelection,
  where: "above" | "below",
  count = selection.height(),
): TableEdit | null {
  const { minRow, maxRow } = selection.bounds;
  const columns = table.columnCount;
  if (where === "above" && !table.rows[minRow]?.header) {
    return {
      changes: [rowAbove(state, table, minRow, count)],
      selection: new CellSelection({ row: minRow, column: 0 }, { row: minRow + count - 1, column: columns - 1 }),
    };
  }
  const next = where === "above" ? firstBodyRow(table) : maxRow + 1;
  const change = next < table.rows.length ? rowAbove(state, table, next, count) : rowBelowLast(state, table, count);
  return {
    changes: [change],
    selection: new CellSelection({ row: next, column: 0 }, { row: next + count - 1, column: columns - 1 }),
  };
}

export function typstAppendRowEdit(state: EditorState, table: TypstTable): TableEdit | null {
  const last = table.rows.length - 1;
  return typstInsertRowsEdit(state, table, CellSelection.row(table.parsed.model, last), "below", 1);
}

function deleteRows(state: EditorState, table: TypstTable, minRow: number, maxRow: number): TableEdit | null {
  const remaining = table.rows.length - (maxRow - minRow + 1);
  if (remaining <= 0) return null;
  const span = { from: rowSpan(table, minRow).from, to: rowSpan(table, maxRow).to };
  return {
    changes: [deleteArgumentSpan(state, span)],
    selection: CellSelection.cell(Math.min(minRow, remaining - 1), 0),
  };
}

function arrayText(items: readonly string[], keepArray: boolean): string {
  if (items.length === 1 && keepArray) return `(${items[0]},)`;
  if (items.length === 1) return items[0];
  return `(${items.join(", ")})`;
}

function itemTexts(state: EditorState, argument: TypstNamedArgument): string[] {
  return argument.items.map((item) => state.sliceDoc(item.from, item.to));
}

function insertNamed(state: EditorState, table: TypstTable, text: string): ChangeSpec {
  const anchor = table.named.at(-1) ?? null;
  if (anchor && (!table.firstItem || anchor.named.to < table.firstItem.from)) {
    const after = afterSeparator(state, anchor.named.to);
    const indent = lineStartIndent(state, anchor.named.from);
    const at = after.comma ? state.sliceDoc(anchor.named.to, after.end).indexOf(",") + anchor.named.to + 1 : anchor.named.to;
    if (indent !== null) return { from: at, insert: `${after.comma ? "" : ","}\n${indent}${text},` };
    return { from: at, insert: `${after.comma ? "" : ","} ${text},` };
  }
  const first = table.firstItem ?? table.named[0]?.named ?? null;
  if (first) {
    const indent = lineStartIndent(state, first.from);
    if (indent !== null && state.sliceDoc(table.open, first.from).includes("\n")) {
      return { from: table.open, insert: `\n${indent}${text},` };
    }
    return { from: first.from, insert: `${text}, ` };
  }
  return { from: table.open, insert: text };
}

function columnsChange(state: EditorState, table: TypstTable, next: string[] | number): ChangeSpec | null {
  const columns = table.columns;
  const count = typeof next === "number" ? next : next.length;
  if (!columns) return count === 1 ? null : insertNamed(state, table, `columns: ${count}`);
  const insert = typeof next === "number" ? String(next) : arrayText(next, true);
  return { from: columns.value.from, to: columns.value.to, insert };
}

function alignArray(state: EditorState, table: TypstTable): string[] | null {
  const align = table.align;
  if (align?.kind !== "Array" || align.items.length !== table.columnCount) return null;
  return itemTexts(state, align);
}

function columnTexts(state: EditorState, table: TypstTable): string[] | number {
  if (table.columns?.kind === "Array") return itemTexts(state, table.columns);
  return table.columnCount;
}

export function typstInsertColumnsEdit(
  state: EditorState,
  table: TypstTable,
  initial: CellSelection,
  where: "left" | "right",
): TableEdit | null {
  const selection = initial.expand(table.parsed.model);
  const count = selection.width();
  const { minColumn, maxColumn } = selection.bounds;
  const target = where === "left" ? minColumn : maxColumn;
  const index = where === "left" ? minColumn : maxColumn + 1;
  const changes: ChangeSpec[] = [];
  for (const row of table.rows) {
    const cell = row.cells[target];
    if (where === "left") changes.push({ from: cell.node.from, insert: `${EMPTY_CELL}, `.repeat(count) });
    else changes.push({ from: cell.node.to, insert: `, ${EMPTY_CELL}`.repeat(count) });
  }
  const columns = columnTexts(state, table);
  const nextColumns =
    typeof columns === "number"
      ? columns + count
      : [...columns.slice(0, index), ...Array.from({ length: count }, () => NEW_COLUMN), ...columns.slice(index)];
  const columnChange = columnsChange(state, table, nextColumns);
  if (columnChange) changes.push(columnChange);
  const align = alignArray(state, table);
  if (align && table.align) {
    const next = [...align.slice(0, index), ...Array.from({ length: count }, () => "left"), ...align.slice(index)];
    changes.push({ from: table.align.value.from, to: table.align.value.to, insert: arrayText(next, false) });
  }
  const rows = table.rows.length;
  return {
    changes,
    selection: new CellSelection({ row: 0, column: index }, { row: rows - 1, column: index + count - 1 }),
  };
}

function deleteColumns(state: EditorState, table: TypstTable, minColumn: number, maxColumn: number): TableEdit | null {
  const count = maxColumn - minColumn + 1;
  const total = table.columnCount;
  if (count >= total) return null;
  const changes: ChangeSpec[] = [];
  for (const row of table.rows) {
    const cells = row.cells;
    if (maxColumn < total - 1) changes.push({ from: cells[minColumn].node.from, to: cells[maxColumn + 1].node.from, insert: "" });
    else changes.push({ from: cells[minColumn - 1].node.to, to: cells[maxColumn].node.to, insert: "" });
  }
  const columns = columnTexts(state, table);
  const nextColumns =
    typeof columns === "number" ? columns - count : columns.filter((_, index) => index < minColumn || index > maxColumn);
  const columnChange = columnsChange(state, table, nextColumns);
  if (columnChange) changes.push(columnChange);
  const align = alignArray(state, table);
  if (align && table.align) {
    const next = align.filter((_, index) => index < minColumn || index > maxColumn);
    changes.push({ from: table.align.value.from, to: table.align.value.to, insert: arrayText(next, false) });
  }
  return { changes, selection: CellSelection.cell(0, Math.max(0, Math.min(minColumn, total - count - 1))) };
}

export function typstDeleteSelectionEdit(
  state: EditorState,
  table: TypstTable,
  selection: CellSelection,
): TableEdit | null {
  const model = table.parsed.model;
  const { minRow, maxRow, minColumn, maxColumn } = selection.bounds;
  if (selection.anyRowSelected(model)) return deleteRows(state, table, minRow, maxRow);
  if (selection.anyColumnSelected(model)) return deleteColumns(state, table, minColumn, maxColumn);
  return null;
}

export function typstAlignmentEdit(
  state: EditorState,
  table: TypstTable,
  selection: CellSelection,
  alignment: TypstAlignment,
): TableEdit | null {
  if (!table.alignEditable) return null;
  const { minColumn, maxColumn } = selection.bounds;
  const next = table.alignments.map((current, index) => (index >= minColumn && index <= maxColumn ? alignment : current));
  const text = next.every((value) => value === next[0]) ? next[0] : `(${next.join(", ")})`;
  const change: ChangeSpec = table.align
    ? { from: table.align.value.from, to: table.align.value.to, insert: text }
    : insertNamed(state, table, `align: ${text}`);
  return { changes: [change], selection };
}

export function typstBordersEdit(state: EditorState, table: TypstTable, bordered: boolean): TableEdit | null {
  if (bordered === table.bordered && (bordered || table.stroke)) return null;
  if (bordered) {
    return table.stroke ? { changes: [deleteArgumentSpan(state, table.stroke.named)], selection: null } : null;
  }
  const change = table.stroke
    ? { from: table.stroke.value.from, to: table.stroke.value.to, insert: "none" }
    : insertNamed(state, table, "stroke: none");
  return { changes: [change], selection: null };
}

export function typstRemoveTableEdit(state: EditorState, removal: TextRange): TableEdit {
  const { doc } = state;
  const startLine = doc.lineAt(removal.from);
  const endLine = doc.lineAt(removal.to);
  const before = state.sliceDoc(startLine.from, removal.from);
  const after = state.sliceDoc(removal.to, endLine.to);
  if (before.trim() !== "" || after.trim() !== "") {
    return { changes: [{ from: removal.from, to: removal.to, insert: "" }], selection: null };
  }
  if (endLine.to < doc.length) return { changes: [{ from: startLine.from, to: endLine.to + 1, insert: "" }], selection: null };
  return { changes: [{ from: Math.max(0, startLine.from - 1), to: endLine.to, insert: "" }], selection: null };
}
