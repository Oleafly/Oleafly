import type { ChangeSpec, EditorState } from "@codemirror/state";
import {
  type ColumnAlignment,
  type ColumnSpec,
  type ColumnWidth,
  paragraphPrefix,
  parseColumnSpec,
  plainColumn,
  serializeColumnSpec,
  widthArgument,
} from "./column-spec";
import { type BorderPreset, type CellData, type ParsedTable, type TableEnvironmentInfo, cellSpan } from "./model";
import { type TextRange, rangeContains } from "./syntax";
import { CellSelection } from "./table-selection";

export interface TableEdit {
  changes: ChangeSpec[];
  selection: CellSelection | null;
}

export type CaptionPlacement = "above" | "below" | "none";

const ROW_END = "\\\\";
const HLINE = String.raw`\hline`;
const TOPRULE = String.raw`\toprule`;
const MIDRULE = String.raw`\midrule`;
const BOTTOMRULE = String.raw`\bottomrule`;
const DEFAULT_CAPTION = String.raw`\caption{Caption}`;
const DEFAULT_LABEL = String.raw`\label{tab:my_table}`;

function cellRange(cell: CellData): TextRange {
  return cell.multiColumn ? { from: cell.multiColumn.from, to: cell.multiColumn.to } : { from: cell.from, to: cell.to };
}

function lastCellEnd(parsed: ParsedTable, row: number): number {
  const cells = parsed.model.rows[row].cells;
  return cellRange(cells.at(-1)!).to;
}

function firstCellStart(parsed: ParsedTable, row: number): number {
  return cellRange(parsed.model.rows[row].cells[0]).from;
}

function cellsStart(parsed: ParsedTable, row: number): number {
  const rules = parsed.rows[row].rulesAbove;
  return rules.at(-1)?.to ?? parsed.rows[row].range.from;
}

function indentationBefore(state: EditorState, pos: number): string | null {
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos);
  return before.trim() === "" ? before : null;
}

function hasLineBreakBetween(state: EditorState, from: number, to: number): boolean {
  return state.sliceDoc(from, to).includes("\n");
}

function lineAwareDeletion(state: EditorState, range: TextRange): TextRange {
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);
  const before = state.sliceDoc(startLine.from, range.from);
  const after = state.sliceDoc(range.to, endLine.to);
  if (before.trim() !== "" || after.trim() !== "") return { from: range.from, to: range.to };
  if (endLine.to < state.doc.length) return { from: startLine.from, to: endLine.to + 1 };
  return { from: Math.max(0, startLine.from - 1), to: endLine.to };
}

function deleteRule(state: EditorState, rule: TextRange): ChangeSpec {
  const line = state.doc.lineAt(rule.from);
  if (line.text.trim() === state.sliceDoc(rule.from, rule.to).trim()) {
    return { ...lineAwareDeletion(state, rule), insert: "" };
  }
  let from = rule.from;
  while (from > line.from && /[ \t]/u.test(state.doc.sliceString(from - 1, from))) from--;
  return { from, to: rule.to, insert: "" };
}

function setRulesAbove(state: EditorState, parsed: ParsedTable, row: number, text: string | null, changes: ChangeSpec[]) {
  const rules = parsed.rows[row].rulesAbove;
  if (text === null) {
    for (const rule of rules) changes.push(deleteRule(state, rule));
    return;
  }
  if (rules.length > 0) {
    if (state.sliceDoc(rules[0].from, rules[0].to).trim() !== text) {
      changes.push({ from: rules[0].from, to: rules[0].to, insert: text });
    }
    for (const rule of rules.slice(1)) changes.push(deleteRule(state, rule));
    return;
  }
  const at = firstCellStart(parsed, row);
  const indent = indentationBefore(state, at);
  if (indent !== null && hasLineBreakBetween(state, parsed.rows[row].range.from, at)) {
    changes.push({ from: at, insert: `${text}\n${indent}` });
  } else {
    changes.push({ from: at, insert: `${text} ` });
  }
}

function setRulesBelow(state: EditorState, parsed: ParsedTable, text: string | null, changes: ChangeSpec[]) {
  const last = parsed.rows.length - 1;
  const rules = parsed.rows[last].rulesBelow;
  if (text === null) {
    for (const rule of rules) changes.push(deleteRule(state, rule));
    return;
  }
  if (rules.length > 0) {
    if (state.sliceDoc(rules[0].from, rules[0].to).trim() !== text) {
      changes.push({ from: rules[0].from, to: rules[0].to, insert: text });
    }
    for (const rule of rules.slice(1)) changes.push(deleteRule(state, rule));
    return;
  }
  if (parsed.rowSeparators.length === parsed.rows.length) {
    changes.push({ from: parsed.rowSeparators[last].to, insert: ` ${text}` });
  } else {
    changes.push({ from: lastCellEnd(parsed, last), insert: ` ${ROW_END} ${text}` });
  }
}

function specChange(state: EditorState, range: TextRange, columns: ColumnSpec[], changes: ChangeSpec[]) {
  const text = serializeColumnSpec(columns);
  if (text !== state.sliceDoc(range.from, range.to)) changes.push({ from: range.from, to: range.to, insert: text });
}

function readSpec(state: EditorState, range: TextRange): ColumnSpec[] {
  return parseColumnSpec(state.sliceDoc(range.from, range.to));
}

function ruleAboveFor(preset: BorderPreset, row: number): string | null {
  if (preset === "all") return HLINE;
  if (preset !== "booktabs") return null;
  if (row === 0) return TOPRULE;
  return row === 1 ? MIDRULE : null;
}

function ruleBelowFor(preset: BorderPreset): string | null {
  if (preset === "all") return HLINE;
  return preset === "booktabs" ? BOTTOMRULE : null;
}

function mergedBorderChanges(
  state: EditorState,
  parsed: ParsedTable,
  preset: BorderPreset,
  changes: ChangeSpec[],
): void {
  const border = preset === "all" ? 1 : 0;
  for (const row of parsed.model.rows) {
    for (const cell of row.cells) {
      const spec = cell.multiColumn?.spec;
      if (!spec) continue;
      const merged = readSpec(state, spec);
      for (const column of merged) {
        column.borderLeft = border;
        column.borderRight = border;
      }
      specChange(state, spec, merged, changes);
    }
  }
}

export function borderPresetEdit(state: EditorState, parsed: ParsedTable, preset: BorderPreset): TableEdit {
  const changes: ChangeSpec[] = [];
  const columns = readSpec(state, parsed.spec);
  columns.forEach((column, index) => {
    column.borderLeft = preset === "all" ? 1 : 0;
    column.borderRight = preset === "all" && index === columns.length - 1 ? 1 : 0;
  });
  specChange(state, parsed.spec, columns, changes);

  for (let row = 0; row < parsed.rows.length; row++) {
    setRulesAbove(state, parsed, row, ruleAboveFor(preset, row), changes);
  }
  setRulesBelow(state, parsed, ruleBelowFor(preset), changes);
  mergedBorderChanges(state, parsed, preset, changes);
  return { changes, selection: null };
}

export function alignmentEdit(
  state: EditorState,
  parsed: ParsedTable,
  selection: CellSelection,
  alignment: ColumnAlignment,
): TableEdit {
  const { model } = parsed;
  const changes: ChangeSpec[] = [];
  if (selection.isMergedCell(model)) {
    const cell = model.cellAt(selection.anchor.row, selection.anchor.column);
    if (!cell.multiColumn || alignment === "paragraph") return { changes, selection };
    const merged = readSpec(state, cell.multiColumn.spec);
    for (const column of merged) {
      column.alignment = alignment;
      column.content = alignment.charAt(0);
      column.paragraph = false;
      column.width = undefined;
    }
    specChange(state, cell.multiColumn.spec, merged, changes);
    return { changes, selection };
  }
  const columns = readSpec(state, parsed.spec);
  const { minColumn, maxColumn } = selection.bounds;
  for (let index = minColumn; index <= maxColumn; index++) {
    if (!selection.isColumnSelected(model, index)) continue;
    const column = columns[index];
    if (column.paragraph) {
      column.alignment = alignment;
      column.prefix = paragraphPrefix(alignment);
    } else if (alignment !== "paragraph") {
      column.alignment = alignment;
      column.content = alignment.charAt(0);
    }
  }
  specChange(state, parsed.spec, columns, changes);
  return { changes, selection };
}

export function columnWidthEdit(
  state: EditorState,
  parsed: ParsedTable,
  selection: CellSelection,
  width: ColumnWidth,
): TableEdit {
  const columns = readSpec(state, parsed.spec);
  const { minColumn, maxColumn } = selection.bounds;
  for (let index = minColumn; index <= maxColumn; index++) {
    if (!selection.isColumnSelected(parsed.model, index)) continue;
    const column = columns[index];
    const letter = column.paragraph && /^[mb]/u.test(column.content) ? column.content.charAt(0) : "p";
    column.content = `${letter}{${widthArgument(width)}}`;
    column.prefix = paragraphPrefix(column.alignment);
    column.paragraph = true;
    column.width = width;
  }
  const changes: ChangeSpec[] = [];
  specChange(state, parsed.spec, columns, changes);
  return { changes, selection };
}

export function removeColumnWidthEdit(state: EditorState, parsed: ParsedTable, selection: CellSelection): TableEdit {
  const columns = readSpec(state, parsed.spec);
  const { minColumn, maxColumn } = selection.bounds;
  for (let index = minColumn; index <= maxColumn; index++) {
    if (!selection.isColumnSelected(parsed.model, index)) continue;
    const column = columns[index];
    if (column.alignment === "paragraph") column.alignment = "left";
    column.content = column.alignment.charAt(0);
    column.prefix = "";
    column.paragraph = false;
    column.width = undefined;
  }
  const changes: ChangeSpec[] = [];
  specChange(state, parsed.spec, columns, changes);
  return { changes, selection };
}

function emptyRowText(columnCount: number): string {
  return `${"& ".repeat(Math.max(0, columnCount - 1))}${ROW_END}`;
}

function appendedRowsText(
  base: string,
  indent: string,
  preset: BorderPreset | null,
  hasSeparator: boolean,
  count: number,
): string {
  let text = hasSeparator ? "" : ` ${ROW_END}`;
  if (preset === "all") text += ` ${HLINE}`;
  for (let index = 0; index < count; index++) {
    text += `\n${indent}${base}`;
    if (preset === "all" && index < count - 1) text += ` ${HLINE}`;
  }
  if (!hasSeparator && preset === "all") text += ` ${HLINE}`;
  return text;
}

export function insertRowsEdit(
  state: EditorState,
  parsed: ParsedTable,
  selection: CellSelection,
  where: "above" | "below",
  count = selection.height(),
): TableEdit {
  const { model } = parsed;
  const columnCount = model.columnCount;
  const preset = model.borderPreset();
  const base = emptyRowText(columnCount);
  const { minRow, maxRow } = selection.bounds;
  const changes: ChangeSpec[] = [];
  if (where === "above") {
    const at = firstCellStart(parsed, minRow);
    const indent = indentationBefore(state, at);
    const rowText = preset === "all" ? `${base} ${HLINE}` : base;
    if (indent !== null && hasLineBreakBetween(state, parsed.rows[minRow].range.from, at)) {
      changes.push({ from: at - indent.length, insert: `${indent}${rowText}\n`.repeat(count) });
    } else {
      changes.push({ from: at, insert: `${rowText} `.repeat(count) });
    }
    return {
      changes,
      selection: new CellSelection({ row: minRow, column: 0 }, { row: minRow + count - 1, column: columnCount - 1 }),
    };
  }
  const hasSeparator = maxRow < parsed.rowSeparators.length;
  const at = hasSeparator ? parsed.rowSeparators[maxRow].to : lastCellEnd(parsed, maxRow);
  const indent = indentationBefore(state, firstCellStart(parsed, maxRow)) ?? "";
  changes.push({ from: at, insert: appendedRowsText(base, indent, preset, hasSeparator, count) });
  return {
    changes,
    selection: new CellSelection({ row: maxRow + 1, column: 0 }, { row: maxRow + count, column: columnCount - 1 }),
  };
}

export function insertColumnsEdit(
  state: EditorState,
  parsed: ParsedTable,
  initial: CellSelection,
  where: "left" | "right",
): TableEdit {
  const { model } = parsed;
  const selection = initial.expand(model);
  const count = selection.widestRowSpan(model);
  const { minColumn, maxColumn } = selection.bounds;
  const target = where === "left" ? minColumn : maxColumn;
  const changes: ChangeSpec[] = [];
  for (let row = 0; row < model.rowCount; row++) {
    const range = cellRange(model.cellAt(row, target));
    if (where === "left") changes.push({ from: range.from, insert: "& ".repeat(count) });
    else changes.push({ from: range.to, insert: " &".repeat(count) });
  }
  const columns = readSpec(state, parsed.spec);
  const preset = model.borderPreset();
  const index = where === "left" ? minColumn : maxColumn + 1;
  const added = Array.from({ length: count }, () => {
    const column = plainColumn("left");
    column.borderRight = preset === "all" ? 1 : 0;
    return column;
  });
  if (index === 0 && columns.length > 0) {
    added[0].borderLeft = columns[0].borderLeft;
    columns[0].borderLeft = 0;
  }
  columns.splice(index, 0, ...added);
  specChange(state, parsed.spec, columns, changes);
  return {
    changes,
    selection: new CellSelection({ row: 0, column: index }, { row: model.rowCount - 1, column: index + count - 1 }),
  };
}

function emptyTableEdit(state: EditorState, parsed: ParsedTable): TableEdit {
  const columns = readSpec(state, parsed.spec).slice(0, 1);
  if (columns.length === 0) columns.push(plainColumn("left"));
  columns[0].borderLeft = 0;
  columns[0].borderRight = 0;
  const changes: ChangeSpec[] = [];
  specChange(state, parsed.spec, columns, changes);
  changes.push({ from: parsed.body.from, to: parsed.body.to, insert: `\n${ROW_END}\n` });
  return { changes, selection: CellSelection.cell(0, 0) };
}

function deleteRowsEdit(parsed: ParsedTable, selection: CellSelection): TableEdit {
  const { model } = parsed;
  const { minRow, maxRow, minColumn } = selection.bounds;
  const lastRow = model.rowCount - 1;
  const from = maxRow < lastRow ? cellsStart(parsed, minRow) : parsed.rows[minRow].range.from;
  let to: number;
  if (maxRow < lastRow) to = cellsStart(parsed, maxRow + 1);
  else if (parsed.rowSeparators.length === parsed.rows.length) to = parsed.rowSeparators[maxRow].to;
  else to = lastCellEnd(parsed, maxRow);
  const remaining = model.rowCount - selection.height();
  return {
    changes: [{ from, to, insert: "" }],
    selection: CellSelection.cell(Math.min(minRow, remaining - 1), minColumn),
  };
}

function deleteColumnChanges(parsed: ParsedTable, minColumn: number, maxColumn: number): ChangeSpec[] | null {
  const { model } = parsed;
  const changes: ChangeSpec[] = [];
  const fromStart = minColumn === 0;
  for (let row = 0; row < model.rowCount; row++) {
    for (let column = minColumn; column <= maxColumn; ) {
      const index = model.cellIndexAt(row, column);
      const cell = model.rows[row].cells[index];
      const range = cellRange(cell);
      const separators = parsed.cellSeparators[row];
      const separator = fromStart ? separators[index] : separators[index - 1];
      if (!separator) return null;
      if (fromStart) changes.push({ from: range.from, to: separator.to, insert: "" });
      else changes.push({ from: separator.from, to: range.to, insert: "" });
      column += cellSpan(cell);
    }
  }
  return changes;
}

export function deleteSelectionEdit(state: EditorState, parsed: ParsedTable, selection: CellSelection): TableEdit | null {
  const { model } = parsed;
  if (selection.coversTable(model)) return emptyTableEdit(state, parsed);
  const { minRow, minColumn, maxColumn } = selection.bounds;
  if (selection.anyRowSelected(model)) return deleteRowsEdit(parsed, selection);
  if (!selection.anyColumnSelected(model) || !selection.eq(selection.expand(model))) return null;
  const changes = deleteColumnChanges(parsed, minColumn, maxColumn);
  if (!changes) return null;
  const columns = readSpec(state, parsed.spec);
  const preset = model.borderPreset();
  const remaining = columns.filter((_, index) => !selection.isColumnSelected(model, index));
  if (preset === "all" && remaining.length > 0 && columns[0].borderLeft > 0) {
    remaining[0].borderLeft = Math.max(1, remaining[0].borderLeft);
  }
  specChange(state, parsed.spec, remaining, changes);
  return {
    changes,
    selection: CellSelection.cell(minRow, Math.max(0, Math.min(minColumn, remaining.length - 1))),
  };
}

export function mergeCellsEdit(parsed: ParsedTable, selection: CellSelection): TableEdit | null {
  const { model } = parsed;
  if (!selection.canMerge(model)) return null;
  const { minRow, minColumn, maxColumn } = selection.bounds;
  const parts: string[] = [];
  for (let column = minColumn; column <= maxColumn; column++) {
    const content = model.cellAt(minRow, column).content.trim();
    if (content) parts.push(content);
  }
  const border = model.borderPreset() === "all" ? "|" : "";
  const from = cellRange(model.cellAt(minRow, minColumn)).from;
  const to = cellRange(model.cellAt(minRow, maxColumn)).to;
  const span = maxColumn - minColumn + 1;
  const insert = String.raw`\multicolumn{${span}}{${border}c${border}}{${parts.join(" ")}}`;
  return {
    changes: [{ from, to, insert }],
    selection: new CellSelection({ row: minRow, column: minColumn }, { row: minRow, column: maxColumn }),
  };
}

export function unmergeCellsEdit(parsed: ParsedTable, selection: CellSelection): TableEdit | null {
  const { model } = parsed;
  if (!selection.isMergedCell(model)) return null;
  const cell = model.cellAt(selection.anchor.row, selection.anchor.column);
  const merged = cell.multiColumn;
  if (!merged) return null;
  const { from } = model.cellBounds(selection.anchor.row, selection.anchor.column);
  return {
    changes: [
      { from: merged.preamble.from, to: merged.preamble.to, insert: "" },
      { from: merged.postamble.from, to: merged.postamble.to, insert: " &".repeat(merged.span - 1) },
    ],
    selection: new CellSelection(
      { row: selection.anchor.row, column: from },
      { row: selection.anchor.row, column: from + merged.span - 1 },
    ),
  };
}

export function captionPlacementOf(parsed: ParsedTable, environment: TableEnvironmentInfo | null): CaptionPlacement {
  if (!environment?.caption) return "none";
  return environment.caption.from < parsed.tabular.from ? "above" : "below";
}

function removeCaptionEdit(
  state: EditorState,
  environment: TableEnvironmentInfo,
  labelInsideCaption: boolean,
): TableEdit | null {
  const { caption, label } = environment;
  const changes: ChangeSpec[] = [];
  if (caption) changes.push({ ...lineAwareDeletion(state, caption), insert: "" });
  if (label && !labelInsideCaption) changes.push({ ...lineAwareDeletion(state, label), insert: "" });
  return changes.length > 0 ? { changes, selection: null } : null;
}

function captionLines(state: EditorState, environment: TableEnvironmentInfo, labelInsideCaption: boolean): string[] {
  const { caption, label } = environment;
  const captionText = caption ? state.sliceDoc(caption.from, caption.to) : DEFAULT_CAPTION;
  let labelText: string | null = null;
  if (!labelInsideCaption) {
    if (label) labelText = state.sliceDoc(label.from, label.to);
    else if (!caption) labelText = DEFAULT_LABEL;
  }
  return labelText ? [captionText, labelText] : [captionText];
}

function captionAboveChange(state: EditorState, parsed: ParsedTable, lines: readonly string[]): ChangeSpec {
  const anchor = parsed.tabular.from;
  const indent = indentationBefore(state, anchor);
  if (indent !== null) {
    return { from: anchor - indent.length, insert: lines.map((line) => `${indent}${line}\n`).join("") };
  }
  return { from: anchor, insert: `${lines.join("\n")}\n` };
}

function captionBelowChange(state: EditorState, parsed: ParsedTable, lines: readonly string[]): ChangeSpec {
  const anchor = parsed.tabular.to;
  const line = state.doc.lineAt(anchor);
  const indent = /^[ \t]*/u.exec(line.text)?.[0] ?? "";
  if (state.sliceDoc(anchor, line.to).trim() === "") {
    return { from: line.to, insert: lines.map((text) => `\n${indent}${text}`).join("") };
  }
  return { from: anchor, insert: `\n${lines.join("\n")}\n` };
}

export function captionEdit(
  state: EditorState,
  parsed: ParsedTable,
  environment: TableEnvironmentInfo | null,
  placement: CaptionPlacement,
): TableEdit | null {
  if (!environment) return null;
  const { caption, label } = environment;
  const labelInsideCaption = Boolean(caption && label && rangeContains(caption, label));
  if (placement === "none") return removeCaptionEdit(state, environment, labelInsideCaption);
  if (captionPlacementOf(parsed, environment) === placement) return null;

  const lines = captionLines(state, environment, labelInsideCaption);
  const changes: ChangeSpec[] = [];
  if (caption) changes.push({ ...lineAwareDeletion(state, caption), insert: "" });
  if (label && !labelInsideCaption) changes.push({ ...lineAwareDeletion(state, label), insert: "" });
  const insertion =
    placement === "above" ? captionAboveChange(state, parsed, lines) : captionBelowChange(state, parsed, lines);
  changes.push(insertion);
  return { changes, selection: null };
}

export function removeTableEdit(
  state: EditorState,
  parsed: ParsedTable,
  environment: TableEnvironmentInfo | null,
): TableEdit {
  const range = lineAwareDeletion(state, environment?.range ?? parsed.tabular);
  return { changes: [{ from: range.from, to: range.to, insert: "" }], selection: null };
}

export function writeCellEdit(parsed: ParsedTable, row: number, column: number, content: string): TableEdit {
  const cell = parsed.model.cellAt(row, column);
  return { changes: [{ from: cell.from, to: cell.to, insert: content }], selection: null };
}

export function clearCellsEdit(parsed: ParsedTable, selection: CellSelection): TableEdit {
  const changes: ChangeSpec[] = [];
  const { minRow, maxRow, minColumn, maxColumn } = selection.bounds;
  parsed.model.forEachCell(minRow, maxRow, minColumn, maxColumn, (cell) => {
    if (cell.to > cell.from) changes.push({ from: cell.from, to: cell.to, insert: "" });
  });
  return { changes, selection };
}

export function sanitizeCellInput(text: string): string {
  const escaped = text
    .replace(/(^|[^\\])&/gu, String.raw`$1\&`)
    .replace(/(^|[^\\])%/gu, String.raw`$1\%`);
  let depth = 0;
  let result = "";
  for (let index = 0; index < escaped.length; index++) {
    const character = escaped[index];
    if (character === "\\" && index + 1 < escaped.length) {
      const next = escaped[++index];
      // A row break inside a group belongs to the cell's LaTeX command,
      // such as shortstack, rather than to the surrounding table.
      if (next !== "\\" || depth > 0) result += character + next;
      continue;
    }
    if (character === "{") depth++;
    else if (character === "}") depth = Math.max(0, depth - 1);
    result += character;
  }
  return result;
}
