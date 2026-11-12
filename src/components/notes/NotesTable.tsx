import { Columns3 } from "lucide-react";
import { memo, type RefObject, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckBadge } from "@/components/ui/check-badge";
import { ColorDot } from "@/components/ui/color-swatch";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  nextSort,
  SortableTableHead,
  type SortDirection,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSpacerRow,
} from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { ROW_WINDOW_ITEM, useRowWindow } from "@/hooks/use-row-window";
import { compareText, formatRelativeTimeFrom } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { isSelectionModifier } from "@/store/library-selection";
import { DEFAULT_TABLE_SORT, type TableSort, useNotesPrefsStore } from "@/store/notes-prefs";
import { RowCornerButtons, useNoteMenus } from "./NoteCard";
import { CONTEXT_MENU_KIT, ConflictMark, hasNoteMenu, type NoteActions, NoteRenameInput, SuggestionsMark } from "./note-actions";
import { NoteChip } from "./note-icons";
import { LIST_KEYS, MANAGED_KEYS } from "./note-properties";
import { tagTone } from "./note-tags";
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
  if (typeof value === "string") return value;
  return typeof value === "number" || typeof value === "bigint" ? String(value) : "";
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

const NoteTableRow = memo(function NoteTableRow({
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
    <TableRow
      {...{ [ROW_WINDOW_ITEM]: "" }}
      aria-rowindex={index}
      data-note-table-row={note.id}
      data-menu-open={menus.open ? "true" : "false"}
      className="group/row data-[menu-open=true]:bg-muted/40"
    >
      <TableCell className="max-w-0 py-1.5 pl-1">
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
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent motion-reduce:transition-none"
          >
            <NoteChip icon={icon} color={note.color} className="size-5 rounded" />
            <span className="truncate font-medium">{note.title}</span>
            {actions.conflict && <ConflictMark />}
            <SuggestionsMark noteId={note.id} />
          </button>
        )}
      </TableCell>
      <TableCell className="py-1.5">
        <span className="flex max-w-[16rem] gap-1 overflow-hidden">
          {tags.map((tag) => {
            const tone = tagTone(tag);
            return (
              <Badge key={tag} asChild variant="muted" size="sm" className={cn(tone.tint, tone.text, tone.hover)}>
                <button type="button" onClick={() => onTag(tag)} aria-label={t(($) => $.notes.vault.tags.filter, { tag })}>
                  #{tag}
                </button>
              </Badge>
            );
          })}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap py-1.5 text-muted-foreground">{status}</TableCell>
      <TableCell className="py-1.5 text-muted-foreground">
        {note.relatedProjectId && projectColor && (
          <span className="flex min-w-0 items-center gap-1.5">
            <ColorDot color={projectColor} size="xs" />
            <span className="truncate">{note.project}</span>
          </span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap py-1.5 text-muted-foreground">{edited}</TableCell>
      {extra.map((key) => (
        <TableCell key={key} className="max-w-[16rem] truncate py-1.5 text-muted-foreground">
          {formatValue(note.properties?.[key], yes, no)}
        </TableCell>
      ))}
      <TableCell className="relative p-0">
        {withMenu && <RowCornerButtons favorite={actions.favorite} menus={menus} className="right-1 top-1/2 -translate-y-1/2" />}
      </TableCell>
    </TableRow>
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

const DIRECTION: Record<"true" | "false", SortDirection> = { true: "descending", false: "ascending" };

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
  const columns = useNotesPrefsStore((state) => state.tableColumns);
  const storedSort = useNotesPrefsStore((state) => state.tableSort);
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
    useNotesPrefsStore.getState().set("tableColumns", columns.includes(key) ? columns.filter((candidate) => candidate !== key) : [...columns, key]);

  const sortState = { key: sort.key, direction: DIRECTION[String(sort.descending) as "true" | "false"] };
  const header = (column: string, name: string, className?: string) => (
    <SortableTableHead
      key={column}
      label={name}
      sortLabel={t(($) => $.notes.vault.table.sortBy, { name })}
      direction={sort.key === column ? sortState.direction : null}
      onSort={() => {
        const next = nextSort(sortState, column, column === "edited" ? "descending" : "ascending");
        useNotesPrefsStore.getState().set("tableSort", { key: next.key, descending: next.direction === "descending" });
      }}
      className={className}
    />
  );

  return (
    <div className="px-6 pb-8 pt-2.5">
      <Table aria-rowcount={rows.length + 1} className="min-w-[40rem]" containerClassName="overflow-y-hidden">
        <TableHeader className="static bg-transparent">
          <TableRow aria-rowindex={1} className="hover:bg-transparent">
            {header("title", label("title"), "min-w-[12.5rem] pl-6")}
            {header("tags", label("tags"))}
            {header("status", label("status"))}
            {header("project", label("project"))}
            {header("edited", label("edited"))}
            {extra.map((key) => header(`${PROPERTY_PREFIX}${key}`, key))}
            <TableHead className="w-16 px-1 text-right">
              <DropdownMenu>
                <Tooltip label={t(($) => $.notes.vault.table.addColumn)} side="bottom" className="ml-auto">
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={t(($) => $.notes.vault.table.addColumn)} className="size-7">
                      <Columns3 aria-hidden />
                    </Button>
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
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody ref={bodyRef}>
          {shown.paddingTop > 0 && <TableSpacerRow height={shown.paddingTop} span={span} />}
          {rows.slice(shown.start, shown.end).map((note, offset) => (
            <NoteTableRow
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
          {shown.paddingBottom > 0 && <TableSpacerRow height={shown.paddingBottom} span={span} />}
        </TableBody>
      </Table>
    </div>
  );
}
