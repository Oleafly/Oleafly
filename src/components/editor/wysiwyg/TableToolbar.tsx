import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/core";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Combine,
  PanelTop,
  Split,
  TableColumnsSplit,
  TableRowsSplit,
  Trash2,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  applyBorderPreset,
  BORDER_PRESETS,
  CAPTION_PLACEMENTS,
  canMergeCells,
  canSplitCell,
  COLUMN_ALIGNMENTS,
  currentCaptionPlacement,
  currentColumnAlignment,
  deleteColumn,
  deleteRow,
  deleteTableFloat,
  hasHeaderRow,
  inferBorderPreset,
  insertColumn,
  insertRow,
  mergeCells,
  setCaptionPlacement,
  setColumnAlignment,
  setTableLabel,
  splitCell,
  tableFloatContext,
  toggleHeaderRow,
  type BorderPreset,
  type CaptionPlacement,
  type SimpleAlignment,
} from "./table-commands";

interface ToolbarPlacement {
  left: number;
  top: number;
}

const TOOLBAR_GAP = 6;
const VIEWPORT_MARGIN = 8;
const ALIGNMENT_ICONS: Record<SimpleAlignment, typeof AlignLeft> = {
  l: AlignLeft,
  c: AlignCenter,
  r: AlignRight,
};

function ToolButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: Readonly<{
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}>) {
  return (
    <Tooltip label={label} side="top">
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
        className={cn(
          "flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
          pressed && "bg-accent text-foreground",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function Separator() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

function placeToolbar(editor: Editor, position: number, toolbar: HTMLElement): ToolbarPlacement | null {
  const target = editor.view.nodeDOM(position);
  if (!(target instanceof HTMLElement)) return null;
  const rect = target.getBoundingClientRect();
  const width = toolbar.offsetWidth;
  const height = toolbar.offsetHeight;
  let top = rect.top - height - TOOLBAR_GAP;
  if (top < VIEWPORT_MARGIN) top = rect.bottom + TOOLBAR_GAP;
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
  const left = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), maxLeft);
  return { left, top: Math.max(VIEWPORT_MARGIN, top) };
}

function useToolbarPlacement(editor: Editor, position: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<ToolbarPlacement | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const toolbar = ref.current;
      if (toolbar) setPlacement(placeToolbar(editor, position, toolbar));
    };
    place();
    editor.on("transaction", place);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      editor.off("transaction", place);
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [editor, position]);
  return { ref, placement };
}

function useEditorRevision(editor: Editor): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const bump = () => setRevision((value) => value + 1);
    editor.on("transaction", bump);
    return () => {
      editor.off("transaction", bump);
    };
  }, [editor]);
  return revision;
}

function LabelField({ editor, value }: Readonly<{ editor: Editor; value: string }>) {
  const { t } = useTranslation(["common", "editor"]);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commit = () => {
    if (draft.trim() !== value) setTableLabel(editor, draft);
  };
  return (
    <input
      type="text"
      value={draft}
      aria-label={t(($) => $.editor.tableToolbar.tableLabel)}
      placeholder={t(($) => $.editor.tableToolbar.labelPlaceholder)}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          commit();
          editor.view.focus();
        }
      }}
      className="h-7 w-24 rounded border border-border bg-background px-1.5 font-mono text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  );
}

export function TableToolbar({ editor, position }: Readonly<{ editor: Editor; position: number }>) {
  const { t } = useTranslation(["common", "editor"]);
  useEditorRevision(editor);
  const { ref, placement } = useToolbarPlacement(editor, position);
  const context = tableFloatContext(editor.state);
  if (!context) return null;
  const alignment = currentColumnAlignment(editor.state);
  const preset = inferBorderPreset(context.float);
  const caption = currentCaptionPlacement(context.float);
  const label = typeof context.float.attrs.label === "string" ? context.float.attrs.label : "";
  const presetLabels: Record<BorderPreset, string> = {
    none: t(($) => $.editor.tableToolbar.bordersNone),
    horizontal: t(($) => $.editor.tableToolbar.bordersHorizontal),
    all: t(($) => $.editor.tableToolbar.bordersAll),
    booktabs: t(($) => $.editor.tableToolbar.bordersBooktabs),
  };
  const captionLabels: Record<CaptionPlacement, string> = {
    none: t(($) => $.editor.tableToolbar.captionNone),
    above: t(($) => $.editor.tableToolbar.captionAbove),
    below: t(($) => $.editor.tableToolbar.captionBelow),
  };
  const alignmentLabels: Record<SimpleAlignment, string> = {
    l: t(($) => $.editor.tableToolbar.alignLeft),
    c: t(($) => $.editor.tableToolbar.alignCenter),
    r: t(($) => $.editor.tableToolbar.alignRight),
  };
  const selectClass =
    "h-7 rounded border border-border bg-background px-1 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring";

  return createPortal(
    <div
      ref={ref}
      role="toolbar"
      aria-label={t(($) => $.editor.tableToolbar.label)}
      data-testid="wysiwyg-table-toolbar"
      className="fixed z-[60] flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
      style={placement ? { left: placement.left, top: placement.top } : { left: -10_000, top: -10_000 }}
    >
      <ToolButton label={t(($) => $.editor.tableToolbar.insertRowAbove)} onClick={() => insertRow(editor, "above")}>
        <ArrowUpToLine className="size-4" />
      </ToolButton>
      <ToolButton label={t(($) => $.editor.tableToolbar.insertRowBelow)} onClick={() => insertRow(editor, "below")}>
        <ArrowDownToLine className="size-4" />
      </ToolButton>
      <ToolButton label={t(($) => $.editor.tableToolbar.deleteRow)} onClick={() => deleteRow(editor)}>
        <TableRowsSplit className="size-4" />
      </ToolButton>
      <Separator />
      <ToolButton label={t(($) => $.editor.tableToolbar.insertColumnLeft)} onClick={() => insertColumn(editor, "left")}>
        <ArrowLeftToLine className="size-4" />
      </ToolButton>
      <ToolButton label={t(($) => $.editor.tableToolbar.insertColumnRight)} onClick={() => insertColumn(editor, "right")}>
        <ArrowRightToLine className="size-4" />
      </ToolButton>
      <ToolButton label={t(($) => $.editor.tableToolbar.deleteColumn)} onClick={() => deleteColumn(editor)}>
        <TableColumnsSplit className="size-4" />
      </ToolButton>
      <Separator />
      {COLUMN_ALIGNMENTS.map((align) => {
        const Icon = ALIGNMENT_ICONS[align];
        return (
          <ToolButton
            key={align}
            label={alignmentLabels[align]}
            pressed={alignment === align}
            disabled={alignment === null}
            onClick={() => setColumnAlignment(editor, align)}
          >
            <Icon className="size-4" />
          </ToolButton>
        );
      })}
      <Separator />
      <ToolButton
        label={t(($) => $.editor.tableToolbar.mergeCells)}
        disabled={!canMergeCells(editor)}
        onClick={() => mergeCells(editor)}
      >
        <Combine className="size-4" />
      </ToolButton>
      <ToolButton
        label={t(($) => $.editor.tableToolbar.splitCell)}
        disabled={!canSplitCell(editor)}
        onClick={() => splitCell(editor)}
      >
        <Split className="size-4" />
      </ToolButton>
      <ToolButton
        label={t(($) => $.editor.tableToolbar.headerRow)}
        pressed={hasHeaderRow(context.table)}
        onClick={() => toggleHeaderRow(editor)}
      >
        <PanelTop className="size-4" />
      </ToolButton>
      <Separator />
      <select
        aria-label={t(($) => $.editor.tableToolbar.borders)}
        value={preset}
        onChange={(event) => applyBorderPreset(editor, event.target.value as BorderPreset)}
        className={selectClass}
      >
        {BORDER_PRESETS.map((option) => (
          <option key={option} value={option}>
            {presetLabels[option]}
          </option>
        ))}
      </select>
      <select
        aria-label={t(($) => $.editor.tableToolbar.captionPosition)}
        value={caption}
        onChange={(event) => setCaptionPlacement(editor, event.target.value as CaptionPlacement)}
        className={selectClass}
      >
        {CAPTION_PLACEMENTS.map((option) => (
          <option key={option} value={option}>
            {captionLabels[option]}
          </option>
        ))}
      </select>
      <LabelField key={position} editor={editor} value={label} />
      <Separator />
      <ToolButton label={t(($) => $.editor.tableToolbar.deleteTable)} onClick={() => deleteTableFloat(editor)}>
        <Trash2 className="size-4" />
      </ToolButton>
    </div>,
    document.body,
  );
}
