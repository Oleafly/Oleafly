import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import { memo, type RefObject, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CheckBadge } from "@/components/ui/check-badge";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { ROW_WINDOW_ITEM, useRowWindow } from "@/hooks/use-row-window";
import { compareText, formatRelativeTimeFrom } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { isSelectionModifier } from "@/store/library-selection";
import { RowCornerButtons, useNoteMenus } from "./NoteCard";
import { CONTEXT_MENU_KIT, ConflictMark, hasNoteMenu, type NoteActions, NoteRenameInput } from "./note-actions";
import { NoteChip } from "./note-icons";
import {
  DEFAULT_TABLE_SORT,
  saveTableColumns,
  saveTableSort,
  type TableSort,
  useTableColumns,
  useTableSort,
} from "./note-home-prefs";
import { LIST_KEYS, MANAGED_KEYS } from "./note-properties";
import { ProjectDot } from "./project-color";
import type { NoteItem } from "./types";
import { filterByTag } from "./vault-store";

export type BaseColumn = "title" | "tags" | "status" | "project" | "edited";

export const BASE_COLUMNS: readonly BaseColumn[] = ["title", "tags", "status", "project", "edited"];
export const PROPERTY_PREFIX = "prop:";

const HIDDEN_KEYS: ReadonlySet<string> = new Set([...MANAGED_KEYS, ...LIST_KEYS, "status", "template"]);

type CellValue = string | number | null;

export function propertyKeys(notes: readonly NoteItem[]): string[] {
  const keys = new Set<string>();
  for (const note of notes) for (const key of Object.keys(note.properties ?? {})) if (!HIDDEN_KEYS.has(key)) keys.add(key);
  return [...keys].sort((left, right) => compareText(left, right));
}

export function formatValue(value: unknown, yes: string, no: string): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => formatValue(item, yes, no)).filter(Boolean).join(", ");
  if (typeof value === "boolean") return value ? yes : no;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function sortValue(note: NoteItem, key: string, tagsOf: (note: NoteItem) => readonly string[]): CellValue {
  if (key === "title") return note.title;
  if (key === "edited") return note.updatedAt;
  if (key === "project") return note.relatedProjectId ? note.project : null;
  if (key === "tags") return tagsOf(note).join(", ") || null;
  const property = key === "status" ? "status" : key.slice(PROPERTY_PREFIX.length);
  const value = note.properties?.[property];
  if (typeof value === "number") return value;
  return formatValue(value, "1", "0") || null;
}

export function sortTableRows(
  notes: readonly NoteItem[],
  sort: TableSort,
  tagsOf: (note: NoteItem) => readonly string[],
): NoteItem[] {
  const keyed = notes.map((note) => ({ note, value: sortValue(note, sort.key, tagsOf) }));
  keyed.sort((left, right) => {
    if (left.value === null || right.value === null) {
      if (left.value === right.value) return compareText(left.note.title, right.note.title);
      return left.value === null ? 1 : -1;
    }
    const order =
      typeof left.value === "number" && typeof right.value === "number"
        ? left.value - right.value
        : compareText(String(left.value), String(right.value));
    return (sort.descending ? -order : order) || compareText(left.note.title, right.note.title);
  });
  return keyed.map(({ note }) => note);
}

export function nextSort(current: TableSort, key: string): TableSort {
  if (current.key === key) return { key, descending: !current.descending };
  return { key, descending: key === "edited" };
}

interface NotesTableProps {
  notes: readonly NoteItem[];
  iconFor: (note: NoteItem) => string | undefined;
  tagsOf: (note: NoteItem) => readonly string[];
  projectColor: (projectId: string | undefined) => string | null;
  onOpenNote: (id: string) => void;
  onOpenNoteInNewTab?: (id: string) => void;
  onTag?: (tag: string) => void;
  actionsFor?: (note: NoteItem) => NoteActions;
  scrollRef?: RefObject<HTMLElement | null>;
}

const TABLE_UNMEASURED_ROWS = 16;

interface TableRowProps {
  note: NoteItem;
  index: number;
  icon: string | undefined;
  tags: readonly string[];
  status: string;
  projectColor: string | null;
  edited: string;
  extra: readonly string[];
  yes: string;
  no: string;
  onOpenNote: (id: string) => void;
  onOpenNoteInNewTab?: (id: string) => void;
  onTag: (tag: string) => void;
  actionsFor?: (note: NoteItem) => NoteActions;
}

const NO_ACTIONS: NoteActions = {};

const TableRow = memo(function TableRow({
  note,
  index,
  icon,
  tags,
  status,
  projectColor,
  edited,
  extra,
  yes,
  no,
  onOpenNote,
  onOpenNoteInNewTab,
  onTag,
  actionsFor,
}: Readonly<TableRowProps>) {
  const { t } = useTranslation(["notes"]);
  const actions = actionsFor ? actionsFor(note) : NO_ACTIONS;
  const menus = useNoteMenus(note, actions);
  const withMenu = hasNoteMenu(actions);
  const row = (
    <tr
      {...{ [ROW_WINDOW_ITEM]: "" }}
      aria-rowindex={index}
      data-note-table-row={note.id}
      data-menu-open={menus.open ? "true" : "false"}
      className="group/row border-b border-foreground/[0.045] hover:bg-foreground/[0.025] data-[menu-open=true]:bg-foreground/[0.025]"
    >
      <td className="max-w-0 py-1.5 pl-1 pr-3">
        {menus.renaming ? (
          <span className="flex min-w-0 items-center gap-2 px-1 py-0.5">
            <NoteChip icon={icon} color={note.color} className="size-5 rounded" />
            <NoteRenameInput title={note.title} className="h-6 rounded-md px-1 py-0 font-medium" onDone={menus.finishRename} />
          </span>
        ) : (
          <button
            type="button"
            onClick={(event) => {
              if (isSelectionModifier(event) && onOpenNoteInNewTab) onOpenNoteInNewTab(note.id);
              else onOpenNote(note.id);
            }}
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-foreground/[0.045] focus-visible:bg-foreground/[0.06] motion-reduce:transition-none"
          >
            <NoteChip icon={icon} color={note.color} className="size-5 rounded" />
            <span className="truncate font-medium">{note.title}</span>
            {actions.conflict && <ConflictMark />}
          </button>
        )}
      </td>
      <td className="px-3 py-1.5">
        <span className="flex max-w-[16rem] gap-1 overflow-hidden">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onTag(tag)}
              aria-label={t(($) => $.notes.vault.tags.filter, { tag })}
              className="shrink-0 whitespace-nowrap rounded-full bg-foreground/[0.06] px-1.5 text-[0.6875rem]/5 text-muted-foreground transition-colors hover:bg-foreground/[0.1] hover:text-foreground focus-visible:bg-foreground/[0.1] motion-reduce:transition-none"
            >
              #{tag}
            </button>
          ))}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{status}</td>
      <td className="px-3 py-1.5 text-muted-foreground">
        {note.relatedProjectId && (
          <span className="flex min-w-0 items-center gap-1.5">
            <ProjectDot color={projectColor} />
            <span className="truncate">{note.project}</span>
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{edited}</td>
      {extra.map((key) => (
        <td key={key} className="max-w-[16rem] truncate px-3 py-1.5 text-muted-foreground">
          {formatValue(note.properties?.[key], yes, no)}
        </td>
      ))}
      <td className="relative">
        {withMenu && <RowCornerButtons favorite={actions.favorite} menus={menus} className="right-1 top-1/2 -translate-y-1/2" />}
      </td>
    </tr>
  );
  if (!withMenu) return row;
  return (
    <ContextMenu onOpenChange={menus.setContextOpen}>
      <ContextMenuTrigger asChild disabled={menus.renaming}>
        {row}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52" onCloseAutoFocus={menus.runPending}>
        {menus.items(CONTEXT_MENU_KIT)}
      </ContextMenuContent>
    </ContextMenu>
  );
});

function SpacerRow({ height, span }: Readonly<{ height: number; span: number }>) {
  return (
    <tr aria-hidden>
      <td colSpan={span} className="p-0" style={{ height }} />
    </tr>
  );
}

function HeaderCell({
  label,
  column,
  sort,
  className,
}: Readonly<{ label: string; column: string; sort: TableSort; className?: string }>) {
  const { t } = useTranslation(["notes"]);
  const active = sort.key === column;
  const Arrow = sort.descending ? ArrowDown : ArrowUp;
  let ariaSort: "ascending" | "descending" | "none" = "none";
  if (active) ariaSort = sort.descending ? "descending" : "ascending";
  return (
    <th scope="col" aria-sort={ariaSort} className={cn("h-[2.0625rem] px-3 text-left font-normal", className)}>
      <button
        type="button"
        aria-label={t(($) => $.notes.vault.table.sortBy, { name: label })}
        onClick={() => saveTableSort(nextSort(sort, column))}
        className={cn(
          "flex min-w-0 max-w-full items-center gap-1 rounded transition-colors hover:text-foreground focus-visible:text-foreground motion-reduce:transition-none",
          active && "font-semibold text-foreground",
        )}
      >
        <span className="truncate">{label}</span>
        {active && <Arrow aria-hidden className="size-3 shrink-0" />}
      </button>
    </th>
  );
}

export function NotesTable({
  notes,
  iconFor,
  tagsOf,
  projectColor,
  onOpenNote,
  onOpenNoteInNewTab,
  onTag = filterByTag,
  actionsFor,
  scrollRef,
}: Readonly<NotesTableProps>) {
  const { t } = useTranslation(["notes"]);
  const columns = useTableColumns();
  const storedSort = useTableSort();
  const availableKey = useMemo(() => JSON.stringify(propertyKeys(notes)), [notes]);
  const available = useMemo(() => JSON.parse(availableKey) as string[], [availableKey]);
  const extra = useMemo(() => columns.filter((key) => available.includes(key)), [available, columns]);
  const known = BASE_COLUMNS.includes(storedSort.key as BaseColumn) || extra.some((key) => storedSort.key === `${PROPERTY_PREFIX}${key}`);
  const sort = known ? storedSort : DEFAULT_TABLE_SORT;
  const rows = useMemo(() => sortTableRows(notes, sort, tagsOf), [notes, sort, tagsOf]);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const shown = useRowWindow({ count: rows.length, scrollRef, listRef: bodyRef, unmeasuredCount: TABLE_UNMEASURED_ROWS });
  const span = BASE_COLUMNS.length + extra.length + 1;
  const now = Date.now();
  const yes = t(($) => $.notes.vault.table.yes);
  const no = t(($) => $.notes.vault.table.no);
  const label = (column: BaseColumn) => t(($) => $.notes.vault.table.columns[column]);
  const toggleColumn = (key: string) =>
    saveTableColumns(columns.includes(key) ? columns.filter((candidate) => candidate !== key) : [...columns, key]);

  return (
    <div className="px-6 pb-8 pt-2.5">
      <div className="overflow-x-auto overflow-y-hidden">
        <table aria-rowcount={rows.length + 1} className="w-full min-w-[40rem] border-collapse text-[0.8125rem]/6">
          <thead className="text-muted-foreground">
            <tr aria-rowindex={1} className="border-b border-foreground/[0.045]">
              <HeaderCell label={label("title")} column="title" sort={sort} className="min-w-[12.5rem] pl-6" />
              <HeaderCell label={label("tags")} column="tags" sort={sort} />
              <HeaderCell label={label("status")} column="status" sort={sort} />
              <HeaderCell label={label("project")} column="project" sort={sort} />
              <HeaderCell label={label("edited")} column="edited" sort={sort} className="whitespace-nowrap" />
              {extra.map((key) => (
                <HeaderCell key={key} label={key} column={`${PROPERTY_PREFIX}${key}`} sort={sort} />
              ))}
              <th scope="col" className="w-16 px-1 text-right font-normal">
                <DropdownMenu>
                  <Tooltip label={t(($) => $.notes.vault.table.addColumn)} side="bottom">
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={t(($) => $.notes.vault.table.addColumn)}
                        className="ml-auto flex size-7 items-center justify-center rounded-md transition-colors hover:bg-foreground/[0.045] hover:text-foreground focus-visible:bg-foreground/[0.06] data-[state=open]:bg-foreground/[0.06] motion-reduce:transition-none"
                      >
                        <Columns3 aria-hidden className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                  </Tooltip>
                  <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
                    <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                      {t(($) => $.notes.vault.table.properties)}
                    </DropdownMenuLabel>
                    {available.length === 0 && (
                      <DropdownMenuItem disabled>{t(($) => $.notes.vault.table.noProperties)}</DropdownMenuItem>
                    )}
                    {available.map((key) => (
                      <DropdownMenuItem
                        key={key}
                        className="gap-2"
                        onSelect={(event) => {
                          event.preventDefault();
                          toggleColumn(key);
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">{key}</span>
                        {columns.includes(key) && <CheckBadge />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </th>
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {shown.paddingTop > 0 && <SpacerRow height={shown.paddingTop} span={span} />}
            {rows.slice(shown.start, shown.end).map((note, offset) => (
              <TableRow
                key={note.id}
                note={note}
                index={shown.start + offset + 2}
                icon={iconFor(note)}
                tags={tagsOf(note)}
                status={formatValue(note.properties?.status, yes, no)}
                projectColor={projectColor(note.relatedProjectId)}
                edited={formatRelativeTimeFrom(note.updatedAt, now, { dateAfterDays: 7 })}
                extra={extra}
                yes={yes}
                no={no}
                onOpenNote={onOpenNote}
                onOpenNoteInNewTab={onOpenNoteInNewTab}
                onTag={onTag}
                actionsFor={actionsFor}
              />
            ))}
            {shown.paddingBottom > 0 && <SpacerRow height={shown.paddingBottom} span={span} />}
          </tbody>
        </table>
      </div>
    </div>
  );
}
