import { type FC, type FormEvent, type MouseEvent, useCallback, useLayoutEffect, useRef } from "react";
import type { ColumnSpec } from "./column-spec";
import { useTableEditing, useTableHost, useTableSelection } from "./contexts";
import { editorMessage } from "../../messages";
import { type CellData, type RowData, cellSpan } from "./model";
import { CellSelection } from "./table-selection";

const CellInput: FC<{ value: string; onInput: (value: string) => void; onBlur: () => void }> = ({
  value,
  onInput,
  onBlur,
}) => {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "1px";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  return (
    <textarea
      ref={ref}
      className="ofl-visual-table-cell-input"
      aria-label={editorMessage("visual.table.cellInput")}
      rows={1}
      value={value}
      onInput={(event: FormEvent<HTMLTextAreaElement>) => onInput(event.currentTarget.value)}
      onBlur={onBlur}
    />
  );
};

export const Cell: FC<{
  cell: CellData;
  rowIndex: number;
  column: number;
  row: RowData;
  spec: ColumnSpec;
}> = ({ cell, rowIndex, column, row, spec }) => {
  const { view, parsed } = useTableHost();
  const { model } = parsed;
  const { selection, setSelection, dragging, setDragging } = useTableSelection();
  const { editing, startEditing, updateContent, commitEditing } = useTableEditing();
  const span = cellSpan(cell);
  const columnSpec = cell.multiColumn?.columns[0] ?? spec;

  const isEditing =
    editing !== null && editing.row === rowIndex && editing.column >= column && editing.column < column + span;
  const selected = selection?.contains(model, rowIndex, column) ?? false;

  const onMouseDown = useCallback(
    (event: MouseEvent) => {
      if (isEditing || event.button !== 0) return;
      event.preventDefault();
      setDragging(true);
      setSelection((current) =>
        event.shiftKey && current
          ? new CellSelection(current.anchor, { row: rowIndex, column }).expand(model)
          : CellSelection.cell(rowIndex, column).expand(model),
      );
    },
    [isEditing, setDragging, setSelection, rowIndex, column, model],
  );

  const onMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!dragging) return;
      if (event.buttons !== 1) {
        setDragging(false);
        return;
      }
      if (selection?.head.row === rowIndex && selection.head.column === column) return;
      setSelection((current) =>
        current
          ? new CellSelection(current.anchor, { row: rowIndex, column }).expand(model)
          : CellSelection.cell(rowIndex, column).expand(model),
      );
    },
    [dragging, setDragging, selection, rowIndex, column, setSelection, model],
  );

  const onMouseUp = useCallback(() => {
    if (dragging) setDragging(false);
  }, [dragging, setDragging]);

  const onDoubleClick = useCallback(() => {
    if (!view.state.readOnly) startEditing(rowIndex, column);
  }, [view, startEditing, rowIndex, column]);

  const classes = ["ofl-visual-table-cell", `ofl-visual-table-cell-${columnSpec.alignment}`];
  if (columnSpec.borderLeft > 0) classes.push("ofl-visual-table-cell-border-left");
  if (columnSpec.borderRight > 0) classes.push("ofl-visual-table-cell-border-right");
  if (row.rulesAbove.length > 0) classes.push("ofl-visual-table-cell-border-top");
  if (row.rulesAbove.length > 1) classes.push("ofl-visual-table-cell-rule-double");
  if (row.rulesBelow.length > 0) classes.push("ofl-visual-table-cell-border-bottom");
  if (selected) classes.push("ofl-visual-table-cell-selected");
  if (isEditing) classes.push("ofl-visual-table-cell-editing");

  return (
    <td
      className={classes.join(" ")}
      colSpan={span > 1 ? span : undefined}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onDoubleClick={onDoubleClick}
    >
      {isEditing && editing ? (
        <CellInput value={editing.content} onInput={updateContent} onBlur={() => commitEditing()} />
      ) : (
        <div className="ofl-visual-table-cell-text">{cell.content.trim()}</div>
      )}
    </td>
  );
};
