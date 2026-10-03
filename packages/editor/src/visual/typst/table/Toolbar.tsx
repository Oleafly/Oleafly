import { createContext, type FC, useContext, useMemo } from "react";
import { editorMessage } from "../../../messages";
import { useApplyEdit, useTableHost, useTableSelection } from "../../table/contexts";
import { MenuItem, MenuSeparator, ToolbarButton, ToolbarMenu, ToolbarSelect } from "../../table/controls";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BorderAllIcon,
  BorderNoneIcon,
  PlusIcon,
  TableRemoveIcon,
  TrashIcon,
} from "../../table/icons";
import type { TextRange } from "../syntax";
import {
  typstAlignmentEdit,
  typstBordersEdit,
  typstDeleteSelectionEdit,
  typstInsertColumnsEdit,
  typstInsertRowsEdit,
  typstRemoveTableEdit,
} from "./commands";
import type { TypstAlignment, TypstTable } from "./parse";

export interface TypstTableInfo {
  table: TypstTable;
  removal: TextRange;
}

export const TypstTableContext = createContext<TypstTableInfo | null>(null);

const ALIGNMENT_ICONS: Record<TypstAlignment, FC> = {
  left: AlignLeftIcon,
  center: AlignCenterIcon,
  right: AlignRightIcon,
};

export const TypstTableToolbar: FC = () => {
  const { view } = useTableHost();
  const info = useContext(TypstTableContext);
  const { selection } = useTableSelection();
  const applyEdit = useApplyEdit();

  const alignment = useMemo<TypstAlignment | null>(() => {
    if (!selection || !info) return null;
    const { minColumn, maxColumn } = selection.bounds;
    const first = info.table.alignments[minColumn];
    for (let column = minColumn + 1; column <= maxColumn; column++) {
      if (info.table.alignments[column] !== first) return null;
    }
    return first ?? null;
  }, [selection, info]);

  if (!selection || !info) return null;

  const { table, removal } = info;
  const state = view.state;
  const model = table.parsed.model;
  const AlignmentIcon = ALIGNMENT_ICONS[alignment ?? "left"];
  const columnSelected = selection.anyColumnSelected(model);
  const rowsToInsert = selection.height();
  const columnsToInsert = selection.width();
  const borders = table.bordered ? editorMessage("visual.table.allBorders") : editorMessage("visual.table.noBorders");
  const align = (value: TypstAlignment) => applyEdit(typstAlignmentEdit(state, table, selection, value));

  return (
    <div className="ofl-visual-table-toolbar" role="toolbar">
      <div className="ofl-visual-table-group">
        <ToolbarSelect id="borders" value={borders} label={editorMessage("visual.table.borders")}>
          <MenuItem
            label={editorMessage("visual.table.noBorders")}
            icon={<BorderNoneIcon />}
            checked={!table.bordered}
            onSelect={() => applyEdit(typstBordersEdit(state, table, false))}
          />
          <MenuItem
            label={editorMessage("visual.table.allBorders")}
            icon={<BorderAllIcon />}
            checked={table.bordered}
            onSelect={() => applyEdit(typstBordersEdit(state, table, true))}
          />
        </ToolbarSelect>
      </div>
      <div className="ofl-visual-table-group">
        <ToolbarMenu
          id="alignment"
          label={editorMessage("visual.table.alignment")}
          icon={<AlignmentIcon />}
          disabled={!columnSelected || !table.alignEditable}
          disabledLabel={editorMessage("visual.table.selectColumnToAlign")}
        >
          <MenuItem
            label={editorMessage("visual.table.alignLeft")}
            icon={<AlignLeftIcon />}
            checked={alignment === "left"}
            onSelect={() => align("left")}
          />
          <MenuItem
            label={editorMessage("visual.table.alignCenter")}
            icon={<AlignCenterIcon />}
            checked={alignment === "center"}
            onSelect={() => align("center")}
          />
          <MenuItem
            label={editorMessage("visual.table.alignRight")}
            icon={<AlignRightIcon />}
            checked={alignment === "right"}
            onSelect={() => align("right")}
          />
        </ToolbarMenu>
        <ToolbarButton
          label={editorMessage("visual.table.deleteRowOrColumn")}
          icon={<TrashIcon />}
          disabled={!selection.anyRowSelected(model) && !selection.anyColumnSelected(model)}
          disabledLabel={editorMessage("visual.table.selectRowOrColumnToDelete")}
          onClick={() => applyEdit(typstDeleteSelectionEdit(state, table, selection))}
        />
        <ToolbarMenu id="insert" label={editorMessage("visual.table.insert")} icon={<PlusIcon />}>
          <MenuItem
            label={editorMessage("visual.table.insertColumnsLeft", { count: columnsToInsert })}
            onSelect={() => applyEdit(typstInsertColumnsEdit(state, table, selection, "left"))}
          />
          <MenuItem
            label={editorMessage("visual.table.insertColumnsRight", { count: columnsToInsert })}
            onSelect={() => applyEdit(typstInsertColumnsEdit(state, table, selection, "right"))}
          />
          <MenuSeparator />
          <MenuItem
            label={editorMessage("visual.table.insertRowsAbove", { count: rowsToInsert })}
            onSelect={() => applyEdit(typstInsertRowsEdit(state, table, selection, "above"))}
          />
          <MenuItem
            label={editorMessage("visual.table.insertRowsBelow", { count: rowsToInsert })}
            onSelect={() => applyEdit(typstInsertRowsEdit(state, table, selection, "below"))}
          />
        </ToolbarMenu>
      </div>
      <div className="ofl-visual-table-group">
        <ToolbarButton
          label={editorMessage("visual.table.removeTable")}
          icon={<TableRemoveIcon />}
          onClick={() => {
            applyEdit(typstRemoveTableEdit(state, removal));
            view.focus();
          }}
        />
      </div>
    </div>
  );
};
