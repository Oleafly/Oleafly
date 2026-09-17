import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { cellAround, selectedRect, TableMap, type TableRect } from "@tiptap/pm/tables";
import {
  defaultTableColumn,
  normalizeTableColumns,
  WYSIWYG_NODE_NAMES,
  type TableAlignment,
  type TableColumn,
} from "@oleafly/wysiwyg";

export type BorderPreset = "none" | "horizontal" | "all" | "booktabs";
export type CaptionPlacement = "none" | "above" | "below";
export type SimpleAlignment = Extract<TableAlignment, "l" | "c" | "r">;

export const BORDER_PRESETS: readonly BorderPreset[] = ["none", "horizontal", "all", "booktabs"];
export const CAPTION_PLACEMENTS: readonly CaptionPlacement[] = ["none", "above", "below"];
export const COLUMN_ALIGNMENTS: readonly SimpleAlignment[] = ["l", "c", "r"];

export interface TableFloatContext {
  floatPos: number;
  float: ProseMirrorNode;
  tablePos: number;
  table: ProseMirrorNode;
}

interface RowRules {
  borderTop: string | null;
  borderBottom: string | null;
}

interface BorderPlan {
  rows: RowRules[];
  columns: TableColumn[];
}

interface LocatedRect {
  context: TableFloatContext;
  rect: TableRect;
}

const RULE_NAMES: Record<Exclude<BorderPreset, "none">, { top: string; mid: string; bottom: string }> = {
  horizontal: { top: "hline", mid: "hline", bottom: "hline" },
  all: { top: "hline", mid: "hline", bottom: "hline" },
  booktabs: { top: "toprule", mid: "midrule", bottom: "bottomrule" },
};

export function tableFloatContext(state: EditorState): TableFloatContext | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name !== WYSIWYG_NODE_NAMES.tableFloat) continue;
    const table = node.firstChild;
    if (!table || table.type.name !== WYSIWYG_NODE_NAMES.table) return null;
    const floatPos = $from.before(depth);
    return { floatPos, float: node, tablePos: floatPos + 1, table };
  }
  return null;
}

export function tableFloatPosition(state: EditorState): number | null {
  return tableFloatContext(state)?.floatPos ?? null;
}

function locate(editor: Editor): LocatedRect | null {
  const context = tableFloatContext(editor.state);
  if (!context || !cellAround(editor.state.selection.$from)) return null;
  return { context, rect: selectedRect(editor.state) };
}

export function hasHeaderRow(table: ProseMirrorNode): boolean {
  const first = table.firstChild;
  if (!first || first.childCount === 0) return false;
  let header = true;
  first.forEach((cell) => {
    if (cell.type.name !== WYSIWYG_NODE_NAMES.tableHeader) header = false;
  });
  return header;
}

function floatColumns(float: ProseMirrorNode): TableColumn[] {
  return normalizeTableColumns(float.attrs.columns);
}

function fittedColumns(columns: readonly TableColumn[], width: number): TableColumn[] {
  const fitted = columns.slice(0, width);
  while (fitted.length < width) fitted.push(defaultTableColumn());
  return fitted;
}

function rulesFor(preset: BorderPreset, index: number, rowCount: number, header: boolean): RowRules {
  if (preset === "none") return { borderTop: null, borderBottom: null };
  const names = RULE_NAMES[preset];
  const first = index === 0;
  const last = index === rowCount - 1;
  if (preset === "all") return { borderTop: names.top, borderBottom: last ? names.bottom : null };
  const headerRule = first && header && rowCount > 1 ? names.mid : null;
  return { borderTop: first ? names.top : null, borderBottom: last ? names.bottom : headerRule };
}

export function borderPlan(
  preset: BorderPreset,
  rowCount: number,
  header: boolean,
  columns: readonly TableColumn[],
): BorderPlan {
  return {
    rows: Array.from({ length: rowCount }, (_row, index) => rulesFor(preset, index, rowCount, header)),
    columns: columns.map((column, index) => ({
      ...column,
      borderLeft: preset === "all" && index === 0,
      borderRight: preset === "all",
    })),
  };
}

function jsonRowWidth(row: JSONContent | undefined): number {
  return (row?.content ?? []).reduce((sum, cell) => sum + Math.max(1, Number(cell.attrs?.colspan ?? 1)), 0);
}

function jsonHeaderRow(row: JSONContent | undefined): boolean {
  const cells = row?.content ?? [];
  return cells.length > 0 && cells.every((cell) => cell.type === WYSIWYG_NODE_NAMES.tableHeader);
}

export function withBorderPreset(float: JSONContent, preset: BorderPreset): JSONContent {
  const table = float.content?.find((child) => child.type === WYSIWYG_NODE_NAMES.table);
  const rows = table?.content ?? [];
  const columns = fittedColumns(normalizeTableColumns(float.attrs?.columns), jsonRowWidth(rows[0]));
  const plan = borderPlan(preset, rows.length, jsonHeaderRow(rows[0]), columns);
  const content = (float.content ?? []).map((child) =>
    child.type === WYSIWYG_NODE_NAMES.table
      ? { ...child, content: rows.map((row, index) => ({ ...row, attrs: { ...row.attrs, ...plan.rows[index] } })) }
      : child,
  );
  return { ...float, attrs: { ...float.attrs, columns: plan.columns }, content };
}

export function inferBorderPreset(float: ProseMirrorNode): BorderPreset {
  const rules: string[] = [];
  float.firstChild?.forEach((row) => {
    for (const value of [row.attrs.borderTop, row.attrs.borderBottom]) {
      if (typeof value === "string" && value !== "") rules.push(value);
    }
  });
  if (rules.some((rule) => rule.includes("rule"))) return "booktabs";
  if (floatColumns(float).some((column) => column.borderLeft || column.borderRight)) return "all";
  return rules.length > 0 ? "horizontal" : "none";
}

function applyPlan(tr: Transaction, context: TableFloatContext, plan: BorderPlan): Transaction {
  context.table.forEach((row, offset, index) => {
    tr.setNodeMarkup(context.tablePos + 1 + offset, undefined, { ...row.attrs, ...plan.rows[index] });
  });
  return tr.setNodeMarkup(context.floatPos, undefined, { ...context.float.attrs, columns: plan.columns });
}

export function applyBorderPreset(editor: Editor, preset: BorderPreset): boolean {
  const context = tableFloatContext(editor.state);
  if (!context) return false;
  const map = TableMap.get(context.table);
  const columns = fittedColumns(floatColumns(context.float), map.width);
  const plan = borderPlan(preset, map.height, hasHeaderRow(context.table), columns);
  editor.view.dispatch(applyPlan(editor.state.tr, context, plan));
  return true;
}

function setFloatAttributes(editor: Editor, attributes: Record<string, unknown>): boolean {
  const context = tableFloatContext(editor.state);
  if (!context) return false;
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(context.floatPos, undefined, { ...context.float.attrs, ...attributes }),
  );
  return true;
}

function rerule(editor: Editor, preset: BorderPreset, changed: boolean): boolean {
  if (changed) applyBorderPreset(editor, preset);
  return changed;
}

export function insertRow(editor: Editor, side: "above" | "below"): boolean {
  const located = locate(editor);
  if (!located) return false;
  const preset = inferBorderPreset(located.context.float);
  const inserted = side === "above" ? editor.commands.addRowBefore() : editor.commands.addRowAfter();
  return rerule(editor, preset, inserted);
}

export function deleteRow(editor: Editor): boolean {
  const located = locate(editor);
  if (!located) return false;
  return rerule(editor, inferBorderPreset(located.context.float), editor.commands.deleteRow());
}

export function insertColumn(editor: Editor, side: "left" | "right"): boolean {
  const located = locate(editor);
  if (!located) return false;
  const { context, rect } = located;
  const preset = inferBorderPreset(context.float);
  const inserted = side === "left" ? editor.commands.addColumnBefore() : editor.commands.addColumnAfter();
  if (!inserted) return false;
  const columns = fittedColumns(floatColumns(context.float), rect.map.width);
  const index = side === "left" ? rect.left : rect.right;
  const neighbour = columns[side === "left" ? index : index - 1] ?? defaultTableColumn();
  columns.splice(index, 0, { ...defaultTableColumn(), align: neighbour.align });
  setFloatAttributes(editor, { columns });
  return rerule(editor, preset, true);
}

export function deleteColumn(editor: Editor): boolean {
  const located = locate(editor);
  if (!located) return false;
  const { context, rect } = located;
  const preset = inferBorderPreset(context.float);
  const columns = fittedColumns(floatColumns(context.float), rect.map.width);
  if (!editor.commands.deleteColumn()) return false;
  columns.splice(rect.left, rect.right - rect.left);
  setFloatAttributes(editor, { columns });
  return rerule(editor, preset, true);
}

export function deleteTableFloat(editor: Editor): boolean {
  if (!tableFloatContext(editor.state)) return false;
  return editor.chain().focus().deleteNode(WYSIWYG_NODE_NAMES.tableFloat).run();
}

export function currentColumnAlignment(state: EditorState): SimpleAlignment | null {
  const context = tableFloatContext(state);
  if (!context || !cellAround(state.selection.$from)) return null;
  const align = floatColumns(context.float)[selectedRect(state).left]?.align ?? "l";
  return COLUMN_ALIGNMENTS.includes(align as SimpleAlignment) ? (align as SimpleAlignment) : null;
}

export function setColumnAlignment(editor: Editor, align: SimpleAlignment): boolean {
  const located = locate(editor);
  if (!located) return false;
  const { context, rect } = located;
  const columns = fittedColumns(floatColumns(context.float), rect.map.width);
  for (let index = rect.left; index < rect.right; index++) {
    columns[index] = { ...columns[index], align, width: null };
  }
  return setFloatAttributes(editor, { columns });
}

function captionChild(float: ProseMirrorNode): { node: ProseMirrorNode; offset: number } | null {
  let found: { node: ProseMirrorNode; offset: number } | null = null;
  float.forEach((child, offset) => {
    if (child.type.name === WYSIWYG_NODE_NAMES.tableCaption) found = { node: child, offset };
  });
  return found;
}

export function currentCaptionPlacement(float: ProseMirrorNode): CaptionPlacement {
  if (!captionChild(float)) return "none";
  return float.attrs.captionPosition === "above" ? "above" : "below";
}

function removeCaption(editor: Editor, context: TableFloatContext): boolean {
  const caption = captionChild(context.float);
  if (!caption) return true;
  const pos = context.floatPos + 1 + caption.offset;
  editor.view.dispatch(editor.state.tr.delete(pos, pos + caption.node.nodeSize));
  return true;
}

export function setCaptionPlacement(editor: Editor, placement: CaptionPlacement): boolean {
  const context = tableFloatContext(editor.state);
  if (!context) return false;
  if (placement === "none") return removeCaption(editor, context);
  const tr = editor.state.tr.setNodeMarkup(context.floatPos, undefined, {
    ...context.float.attrs,
    captionPosition: placement,
  });
  if (!captionChild(context.float)) {
    const insertAt = context.floatPos + context.float.nodeSize - 1;
    tr.insert(insertAt, editor.schema.nodes[WYSIWYG_NODE_NAMES.tableCaption].create());
    tr.setSelection(TextSelection.create(tr.doc, insertAt + 1));
  }
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}

export function setTableLabel(editor: Editor, label: string): boolean {
  const value = label.trim();
  return setFloatAttributes(editor, { label: value === "" ? null : value });
}

export function toggleHeaderRow(editor: Editor): boolean {
  const located = locate(editor);
  if (!located) return false;
  return rerule(editor, inferBorderPreset(located.context.float), editor.commands.toggleHeaderRow());
}

export function mergeCells(editor: Editor): boolean {
  return editor.chain().focus().mergeCells().run();
}

export function splitCell(editor: Editor): boolean {
  return editor.chain().focus().splitCell().run();
}

export function canMergeCells(editor: Editor): boolean {
  return editor.can().mergeCells();
}

export function canSplitCell(editor: Editor): boolean {
  return editor.can().splitCell();
}
