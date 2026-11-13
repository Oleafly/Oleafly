import { ArrowDown, ArrowDownUp, BookmarkX, Plus, SearchX } from "lucide-react";
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
import { HOME_CHROME_SURFACE } from "@/components/library/home-chrome";
import { LayoutToggle } from "@/components/library/LayoutToggle";
import { Button } from "@/components/ui/button";
import { CheckBadge } from "@/components/ui/check-badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyMedia, EmptyState } from "@/components/ui/empty";
import { QuerySearch } from "@/components/ui/query-search";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { RingsPattern } from "@/components/ui/rings-pattern";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { ROW_WINDOW_ITEM, useRowWindow } from "@/hooks/use-row-window";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { createdAt, HOME_TABS, homeNotes, type HomeTab } from "./home-notes";
import { type ListColumn, listColumn, NoteCard, NoteListRow } from "./NoteCard";
import { type NoteActions, useNoteActions } from "./note-actions";
import { type ProjectColorOf, useProjectColor } from "./project-color";
import { useVaultQuery, writeTagFilter } from "./note-query";
import { useNoteTagCounts, useVaultSearch } from "./note-search";
import { useNotesData } from "./notes-data";
import { NotesAttachments } from "./NotesAttachments";
import { NotesTable } from "./NotesTable";
import { NotesTasks } from "./NotesTasks";
import { NotesStart } from "./NotesStart";
import type { NoteItem } from "./types";
import { useGridTracks } from "@/hooks/use-element-columns";
import { HOME_SORTS, type HomeSort, TASK_SORTS, type TaskSort, useNoteFavorites, useNotesPrefsStore } from "@/store/notes-prefs";

interface NotesHomeProps {
  iconFor: (note: NoteItem) => string | undefined;
  onOpenNote: (id: string) => void;
  onOpenNoteInNewTab?: (id: string) => void;
  onNewNote?: () => void;
  onImport?: () => void;
  tab?: HomeTab;
  onTabChange?: (tab: HomeTab) => void;
}

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

function HomeEmpty({ icon, text }: Readonly<{ icon: ReactNode; text: string }>) {
  return <EmptyState icon={<EmptyMedia variant="icon">{icon}</EmptyMedia>} description={text} className="px-6 pb-16 pt-24" />;
}

function SortHeader({ label, active, onSort }: Readonly<{ label: string; active: boolean; onSort: () => void }>) {
  return (
    <Button variant="ghost" size="xs" aria-pressed={active} onClick={onSort} className={cn("-mx-2 min-w-0", active && "text-foreground")}>
      <span className="truncate">{label}</span>
      {active && <ArrowDown aria-hidden />}
    </Button>
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

export function NotesHome({ iconFor, onOpenNote, onOpenNoteInNewTab, onNewNote, onImport, tab: shownTab, onTabChange }: Readonly<NotesHomeProps>) {
  const { t } = useTranslation(["notes"]);
  const data = useNotesData();
  const favorites = useNoteFavorites();
  const opened = useNotesPrefsStore((state) => state.opened);
  const sort = useNotesPrefsStore((state) => state.homeSort);
  const layout = useNotesPrefsStore((state) => state.homeLayout);
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
  const [ownTab, setOwnTab] = useState<HomeTab>("mine");
  const tab = shownTab ?? ownTab;
  const setTab = onTabChange ?? setOwnTab;
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
  const taskSort = useNotesPrefsStore((state) => state.tasks.sort);
  const chooseTaskSort = (value: TaskSort) => {
    const store = useNotesPrefsStore.getState();
    store.set("tasks", { ...store.tasks, sort: value });
    scroller.current?.scrollTo({ top: 0 });
  };
  const chooseSort = (value: HomeSort) => {
    useNotesPrefsStore.getState().set("homeSort", value);
    scroller.current?.scrollTo({ top: 0 });
  };

  const empty = () => {
    if (search.trim() !== "") {
      return <HomeEmpty icon={<SearchX aria-hidden className="size-6" />} text={t(($) => $.notes.home.noMatches, { query: search.trim() })} />;
    }
    if (tab === "favorites") return <HomeEmpty icon={<BookmarkX aria-hidden className="size-6" />} text={t(($) => $.notes.home.noFavorites)} />;
    return (
      <div className="relative flex min-h-full justify-center px-6 pb-16 pt-12">
        <RingsPattern />
        <NotesStart hasNotes={false} onNewNote={onNewNote} onOpenNote={openNote} onImport={onImport} className="relative max-w-[40rem]" />
      </div>
    );
  };

  const listHeader = (
    <div className="flex h-[2.0625rem] items-center border-b border-border text-muted-foreground">
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

  const listsNotes = tab === "mine" || tab === "favorites";
  const content = () => {
    if (tab === "tasks") return <NotesTasks search={search} scrollRef={scroller} iconFor={iconFor} onOpenNote={openNote} />;
    if (tab === "attachments") return <NotesAttachments search={search} scrollRef={scroller} iconFor={iconFor} onOpenNote={openNote} />;
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
    <Tabs value={tab} onValueChange={(value) => setTab(value as HomeTab)} asChild>
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
                HOME_CHROME_SURFACE,
                "h-8 max-w-[22.5rem] flex-1 cursor-text rounded-lg @min-[36rem]:absolute @min-[36rem]:left-1/2 @min-[36rem]:top-2 @min-[36rem]:w-[22.5rem] @min-[36rem]:flex-none @min-[36rem]:-translate-x-1/2",
              )}
            />
            <span className="ml-auto -mr-[1.125rem]">
              <TooltipIconButton label={t(($) => $.notes.library.newNote)} disabled={!onNewNote} onClick={onNewNote} className="size-8">
                <Plus aria-hidden />
              </TooltipIconButton>
            </span>
          </header>
          <div className="mt-3 flex min-h-7 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6">
            <TabsList aria-label={t(($) => $.notes.home.tabs.label)}>
              {HOME_TABS.map((value) => (
                <TabsTrigger key={value} value={value}>
                  {t(($) => $.notes.home.tabs[value])}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="ml-auto flex shrink-0 items-center gap-4">
              {tab === "tasks" && (
                <DropdownMenu>
                  <Tooltip label={t(($) => $.notes.tasks.sort.label)} side="bottom">
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="gap-1.5 px-2 font-normal text-muted-foreground data-[state=open]:bg-accent">
                        <ArrowDownUp aria-hidden />
                        <span className="@max-[32rem]:sr-only">{t(($) => $.notes.tasks.sort[taskSort])}</span>
                      </Button>
                    </DropdownMenuTrigger>
                  </Tooltip>
                  <DropdownMenuContent align="end" sideOffset={4} className="w-[12.5rem]">
                    {TASK_SORTS.map((value) => (
                      <DropdownMenuItem key={value} className="gap-2" onSelect={() => chooseTaskSort(value)}>
                        <span className="min-w-0 flex-1 truncate">{t(($) => $.notes.tasks.sort[value])}</span>
                        {taskSort === value && <CheckBadge />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {listsNotes && layout !== "table" && (
                <DropdownMenu>
                  <Tooltip label={t(($) => $.notes.home.sortBy)} side="bottom">
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="gap-1.5 px-2 font-normal text-muted-foreground data-[state=open]:bg-accent">
                        <ArrowDownUp aria-hidden />
                        <span className="@max-[32rem]:sr-only">{sortLabel(sort)}</span>
                      </Button>
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
              {listsNotes && (
                <LayoutToggle
                  value={layout}
                  onChange={(value) => useNotesPrefsStore.getState().set("homeLayout", value)}
                  groupLabel={t(($) => $.notes.home.layout)}
                  tableLabel={t(($) => $.notes.vault.table.view)}
                  size="sm"
                  className={cn(HOME_CHROME_SURFACE, "gap-0.5 rounded-lg p-px")}
                />
              )}
            </div>
          </div>
        </div>
        <TabsContent value={tab}>{content()}</TabsContent>
        {dialog}
      </div>
    </Tabs>
  );
}
