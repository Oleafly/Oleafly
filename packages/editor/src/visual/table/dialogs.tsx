import { type FC, type FormEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type AbsoluteWidthUnit, type ColumnWidth, trimNumber } from "./column-spec";
import { columnWidthEdit } from "./commands";
import { useApplyEdit, useTableHost, useTableSelection, useTableUi } from "./contexts";
import { editorMessage } from "../../messages";

const UNITS = ["%", "cm", "mm", "in", "pt", "custom"] as const;

type WidthUnit = (typeof UNITS)[number];

const DialogFrame: FC<{ title: string; onClose: () => void; children: ReactNode }> = ({ title, onClose, children }) => {
  const { view } = useTableHost();
  const container = useMemo(() => {
    const element = document.createElement("div");
    element.className = view.themeClasses;
    element.dataset.oflVisualTableDialog = "";
    return element;
  }, [view]);

  useEffect(() => {
    document.body.appendChild(container);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      container.remove();
    };
  }, [container, onClose]);

  return createPortal(
    <div
      className="ofl-visual-table-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <dialog className="ofl-visual-table-dialog" open aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </dialog>
    </div>,
    container,
  );
};

const HelpDialog: FC<{ onClose: () => void }> = ({ onClose }) => (
  <DialogFrame title={editorMessage("visual.table.helpTitle")} onClose={onClose}>
    <p>{editorMessage("visual.table.helpIntro")}</p>
    <h3>{editorMessage("visual.table.helpSupportedTitle")}</h3>
    <ul>
      <li>{editorMessage("visual.table.helpSupportedColumns")}</li>
      <li>{editorMessage("visual.table.helpSupportedRules")}</li>
      <li>{editorMessage("visual.table.helpSupportedMerged")}</li>
      <li>{editorMessage("visual.table.helpSupportedCaption")}</li>
    </ul>
    <p>{editorMessage("visual.table.helpUnsupported")}</p>
    <h3>{editorMessage("visual.table.helpShortcutsTitle")}</h3>
    <ul>
      <li>{editorMessage("visual.table.shortcutMove")}</li>
      <li>{editorMessage("visual.table.shortcutExtend")}</li>
      <li>{editorMessage("visual.table.shortcutNext")}</li>
      <li>{editorMessage("visual.table.shortcutEdit")}</li>
      <li>{editorMessage("visual.table.shortcutCancel")}</li>
      <li>{editorMessage("visual.table.shortcutClear")}</li>
      <li>{editorMessage("visual.table.shortcutUndo")}</li>
    </ul>
    <div className="ofl-visual-table-dialog-actions">
      <button type="button" className="ofl-visual-table-dialog-button" onClick={onClose}>
        {editorMessage("visual.table.close")}
      </button>
    </div>
  </DialogFrame>
);

function initialWidth(width: ColumnWidth | undefined): { unit: WidthUnit; value: string } {
  if (!width) return { unit: "%", value: "" };
  if (width.kind === "relative") return { unit: "%", value: trimNumber(width.fraction * 100) };
  if (width.kind === "absolute") return { unit: width.unit, value: trimNumber(width.value) };
  return { unit: "custom", value: width.raw };
}

function widthHint(unit: WidthUnit): string | null {
  if (unit === "%") return editorMessage("visual.table.widthPercentHelp");
  if (unit === "custom") return editorMessage("visual.table.widthCustomHelp");
  return null;
}

const WidthDialog: FC<{ onClose: () => void }> = ({ onClose }) => {
  const { view, parsed } = useTableHost();
  const { selection } = useTableSelection();
  const applyEdit = useApplyEdit();
  const column = selection?.width() === 1 ? parsed.model.columns[selection.anchor.column] : null;
  const initial = initialWidth(column?.width);
  const [unit, setUnit] = useState<WidthUnit>(initial.unit);
  const [value, setValue] = useState(initial.value);
  const valueRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    valueRef.current?.focus();
  }, []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!selection) return;
    let width: ColumnWidth;
    if (unit === "custom") {
      if (!value.trim()) return;
      width = { kind: "custom", raw: value.trim() };
    } else {
      const amount = Number.parseFloat(value);
      if (!Number.isFinite(amount) || amount <= 0) return;
      if (unit === "%") {
        const command = column?.width?.kind === "relative" ? column.width.command : "linewidth";
        width = { kind: "relative", fraction: amount / 100, command };
      } else {
        width = { kind: "absolute", value: amount, unit: unit as AbsoluteWidthUnit };
      }
    }
    applyEdit(columnWidthEdit(view.state, parsed, selection, width));
    onClose();
  };

  return (
    <DialogFrame title={editorMessage("visual.table.setColumnWidth")} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <div className="ofl-visual-table-fields">
          <label className="ofl-visual-table-field">
            <span className="ofl-visual-table-field-label">{editorMessage("visual.table.widthValue")}</span>
            <input
              ref={valueRef}
              className="ofl-visual-table-input"
              type={unit === "custom" ? "text" : "number"}
              min={unit === "custom" ? undefined : 0}
              step="any"
              required
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
            />
          </label>
          <label className="ofl-visual-table-field">
            <span className="ofl-visual-table-field-label">{editorMessage("visual.table.widthUnit")}</span>
            <select
              className="ofl-visual-table-input"
              value={unit}
              onChange={(event) => setUnit(event.currentTarget.value as WidthUnit)}
            >
              {UNITS.map((option) => (
                <option key={option} value={option}>
                  {option === "custom" ? editorMessage("visual.table.widthCustom") : option}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="ofl-visual-table-hint">{widthHint(unit)}</p>
        <p className="ofl-visual-table-hint">
          {editorMessage("visual.table.widthNeedsArray")} <code>{String.raw`\usepackage{array}`}</code>
        </p>
        <div className="ofl-visual-table-dialog-actions">
          <button type="button" className="ofl-visual-table-dialog-button" onClick={onClose}>
            {editorMessage("visual.table.cancel")}
          </button>
          <button type="submit" className="ofl-visual-table-dialog-button ofl-visual-table-dialog-button-primary">
            {editorMessage("visual.table.ok")}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
};

export const Dialogs: FC = () => {
  const { dialog, setDialog } = useTableUi();
  const close = () => setDialog(null);
  if (dialog === "help") return <HelpDialog onClose={close} />;
  if (dialog === "width") return <WidthDialog onClose={close} />;
  return null;
};
