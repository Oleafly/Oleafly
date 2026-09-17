import { type FC, useMemo } from "react";
import type { ColumnAlignment } from "./column-spec";
import {
  alignmentEdit,
  borderPresetEdit,
  captionEdit,
  captionPlacementOf,
  deleteSelectionEdit,
  insertColumnsEdit,
  insertRowsEdit,
  mergeCellsEdit,
  removeColumnWidthEdit,
  removeTableEdit,
  unmergeCellsEdit,
} from "./commands";
import { useApplyEdit, useTableHost, useTableSelection, useTableUi } from "./contexts";
import { MenuItem, MenuSeparator, ToolbarButton, ToolbarMenu, ToolbarSelect } from "./controls";
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BooktabsIcon,
  BorderAllIcon,
  BorderNoneIcon,
  HelpIcon,
  MergeIcon,
  PlusIcon,
  TableRemoveIcon,
  TrashIcon,
  WidthIcon,
  WrapIcon,
} from "./icons";
import { editorMessage } from "../../messages";
import type { BorderPreset } from "./model";

const ALIGNMENT_ICONS: Record<ColumnAlignment, FC> = {
  left: AlignLeftIcon,
  center: AlignCenterIcon,
  right: AlignRightIcon,
  paragraph: AlignJustifyIcon,
};

export const Toolbar: FC = () => {
  const host = useTableHost();
  const { view, parsed, environment, directChild } = host;
  const { model } = parsed;
  const { selection } = useTableSelection();
  const { setDialog } = useTableUi();
  const applyEdit = useApplyEdit();

  const preset = useMemo(() => model.borderPreset(), [model]);
  const placement = captionPlacementOf(parsed, environment);

  const alignment = useMemo<ColumnAlignment | null>(() => {
    if (!selection) return null;
    if (selection.isMergedCell(model)) {
      const cell = model.cellAt(selection.anchor.row, selection.anchor.column);
      return cell.multiColumn?.columns[0]?.alignment ?? null;
    }
    const { minColumn, maxColumn } = selection.bounds;
    const first = model.columns[minColumn].alignment;
    for (let column = minColumn + 1; column <= maxColumn; column++) {
      if (model.columns[column].alignment !== first) return null;
    }
    return first;
  }, [selection, model]);

  if (!selection) return null;

  const state = view.state;
  const columnsToInsert = selection.widestRowSpan(model);
  const rowsToInsert = selection.height();
  const merged = selection.isMergedCell(model);
  const columnSelected = selection.isColumnSelected(model, selection.anchor.column);
  const anyColumn = selection.anyColumnSelected(model);
  const paragraphOnly = selection.onlyParagraphColumns(model);
  const plainOnly = selection.onlyPlainColumns(model);
  const AlignmentIcon = ALIGNMENT_ICONS[alignment ?? "left"];

  const presetLabel: Record<BorderPreset, string> = {
    none: editorMessage("visual.table.noBorders"),
    all: editorMessage("visual.table.allBorders"),
    booktabs: editorMessage("visual.table.booktabs"),
  };
  const captionLabel = {
    none: editorMessage("visual.table.noCaption"),
    above: editorMessage("visual.table.captionAbove"),
    below: editorMessage("visual.table.captionBelow"),
  };

  return (
    <div className="ofl-visual-table-toolbar" role="toolbar">
      <div className="ofl-visual-table-group">
        <ToolbarSelect
          id="caption"
          value={captionLabel[placement]}
          label={editorMessage("visual.table.captionPlacement")}
          disabled={!environment || !directChild}
          disabledLabel={editorMessage("visual.table.captionNeedsTable")}
        >
          {(["none", "above", "below"] as const).map((target) => (
            <MenuItem
              key={target}
              label={captionLabel[target]}
              checked={placement === target}
              onSelect={() => applyEdit(captionEdit(state, parsed, environment, target))}
            />
          ))}
        </ToolbarSelect>
        <ToolbarSelect
          id="borders"
          value={preset ? presetLabel[preset] : editorMessage("visual.table.customBorders")}
          label={editorMessage("visual.table.borders")}
        >
          <MenuItem
            label={presetLabel.none}
            icon={<BorderNoneIcon />}
            checked={preset === "none"}
            onSelect={() => applyEdit(borderPresetEdit(state, parsed, "none"))}
          />
          <MenuItem
            label={presetLabel.all}
            icon={<BorderAllIcon />}
            checked={preset === "all"}
            onSelect={() => applyEdit(borderPresetEdit(state, parsed, "all"))}
          />
          <MenuItem
            label={presetLabel.booktabs}
            icon={<BooktabsIcon />}
            checked={preset === "booktabs"}
            onSelect={() => applyEdit(borderPresetEdit(state, parsed, "booktabs"))}
          />
        </ToolbarSelect>
      </div>
      <div className="ofl-visual-table-group">
        <ToolbarMenu
          id="alignment"
          trigger={({ open, toggle }) => (
            <ToolbarButton
              label={editorMessage("visual.table.alignment")}
              icon={<AlignmentIcon />}
              caret
              expanded={open}
              disabled={!columnSelected && !merged}
              disabledLabel={editorMessage("visual.table.selectColumnToAlign")}
              onClick={toggle}
            />
          )}
        >
          <MenuItem
            label={editorMessage("visual.table.alignLeft")}
            icon={<AlignLeftIcon />}
            checked={alignment === "left"}
            onSelect={() => applyEdit(alignmentEdit(state, parsed, selection, "left"))}
          />
          <MenuItem
            label={editorMessage("visual.table.alignCenter")}
            icon={<AlignCenterIcon />}
            checked={alignment === "center"}
            onSelect={() => applyEdit(alignmentEdit(state, parsed, selection, "center"))}
          />
          <MenuItem
            label={editorMessage("visual.table.alignRight")}
            icon={<AlignRightIcon />}
            checked={alignment === "right"}
            onSelect={() => applyEdit(alignmentEdit(state, parsed, selection, "right"))}
          />
          {paragraphOnly && !merged ? (
            <MenuItem
              label={editorMessage("visual.table.alignJustify")}
              icon={<AlignJustifyIcon />}
              checked={alignment === "paragraph"}
              onSelect={() => applyEdit(alignmentEdit(state, parsed, selection, "paragraph"))}
            />
          ) : null}
        </ToolbarMenu>
        <ToolbarMenu
          id="width"
          trigger={({ open, toggle }) => (
            <ToolbarButton
              label={editorMessage("visual.table.columnWidth")}
              icon={paragraphOnly ? <WrapIcon /> : <WidthIcon />}
              caret
              expanded={open}
              disabled={!anyColumn}
              disabledLabel={editorMessage("visual.table.selectColumnForWidth")}
              onClick={toggle}
            />
          )}
        >
          <MenuItem
            label={editorMessage("visual.table.fitToContent")}
            icon={<WidthIcon />}
            checked={plainOnly}
            onSelect={() => applyEdit(removeColumnWidthEdit(state, parsed, selection))}
          />
          <MenuItem
            label={editorMessage("visual.table.fixedWidth")}
            icon={<WrapIcon />}
            checked={paragraphOnly}
            onSelect={() => setDialog("width")}
          />
          {paragraphOnly ? (
            <>
              <MenuSeparator />
              <MenuItem label={editorMessage("visual.table.setColumnWidth")} onSelect={() => setDialog("width")} />
            </>
          ) : null}
        </ToolbarMenu>
        <ToolbarButton
          label={merged ? editorMessage("visual.table.unmergeCells") : editorMessage("visual.table.mergeCells")}
          icon={<MergeIcon />}
          active={merged}
          disabled={!merged && !selection.canMerge(model)}
          disabledLabel={editorMessage("visual.table.selectCellsToMerge")}
          onClick={() => applyEdit(merged ? unmergeCellsEdit(parsed, selection) : mergeCellsEdit(parsed, selection))}
        />
        <ToolbarButton
          label={editorMessage("visual.table.deleteRowOrColumn")}
          icon={<TrashIcon />}
          disabled={
            (!selection.anyRowSelected(model) && !selection.anyColumnSelected(model)) ||
            !selection.eq(selection.expand(model))
          }
          disabledLabel={editorMessage("visual.table.selectRowOrColumnToDelete")}
          onClick={() => applyEdit(deleteSelectionEdit(state, parsed, selection))}
        />
        <ToolbarMenu
          id="insert"
          trigger={({ open, toggle }) => (
            <ToolbarButton
              label={editorMessage("visual.table.insert")}
              icon={<PlusIcon />}
              caret
              expanded={open}
              onClick={toggle}
            />
          )}
        >
          <MenuItem
            label={editorMessage("visual.table.insertColumnsLeft", { count: columnsToInsert })}
            onSelect={() => applyEdit(insertColumnsEdit(state, parsed, selection, "left"))}
          />
          <MenuItem
            label={editorMessage("visual.table.insertColumnsRight", { count: columnsToInsert })}
            onSelect={() => applyEdit(insertColumnsEdit(state, parsed, selection, "right"))}
          />
          <MenuSeparator />
          <MenuItem
            label={editorMessage("visual.table.insertRowsAbove", { count: rowsToInsert })}
            onSelect={() => applyEdit(insertRowsEdit(state, parsed, selection, "above"))}
          />
          <MenuItem
            label={editorMessage("visual.table.insertRowsBelow", { count: rowsToInsert })}
            onSelect={() => applyEdit(insertRowsEdit(state, parsed, selection, "below"))}
          />
        </ToolbarMenu>
      </div>
      <div className="ofl-visual-table-group">
        <ToolbarButton
          label={editorMessage("visual.table.removeTable")}
          icon={<TableRemoveIcon />}
          onClick={() => {
            applyEdit(removeTableEdit(state, parsed, environment));
            view.focus();
          }}
        />
        <ToolbarButton
          label={editorMessage("visual.table.help")}
          icon={<HelpIcon />}
          onClick={() => setDialog("help")}
        />
      </div>
    </div>
  );
};
