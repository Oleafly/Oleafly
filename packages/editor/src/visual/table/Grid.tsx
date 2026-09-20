import { redo, undo } from "@codemirror/commands";
import { type FC, type KeyboardEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef } from "react";
import { Cell } from "./Cell";
import { formatColumnWidth } from "./column-spec";
import { clearCellsEdit, insertRowsEdit } from "./commands";
import { type EditingCell, useApplyEdit, useTableEditing, useTableHost, useTableSelection, useTableUi } from "./contexts";
import { editorMessage } from "../../messages";
import { type RowData, cellSpan } from "./model";
import { CellSelection } from "./table-selection";

const MIN_COLUMN_CHARS = 12;
const MIN_EDITING_CHARS = 20;
const CHAR_PADDING = 3;

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform);
}

function editingChars(editing: EditingCell | null, row: number, column: number, span: number): number {
  if (editing?.row !== row) return 0;
  if (editing.column < column || editing.column >= column + span) return 0;
  return Math.min(editing.content.length + CHAR_PADDING, MIN_EDITING_CHARS);
}

const RowHandle: FC<{ rowIndex: number }> = ({ rowIndex }) => {
  const { parsed } = useTableHost();
  const { selection, setSelection } = useTableSelection();
  const active = selection?.isRowSelected(parsed.model, rowIndex) ?? false;
  const onMouseDown = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      setSelection((current) =>
        current ? current.selectRow(parsed.model, rowIndex, event.shiftKey) : CellSelection.row(parsed.model, rowIndex),
      );
    },
    [parsed.model, rowIndex, setSelection],
  );
  return (
    <td
      className={`ofl-visual-table-handle ofl-visual-table-handle-row${active ? " ofl-visual-table-handle-active" : ""}`}
      aria-label={editorMessage("visual.table.selectRow", { row: rowIndex + 1 })}
      onMouseDown={onMouseDown}
    />
  );
};

const ColumnHandle: FC<{ column: number }> = ({ column }) => {
  const { parsed } = useTableHost();
  const { selection, setSelection } = useTableSelection();
  const active = selection?.isColumnSelected(parsed.model, column) ?? false;
  const onMouseDown = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      setSelection((current) =>
        current ? current.selectColumn(parsed.model, column, event.shiftKey) : CellSelection.column(parsed.model, column),
      );
    },
    [parsed.model, column, setSelection],
  );
  return (
    <td
      className={`ofl-visual-table-handle ofl-visual-table-handle-column${active ? " ofl-visual-table-handle-active" : ""}`}
      aria-label={editorMessage("visual.table.selectColumn", { column: column + 1 })}
      onMouseDown={onMouseDown}
    />
  );
};

const Row: FC<{ row: RowData; rowIndex: number }> = ({ row, rowIndex }) => {
  const { parsed } = useTableHost();
  let column = 0;
  return (
    <tr>
      <RowHandle rowIndex={rowIndex} />
      {row.cells.map((cell, index) => {
        const start = column;
        column += cellSpan(cell);
        return (
          <Cell
            key={`${index}-${start}`}
            cell={cell}
            rowIndex={rowIndex}
            column={start}
            row={row}
            spec={parsed.model.columns[start]}
          />
        );
      })}
    </tr>
  );
};

export const Grid: FC = () => {
  const { view, parsed } = useTableHost();
  const { model } = parsed;
  const { selection, setSelection: select } = useTableSelection();
  const { editing, startEditing, commitEditing, cancelEditing } = useTableEditing();
  const { setDialog } = useTableUi();
  const applyEdit = useApplyEdit();
  const tableRef = useRef<HTMLTableElement | null>(null);

  const { widths, totalChars } = useMemo(() => {
    const chars = Array.from({ length: model.columnCount }, () => MIN_COLUMN_CHARS);
    for (let row = 0; row < model.rowCount; row++) {
      let column = 0;
      for (const cell of model.rows[row].cells) {
        const span = cellSpan(cell);
        const length = Math.max(
          cell.content.trim().length + CHAR_PADDING,
          editingChars(editing, row, column, span),
        );
        for (let offset = 0; offset < span; offset++) {
          chars[column + offset] = Math.max(chars[column + offset], length / span);
        }
        column += span;
      }
    }
    const total = chars.reduce((sum, value) => sum + value, 0);
    const logs = chars.map((value) => Math.log2(value));
    const logTotal = logs.reduce((sum, value) => sum + value, 0);
    return { widths: logs.map((value) => Math.round((value / logTotal) * 100)), totalChars: total };
  }, [model, editing]);

  useEffect(() => {
    if (selection && !editing) tableRef.current?.focus({ preventScroll: true });
  }, [selection, editing]);

  const moveNext = useCallback(() => {
    if (!selection) return;
    const next = selection.next(model);
    if (next) {
      if (editing) commitEditing();
      select(next);
      return;
    }
    const edit = insertRowsEdit(view.state, parsed, CellSelection.row(model, model.rowCount - 1), "below", 1);
    const apply = editing ? commitEditing : applyEdit;
    apply({ changes: edit.changes, selection: CellSelection.cell(model.rowCount, 0) });
  }, [selection, model, select, view, parsed, applyEdit, editing, commitEditing]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (view.state.readOnly) return;
      const key = event.key;
      const stop = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      const editSelected = () => {
        if (!selection) return;
        if (editing) commitEditing();
        else startEditing(selection.head.row, selection.head.column);
        select(CellSelection.cell(selection.head.row, selection.head.column).expand(model));
      };
      const leaveGrid = () => {
        if (editing) {
          cancelEditing();
          return;
        }
        select(null);
        view.focus();
      };
      const moveToSibling = () => {
        if (!selection) {
          select(CellSelection.cell(0, 0).expand(model));
          return;
        }
        if (event.shiftKey) {
          if (editing) commitEditing();
          select(selection.previous(model));
        } else moveNext();
      };
      const clearSelected = () => {
        if (!selection) return;
        stop();
        applyEdit(clearCellsEdit(parsed, selection));
      };
      const arrowTarget = (): CellSelection | null => {
        if (!selection) return null;
        if (key === "ArrowLeft") return event.shiftKey ? selection.extendLeft(model) : selection.moveLeft(model);
        if (key === "ArrowRight") return event.shiftKey ? selection.extendRight(model) : selection.moveRight(model);
        if (key === "ArrowUp") return event.shiftKey ? selection.extendUp(model) : selection.moveUp(model);
        if (key === "ArrowDown") return event.shiftKey ? selection.extendDown(model) : selection.moveDown(model);
        return null;
      };
      const runCommandKey = () => {
        const lower = key.toLowerCase();
        if (lower === "z" || lower === "y") {
          stop();
          if (lower === "y" || event.shiftKey) redo(view);
          else undo(view);
          return;
        }
        if (lower !== "a") return;
        stop();
        select(new CellSelection({ row: 0, column: 0 }, { row: model.rowCount - 1, column: model.columnCount - 1 }));
      };
      const typeIntoCell = () => {
        if (!selection) return;
        stop();
        startEditing(selection.head.row, selection.head.column, key);
        select(CellSelection.cell(selection.head.row, selection.head.column).expand(model));
      };

      if (key === "Enter" && !event.shiftKey) {
        stop();
        editSelected();
        return;
      }
      if (key === "Escape") {
        stop();
        leaveGrid();
        return;
      }
      if (key === "Tab") {
        stop();
        moveToSibling();
        return;
      }
      if (editing) return;
      if (key === "Delete" || key === "Backspace") {
        clearSelected();
        return;
      }
      if (key.startsWith("Arrow")) {
        stop();
        select(arrowTarget() ?? CellSelection.cell(0, 0).expand(model));
        return;
      }
      const command = isMac() ? event.metaKey : event.ctrlKey;
      if (command) {
        runCommandKey();
        return;
      }
      if (key.length === 1 && !event.altKey) typeIntoCell();
    },
    [view, selection, editing, commitEditing, startEditing, cancelEditing, select, model, moveNext, applyEdit, parsed],
  );

  const hasWidths = model.columns.some((column) => column.width);

  return (
    <table
      className="ofl-visual-table-grid"
      role="grid"
      ref={tableRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{ width: `min(${Math.round(totalChars)}ch, 100%)` }}
    >
      <colgroup>
        <col style={{ width: "18px" }} />
        {widths.map((width, index) => (
          <col key={`col-${index}`} style={{ width: `${width}%` }} />
        ))}
      </colgroup>
      <thead>
        {hasWidths ? (
          <tr className="ofl-visual-table-widths">
            <td className="ofl-visual-table-corner" />
            {model.columns.map((column, index) => (
              <td key={`width-${index}`}>
                {column.width && selection ? (
                  <button
                    type="button"
                    className="ofl-visual-table-width-badge"
                    title={editorMessage("visual.table.columnWidthIndicator", {
                      width: formatColumnWidth(column.width),
                    })}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      select(CellSelection.column(model, index));
                      setDialog("width");
                    }}
                  >
                    <span>{formatColumnWidth(column.width)}</span>
                  </button>
                ) : null}
              </td>
            ))}
          </tr>
        ) : null}
        <tr>
          <td className="ofl-visual-table-corner" />
          {model.columns.map((_, index) => (
            <ColumnHandle key={`handle-${index}`} column={index} />
          ))}
        </tr>
      </thead>
      <tbody>
        {model.rows.map((row, index) => (
          <Row key={`row-${index}`} row={row} rowIndex={index} />
        ))}
      </tbody>
    </table>
  );
};
