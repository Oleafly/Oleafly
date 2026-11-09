import { ArrowDown, ArrowDownUp, NotebookPen, Plus, Search, Star } from "lucide-react";
import {
  type KeyboardEvent,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { LayoutToggle } from "@/components/library/LayoutToggle";
import { Button } from "@/components/ui/button";
import { CheckBadge } from "@/components/ui/check-badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { QuerySearch } from "@/components/ui/query-search";
import { Tooltip } from "@/components/ui/tooltip";
import { ROW_WINDOW_ITEM, useRowWindow } from "@/hooks/use-row-window";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { createdAt, homeNotes, type HomeTab } from "./home-notes";
import { type ListColumn, listColumn, NoteCard, NoteListRow } from "./NoteCard";
import { type NoteActions, useNoteActions } from "./note-actions";
import { useNoteFavorites } from "./note-favorites";
import {
  HOME_SORTS,
  type HomeSort,
  saveHomeLayout,
  saveHomeSort,
  useHomeLayout,
  useHomeSort,
  useNoteOpenedTimes,
} from "./note-home-prefs";
import { useVaultQuery, writeTagFilter } from "./note-query";
import { useNoteTagCounts, useVaultSearch } from "./note-search";
import { useNotesData } from "./notes-data";
import { NotesTable } from "./NotesTable";
import { type ProjectColorOf, useProjectColor } from "./project-color";
import type { NoteItem } from "./types";
import { useGridTracks } from "@/hooks/use-element-columns";

interface NotesHomeProps {
  iconFor: (note: NoteItem) => string | undefined;
  onOpenNote: (id: string) => void;
  onOpenNoteInNewTab?: (id: string) => void;
  onNewNote?: () => void;
}

const TABS: readonly HomeTab[] = ["mine", "favorites"];
const CHROME_FILL = "bg-foreground/[0.045]";
const SORT_COLUMNS: readonly (HomeSort & ListColumn)[] = ["edited", "created", "opened"];
const GRID_FALLBACK_COLUMNS = 3;
const GRID_OVERSCAN_ROWS = 2;
const GRID_UNMEASURED_ROWS = 4;
const LIST_UNMEASURED_ROWS = 16;
const NO_TAGS: readonly string[] = [];

type ResolveAsset = (noteId: string, path: string) => Promise<string | null>;

interface HomeItemProps {
  note: NoteItem;
  icon: string | undefined;
  projectColor: string | null;
  actionsFor: (note: NoteItem) => NoteActions;
  onOpenNote: (id: string) => void;
}

interface HomeItemsProps {
  notes: readonly NoteItem[];
  iconFor: (note: NoteItem) => string | undefined;
  colorOf: ProjectColorOf;
  actionsFor: (note: NoteItem) => NoteActions;
  onOpenNote: (id: string) => void;
  scrollRef: RefObject<HTMLElement | null>;
}

function HomeEmpty({ icon, text, children }: Readonly<{ icon: ReactNode; text: string; children?: ReactNode }>) {
  return (
    <div className="flex flex-col items-center px-6 pb-16 pt-24 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.045] text-muted-foreground">{icon}</span>
      <p className="mt-4 max-w-xs text-[0.8125rem]/5 text-muted-foreground">{text}</p>
      {children}
    </div>
  );
}

function SortHeader({
  label,
  active,
  onSort,
  className,
}: Readonly<{ label: string; active: boolean; onSort: () => void; className?: string }>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSort}
      className={cn(
        "flex min-w-0 items-center gap-1 rounded text-left transition-colors hover:text-foreground focus-visible:text-foreground",
        active && "font-semibold text-foreground",
        className,
      )}
    >
      <span className="truncate">{label}</span>
      {active && <ArrowDown aria-hidden className="size-3 shrink-0" />}
    </button>
  );
}

const HomeCard = memo(function HomeCard({
  note,
  icon,
  projectColor,
  actionsFor,
  onOpenNote,
  resolveAsset,
}: Readonly<HomeItemProps & { resolveAsset?: ResolveAsset }>) {
  return (
    <div {...{ [ROW_WINDOW_ITEM]: "" }} className="min-w-0 pb-4">
      <NoteCard
        note={note}
        icon={icon}
        actions={actionsFor(note)}
        projectColor={projectColor}
        resolveAsset={resolveAsset}
        onOpen={() => onOpenNote(note.id)}
      />
    </div>
  );
});

function HomeGrid({
  notes,
  iconFor,
  colorOf,
  actionsFor,
  onOpenNote,
  scrollRef,
  resolveAsset,
}: Readonly<HomeItemsProps & { resolveAsset?: ResolveAsset }>) {
  const gridRef = useRef<HTMLDivElement>(null);
  const columns = useGridTracks(gridRef, GRID_FALLBACK_COLUMNS);
  const rows = useRowWindow({
    count: Math.ceil(notes.length / columns),
    scrollRef,
    listRef: gridRef,
    overscan: GRID_OVERSCAN_ROWS,
    unmeasuredCount: GRID_UNMEASURED_ROWS,
  });
  const first = rows.start * columns;
  return (
    <div className="px-6 pb-4 pt-2.5">
      <div
        ref={gridRef}
        className="grid grid-cols-1 gap-x-4 @min-[24rem]:grid-cols-2 @min-[35rem]:grid-cols-3 @min-[56rem]:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))]"
        style={{ paddingTop: rows.paddingTop, paddingBottom: rows.paddingBottom }}
      >
        {notes.slice(first, rows.end * columns).map((note) => (
          <HomeCard
            key={note.id}
            note={note}
            icon={iconFor(note)}
            projectColor={colorOf(note.relatedProjectId)}
            actionsFor={actionsFor}
            onOpenNote={onOpenNote}
            resolveAsset={resolveAsset}
          />
        ))}
      </div>
    </div>
  );
}

const HomeListRow = memo(function HomeListRow({
  note,
  icon,
  projectColor,
  actionsFor,
  onOpenNote,
  sorted,
  edited,
  created,
  opened,
}: Readonly<HomeItemProps & { sorted: ListColumn | null; edited: string; created: string; opened: string | null }>) {
  return (
    <NoteListRow
      note={note}
      icon={icon}
      actions={actionsFor(note)}
      projectColor={projectColor}
      onOpen={() => onOpenNote(note.id)}
      sorted={sorted}
      when={{ edited, created, opened }}
    />
  );
});

function HomeList({
  notes,
  iconFor,
  colorOf,
  actionsFor,
  onOpenNote,
  scrollRef,
  header,
  sorted,
  opened,
  when,
}: Readonly<
  HomeItemsProps & {
    header: ReactNode;
    sorted: ListColumn | null;
    opened: Readonly<Record<string, number>>;
    when: (timestamp: number) => string;
  }
>) {
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useRowWindow({ count: notes.length, scrollRef, listRef, unmeasuredCount: LIST_UNMEASURED_ROWS });
  return (
    <div className="px-6 pb-8 pt-2.5">
      {header}
      <div ref={listRef} style={{ paddingTop: rows.paddingTop, paddingBottom: rows.paddingBottom }}>
        {notes.slice(rows.start, rows.end).map((note) => (
          <HomeListRow
            key={note.id}
            note={note}
            icon={iconFor(note)}
            projectColor={colorOf(note.relatedProjectId)}
            actionsFor={actionsFor}
            onOpenNote={onOpenNote}
            sorted={sorted}
            edited={when(note.updatedAt)}
            created={when(createdAt(note))}
            opened={opened[note.id] === undefined ? null : when(opened[note.id])}
          />
        ))}
      </div>
    </div>
  );
}

export function NotesHome({ iconFor, onOpenNote, onOpenNoteInNewTab, onNewNote }: Readonly<NotesHomeProps>) {
  const { t } = useTranslation(["notes"]);
  const data = useNotesData();
  const favorites = useNoteFavorites();
  const opened = useNoteOpenedTimes();
  const sort = useHomeSort();
  const layout = useHomeLayout();
  const colorOf = useProjectColor();
  const latest = useRef({ onOpenNote, onOpenInNewTab: onOpenNoteInNewTab ?? onOpenNote });
  useLayoutEffect(() => {
    latest.current = { onOpenNote, onOpenInNewTab: onOpenNoteInNewTab ?? onOpenNote };
  });
  const openNote = useCallback((id: string) => latest.current.onOpenNote(id), []);
  const openInNewTab = useCallback((id: string) => latest.current.onOpenInNewTab(id), []);
  const newTab = onOpenNoteInNewTab ? openInNewTab : undefined;
  const { actionsFor, dialog } = useNoteActions(newTab);
  const tagCounts = useNoteTagCounts();
  const tagsById = useMemo(() => {
    const byId = new Map<string, string[]>();
    for (const entry of tagCounts ?? []) {
      for (const id of entry.notes) byId.set(id, [...(byId.get(id) ?? []), entry.label]);
    }
    return byId;
  }, [tagCounts]);
  const tagsOf = useMemo(
    () => (note: NoteItem) => (tagCounts ? (tagsById.get(note.id) ?? NO_TAGS) : (note.tags ?? NO_TAGS)),
    [tagCounts, tagsById],
  );
  const [tab, setTab] = useState<HomeTab>("mine");
  const [search, setSearch] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const vault = useVaultQuery(search, tagCounts);
  const fullText = useVaultSearch(vault.plan, data.searchNotes !== undefined && vault.plan.fullText);
  const matches = useMemo(() => (fullText.hits ? new Set(fullText.hits.map((hit) => hit.id)) : null), [fullText.hits]);
  const test = vault.plan.test;
  const shown = useMemo(
    () => homeNotes(data.notes, { tab, favorites, sort, opened, test, matches }),
    [data.notes, favorites, matches, opened, sort, tab, test],
  );
  const typed = useRef({ search, query: vault.query });
  useLayoutEffect(() => {
    typed.current = { search, query: vault.query };
  });
  const filterTag = useCallback((tag: string) => {
    const { search: current, query } = typed.current;
    setSearch(writeTagFilter(current, query, tag));
  }, []);
  const clearOnEscape = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && search !== "") {
      event.stopPropagation();
      setSearch("");
    }
  };

  const sorted = sort === "title" ? null : sort;
  const now = Date.now();
  const when = (timestamp: number) => formatRelativeTimeFrom(timestamp, now, { dateAfterDays: 7 });
  const sortLabel = (value: HomeSort) => t(($) => $.notes.home.sort[value]);
  const chooseSort = (value: HomeSort) => {
    saveHomeSort(value);
    scroller.current?.scrollTo({ top: 0 });
  };

  const empty = () => {
    if (search.trim() !== "") {
      return <HomeEmpty icon={<Search aria-hidden className="size-6" />} text={t(($) => $.notes.home.noMatches, { query: search.trim() })} />;
    }
    if (tab === "favorites") return <HomeEmpty icon={<Star aria-hidden className="size-6" />} text={t(($) => $.notes.home.noFavorites)} />;
    return (
      <HomeEmpty icon={<NotebookPen aria-hidden className="size-6" />} text={t(($) => $.notes.home.empty)}>
        {onNewNote && (
          <Button size="sm" className="mt-5" onClick={onNewNote}>
            <Plus aria-hidden />
            {t(($) => $.notes.library.newNote)}
          </Button>
        )}
      </HomeEmpty>
    );
  };

  const listHeader = (
    <div className="flex h-[2.0625rem] items-center border-b border-foreground/[0.045] text-[0.8125rem]/6 text-muted-foreground">
      <div className="flex min-w-[12.5rem] flex-[3_1_0%] pl-6 pr-3">
        <SortHeader label={sortLabel("title")} active={sort === "title"} onSort={() => chooseSort("title")} />
      </div>
      <div className={listColumn("project", sorted)}>{t(($) => $.notes.workspace.project)}</div>
      <div className={listColumn("author", sorted)}>{t(($) => $.notes.home.author)}</div>
      {SORT_COLUMNS.map((value) => (
        <div key={value} className={listColumn(value, sorted)}>
          <SortHeader label={sortLabel(value)} active={sort === value} onSort={() => chooseSort(value)} />
        </div>
      ))}
      <div className="w-[3.75rem] shrink-0" />
    </div>
  );

  const content = () => {
    if (shown.length === 0) return empty();
    if (layout === "table") {
      return (
        <NotesTable
          notes={shown}
          iconFor={iconFor}
          tagsOf={tagsOf}
          projectColor={colorOf}
          onOpenNote={openNote}
          onOpenNoteInNewTab={newTab}
          onTag={filterTag}
          actionsFor={actionsFor}
          scrollRef={scroller}
        />
      );
    }
    const items = { notes: shown, iconFor, colorOf, actionsFor, onOpenNote: openNote, scrollRef: scroller };
    if (layout === "grid") return <HomeGrid {...items} resolveAsset={data.resolveAsset} />;
    return <HomeList {...items} header={listHeader} sorted={sorted} opened={opened} when={when} />;
  };

  return (
    <div ref={scroller} className="@container min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="sticky top-0 z-10 bg-background pb-0.5">
        <header className="relative flex h-12 items-center gap-3 px-[1.625rem]">
          <h2 className="shrink-0 text-[1.0625rem]/6 font-semibold">{t(($) => $.notes.home.title)}</h2>
          <QuerySearch
            value={search}
            onChange={setSearch}
            query={vault.query}
            schema={vault.schema}
            ariaLabel={t(($) => $.notes.home.search)}
            placeholder={t(($) => $.notes.home.search)}
            clearLabel={t(($) => $.notes.vault.search.clear)}
            onKeyDown={clearOnEscape}
            className={cn(
              "h-8 max-w-[22.5rem] flex-1 cursor-text rounded-[0.5625rem] border-transparent text-muted-foreground transition-colors hover:bg-foreground/[0.06] has-[input:focus-visible]:bg-foreground/[0.07] motion-reduce:transition-none @min-[36rem]:absolute @min-[36rem]:left-1/2 @min-[36rem]:top-2 @min-[36rem]:w-[22.5rem] @min-[36rem]:flex-none @min-[36rem]:-translate-x-1/2",
              CHROME_FILL,
            )}
          />
          <Tooltip label={t(($) => $.notes.library.newNote)} side="bottom" className="ml-auto" relative={false}>
            <button
              type="button"
              aria-label={t(($) => $.notes.library.newNote)}
              disabled={!onNewNote}
              onClick={onNewNote}
              className="-mr-[1.125rem] flex size-8 items-center justify-center rounded-lg text-foreground/60 transition-colors hover:bg-foreground/[0.045] focus-visible:bg-foreground/[0.06] active:bg-foreground/[0.09] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
            >
              <Plus aria-hidden className="size-[1.125rem]" />
            </button>
          </Tooltip>
        </header>
        <div className="mt-3 flex min-h-7 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6">
          <fieldset aria-label={t(($) => $.notes.home.tabs.label)} className="flex min-w-0 items-center gap-2">
            {TABS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "h-7 shrink-0 rounded-[0.5625rem] px-2.5 text-[0.8125rem]/5 transition-colors motion-reduce:transition-none",
                  tab === value
                    ? "bg-foreground/[0.06] text-foreground"
                    : "text-muted-foreground hover:bg-foreground/[0.045] focus-visible:bg-foreground/[0.045]",
                )}
              >
                {t(($) => $.notes.home.tabs[value])}
              </button>
            ))}
          </fieldset>
          <div className="ml-auto flex shrink-0 items-center gap-4">
            {layout !== "table" && (
              <DropdownMenu>
                <Tooltip label={t(($) => $.notes.home.sortBy)} side="bottom">
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[0.8125rem] text-muted-foreground transition-colors hover:bg-foreground/[0.045] focus-visible:bg-foreground/[0.045] data-[state=open]:bg-foreground/[0.06] motion-reduce:transition-none"
                    >
                      <ArrowDownUp aria-hidden className="size-3.5 shrink-0" />
                      <span className="@max-[32rem]:sr-only">{sortLabel(sort)}</span>
                    </button>
                  </DropdownMenuTrigger>
                </Tooltip>
                <DropdownMenuContent align="end" sideOffset={4} className="w-[12.5rem]">
                  {HOME_SORTS.map((value) => (
                    <DropdownMenuItem key={value} className="gap-2" onSelect={() => chooseSort(value)}>
                      <span className="min-w-0 flex-1 truncate">{sortLabel(value)}</span>
                      {sort === value && <CheckBadge />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <LayoutToggle
              value={layout}
              onChange={saveHomeLayout}
              groupLabel={t(($) => $.notes.home.layout)}
              tableLabel={t(($) => $.notes.vault.table.view)}
              size="sm"
              className="gap-0.5 rounded-[0.5625rem] border border-foreground/[0.075] bg-background p-px shadow-[0_1px_1.5px_rgb(0_0_0/0.05)] dark:bg-foreground/[0.06]"
            />
          </div>
        </div>
      </div>
      {content()}
      {dialog}
    </div>
  );
}
