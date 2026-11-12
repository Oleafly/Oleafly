import { CalendarDays, FileInput, LayoutTemplate, Plus, Search } from "lucide-react";
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { analyze, clearQualifiers, readFacet, writeFacet, type Facet, type FacetState } from "@oleafly/search-query";
import { isImeEnter } from "@/components/ai/composer/ime";
import { HomeBrandButton } from "@/components/layout/HomeBrandButton";
import { SidebarSection } from "@/components/layout/SidebarSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ColorDot } from "@/components/ui/color-swatch";
import { Kbd } from "@/components/ui/kbd";
import { MenuRow } from "@/components/ui/menu-row";
import { QuerySearch } from "@/components/ui/query-search";
import { SectionHeading } from "@/components/ui/section-heading";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { useNow } from "@/hooks/use-now";
import { ROW_WINDOW_ITEM, useRowWindow } from "@/hooks/use-row-window";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { shortcutLabel, type ShortcutId, useShortcutStore } from "@/store/shortcuts";
import { useFullscreen } from "@/lib/use-fullscreen";
import { cn, isMac } from "@/lib/utils";
import { isSelectionModifier } from "@/store/library-selection";
import {
  CONTEXT_MENU_KIT,
  ConflictMark,
  SuggestionsMark,
  DROPDOWN_MENU_KIT,
  hasNoteMenu,
  type MenuKit,
  type NoteActions,
  NoteMenuItems,
  NoteRenameInput,
  useNoteActions,
} from "./note-actions";
import { Byline, KIND_TONES, KindChip, NoteChip } from "./note-icons";
import {
  activeFilterCount,
  localHit,
  selectedTag,
  useVaultQuery,
  VAULT_AUTHORS,
  VAULT_FACETS,
  VAULT_KINDS,
  type VaultKind,
  writeTagFilter,
} from "./note-query";
import { SearchModeMenu } from "@/components/ui/search-mode-menu";
import { useSearchModeStore } from "@/store/search-modes";
import type { SearchMode } from "@/lib/search-modes";
import { invalidPattern } from "@/lib/text-search-query";
import { blockFragment, textFragment } from "./note-block-ids";
import { SEARCH_LIMIT, tagTree, useNoteTagCounts, useVaultSearch, type NoteSearchState, type TagNode } from "./note-search";
import { SharedMark } from "./NoteShareButton";
import { NotesCalendar } from "./NotesCalendar";
import { useNotesData } from "./notes-data";
import { NoteListItem, NoteRowMenu } from "./NoteListItem";
import { useProjectColor } from "./project-color";
import { TemplatePicker } from "./TemplatePicker";
import type { ArtifactItem, Author, NoteItem } from "./types";
import { focusNotesSearch, setQuickSwitcherOpen, useVaultStore } from "./vault-store";
import { optionId, SearchResultList, type SearchRow, ShortcutButton, TagChip, TagPane, VaultFooter } from "./vault-sidebar";

type KindFilter = "all" | VaultKind;
type AuthorFilter = "all" | Author;

const KIND_FILTERS: readonly KindFilter[] = ["all", ...VAULT_KINDS];
const AUTHOR_FILTERS: readonly AuthorFilter[] = ["all", ...VAULT_AUTHORS];
const ALL_FILTER = "all";
const CUSTOM_FILTER = "custom";

const MINUTE_MS = 60_000;
const TAG_SEARCH = /(?:^|\s)tag:/u;

const BLOCKS_SHOWN = 5;
const TAG_BLOCK_LIMIT = 200;
const NO_EXPANDED: ReadonlySet<string> = new Set();

const CHIP_LIST = "m-0 flex min-w-0 flex-wrap justify-start gap-1 border-0 p-0";

interface ProjectGroup {
  projectId?: string;
  notes: NoteItem[];
  artifacts: ArtifactItem[];
}

interface NotesLibraryProps {
  iconFor: (note: NoteItem) => string | undefined;
  activeNoteId: string | null;
  activeArtifactId: string | null;
  homeLabel?: string;
  onHome: () => void;
  onNewNote?: () => void;
  onOpenNote: (id: string) => void;
  onOpenNoteInNewTab?: (id: string) => void;
  onOpenNoteAt?: (id: string, fragment: string) => void;
  onOpenArtifact: (artifact: ArtifactItem) => void;
  onToday?: () => void;
  onOpenGraph?: () => void;
  onImportFolder?: () => void;
  onExportFolder?: () => void;
  onOpenDeadLinks?: () => void;
}

function bylineFor(item: { author: Author; agent?: string; updatedAt: number; shared?: boolean }, now: number) {
  return (
    <Byline
      author={item.author}
      agent={item.agent}
      shared={item.shared}
      when={formatRelativeTimeFrom(item.updatedAt, now, { dateAfterDays: 7 })}
    />
  );
}

const NoteRow = memo(function NoteRow({
  note,
  active,
  now,
  iconFor,
  actionsFor,
  onOpenNote,
}: Readonly<{
  note: NoteItem;
  active: boolean;
  now: number;
  iconFor: (note: NoteItem) => string | undefined;
  actionsFor: (note: NoteItem) => NoteActions;
  onOpenNote: (id: string) => void;
}>) {
  const { t } = useTranslation(["notes"]);
  const [renaming, setRenaming] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const actions = actionsFor(note);
  const icon = <NoteChip icon={iconFor(note)} color={note.color} />;
  const badge = (
    <>
      {note.shared && <SharedMark />}
      {actions.conflict && <ConflictMark />}
      <SuggestionsMark noteId={note.id} />
    </>
  );
  const row = (trailing?: ReactNode) => (
    <NoteListItem
      active={active}
      aria-current={active ? "page" : undefined}
      icon={icon}
      title={note.title}
      meta={bylineFor(note, now)}
      badge={badge}
      trailing={trailing}
      onClick={() => onOpenNote(note.id)}
    />
  );
  if (!hasNoteMenu(actions)) {
    return (
      <div {...{ [ROW_WINDOW_ITEM]: "" }} data-note-row={note.id}>
        {row()}
      </div>
    );
  }

  const afterClose = (action: () => void) => () => {
    pending.current = action;
  };
  const runPending = () => {
    const action = pending.current;
    pending.current = null;
    action?.();
  };
  const finishRename = (next: string | null) => {
    setRenaming(false);
    const title = next?.trim();
    if (title && title !== note.title) actions.rename?.(title);
  };
  const items = (kit: MenuKit) => (
    <NoteMenuItems
      note={note}
      kit={kit}
      actions={actions}
      onRename={afterClose(() => setRenaming(true))}
      onDelete={afterClose(() => actions.remove?.())}
    />
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={renaming}>
        <div {...{ [ROW_WINDOW_ITEM]: "" }} data-note-row={note.id}>
          {renaming ? (
            <div className="flex items-center gap-2.5 rounded-md bg-accent px-2 py-1">
              {icon}
              <NoteRenameInput title={note.title} className="h-7 px-2 py-0 text-sm" onDone={finishRename} />
            </div>
          ) : (
            row(
              <NoteRowMenu label={t(($) => $.notes.library.menu.more)} onCloseAutoFocus={runPending}>
                {items(DROPDOWN_MENU_KIT)}
              </NoteRowMenu>,
            )
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52" onCloseAutoFocus={runPending}>
        {items(CONTEXT_MENU_KIT)}
      </ContextMenuContent>
    </ContextMenu>
  );
});

const ArtifactRow = memo(function ArtifactRow({
  artifact,
  active,
  now,
  onOpenArtifact,
}: Readonly<{ artifact: ArtifactItem; active: boolean; now: number; onOpenArtifact: (artifact: ArtifactItem) => void }>) {
  return (
    <div {...{ [ROW_WINDOW_ITEM]: "" }}>
      <NoteListItem
        active={active}
        aria-current={active ? "page" : undefined}
        icon={<KindChip kind={artifact.kind} />}
        title={artifact.title}
        meta={bylineFor({ author: "agent", agent: artifact.agent, updatedAt: artifact.updatedAt }, now)}
        onClick={() => onOpenArtifact(artifact)}
      />
    </div>
  );
});

type GroupEntry = { kind: "note"; note: NoteItem } | { kind: "artifact"; artifact: ArtifactItem };

function LibraryGroup({
  project,
  group,
  scrollRef,
  activeNoteId,
  activeArtifactId,
  now,
  iconFor,
  actionsFor,
  onOpenNote,
  onOpenArtifact,
  onOpenChange,
}: Readonly<{
  project: string;
  group: ProjectGroup;
  scrollRef: RefObject<HTMLDivElement | null>;
  activeNoteId: string | null;
  activeArtifactId: string | null;
  now: number;
  iconFor: (note: NoteItem) => string | undefined;
  actionsFor: (note: NoteItem) => NoteActions;
  onOpenNote: (id: string) => void;
  onOpenArtifact: (artifact: ArtifactItem) => void;
  onOpenChange: (key: string, open: boolean) => void;
}>) {
  const colorOf = useProjectColor();
  const id = useId();
  const key = group.projectId ?? project;
  const open = useNotesPrefsStore((state) => !state.closedGroups.includes(key));
  const entries = useMemo<GroupEntry[]>(
    () => [
      ...group.notes.map((note) => ({ kind: "note" as const, note })),
      ...group.artifacts.map((artifact) => ({ kind: "artifact" as const, artifact })),
    ],
    [group],
  );
  return (
    <SidebarSection
      id={`notes-group${id}`}
      title={project}
      headingLevel="h2"
      icon={<ColorDot color={colorOf(group.projectId) ?? "transparent"} size="xs" />}
      count={entries.length}
      open={open}
      onOpenChange={(next) => onOpenChange(key, next)}
      className="border-b-0"
    >
      <GroupRows
        entries={entries}
        scrollRef={scrollRef}
        render={(entry) =>
          entry.kind === "note" ? (
            <NoteRow
              key={entry.note.id}
              note={entry.note}
              active={activeNoteId === entry.note.id && activeArtifactId === null}
              now={now}
              iconFor={iconFor}
              actionsFor={actionsFor}
              onOpenNote={onOpenNote}
            />
          ) : (
            <ArtifactRow
              key={entry.artifact.id}
              artifact={entry.artifact}
              active={activeArtifactId === entry.artifact.id}
              now={now}
              onOpenArtifact={onOpenArtifact}
            />
          )
        }
      />
    </SidebarSection>
  );
}

function GroupRows({
  entries,
  scrollRef,
  render,
}: Readonly<{
  entries: readonly GroupEntry[];
  scrollRef: RefObject<HTMLDivElement | null>;
  render: (entry: GroupEntry) => ReactNode;
}>) {
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useRowWindow({ count: entries.length, scrollRef, listRef });
  return (
    <div ref={listRef} style={{ paddingTop: rows.paddingTop, paddingBottom: rows.paddingBottom }}>
      {entries.slice(rows.start, rows.end).map(render)}
    </div>
  );
}

function facetValue(state: FacetState): string {
  if (state.kind === "option") return state.id;
  return state.kind === "custom" ? CUSTOM_FILTER : ALL_FILTER;
}

function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
  render,
}: Readonly<{
  label: string;
  options: readonly T[];
  value: string;
  onChange: (value: T) => void;
  render: (option: T) => ReactNode;
}>) {
  return (
    <fieldset aria-label={label} className={CHIP_LIST}>
      {options.map((option) => (
        <Badge
          key={option}
          asChild
          variant={value === option ? "primaryGhost" : "outline"}
          size="sm"
          className="gap-1 transition-colors hover:bg-accent focus-visible:bg-accent motion-reduce:transition-none aria-pressed:hover:bg-primary/15"
        >
          <button type="button" aria-pressed={value === option} onClick={() => onChange(option)}>
            {render(option)}
          </button>
        </Badge>
      ))}
    </fieldset>
  );
}

function SearchTrailing({ canSearch, query, mode }: Readonly<{ canSearch: boolean; query: string; mode: SearchMode }>) {
  const { t } = useTranslation(["shell"]);
  return (
    <>
      {canSearch && (query.trim() !== "" || mode !== "ranked") && (
        <SearchModeMenu value={mode} onChange={(next) => useSearchModeStore.getState().setMode("notes", next)} />
      )}
      <Kbd className={cn("mr-1", query !== "" && "hidden @min-[15rem]:inline-flex")}>{t(($) => $.shell.keys.esc)}</Kbd>
    </>
  );
}

function SearchNoResults({ search, query }: Readonly<{ search: NoteSearchState; query: string }>) {
  const { t } = useTranslation(["notes", "common"]);
  if (search.pending || search.hits === null) {
    return <LoadingState size="compact" className="px-2 py-3" label={t(($) => $.notes.vault.search.searching)} />;
  }
  const invalid = invalidPattern(search.error ?? null);
  return (
    <output className="block px-2 py-3">
      <EmptyState
        size="compact"
        className="items-start"
        description={
          invalid
            ? t(($) => $.common.searchModes.invalid, { error: invalid })
            : t(($) => $.notes.vault.search.noResults, { query: query.trim() })
        }
      />
    </output>
  );
}

function StartRow({ icon, label, shortcut, onClick }: Readonly<{ icon: ReactNode; label: string; shortcut?: ShortcutId; onClick: () => void }>) {
  const keys = useShortcutStore((state) => (shortcut ? shortcutLabel(state.bindings[shortcut]) : ""));
  return (
    <MenuRow
      icon={icon}
      className="[&_svg]:size-4"
      label={
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate">{label}</span>
          {keys && <Kbd aria-hidden>{keys}</Kbd>}
        </span>
      }
      onClick={onClick}
    />
  );
}

type StartActions = Readonly<{ onNewNote?: () => void; onToday?: () => void; onTemplates?: () => void; onImportFolder?: () => void }>;

function LibraryStart({ onNewNote, onToday, onTemplates, onImportFolder }: StartActions) {
  const { t } = useTranslation(["notes"]);
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-library-start className="flex flex-col gap-1 px-1 py-2">
      <SectionHeading id={headingId} className="px-2 pb-1">
        {t(($) => $.notes.library.start.title)}
      </SectionHeading>
      {onNewNote && <StartRow icon={<Plus aria-hidden />} label={t(($) => $.notes.library.newNote)} shortcut="notesNewNote" onClick={onNewNote} />}
      {onToday && <StartRow icon={<CalendarDays aria-hidden />} label={t(($) => $.notes.vault.daily.open)} shortcut="notesTodayNote" onClick={onToday} />}
      {onTemplates && <StartRow icon={<LayoutTemplate aria-hidden />} label={t(($) => $.notes.vault.templates.open)} onClick={onTemplates} />}
      {onImportFolder && <StartRow icon={<FileInput aria-hidden />} label={t(($) => $.notes.vault.import.menu)} onClick={onImportFolder} />}
    </section>
  );
}

interface EmptyProps {
  kind: VaultKind | null;
  activeFilters: number;
  filtersOpen: boolean;
  onClearFilters: () => void;
}

function LibraryEmpty({ kind, activeFilters, filtersOpen, onClearFilters }: Readonly<EmptyProps>) {
  const { t } = useTranslation(["notes"]);
  const emptyText = kind === null ? t(($) => $.notes.library.empty) : t(($) => $.notes.library.emptyKind[kind]);
  return (
    <EmptyState size="compact" className="items-start gap-2 px-2 py-3 text-left" description={emptyText}>
      {activeFilters > 0 && !filtersOpen && (
        <Button variant="outline" size="xs" onClick={onClearFilters}>
          {t(($) => $.notes.library.filters.clear)}
        </Button>
      )}
    </EmptyState>
  );
}

function LibraryNoRows({
  searching,
  search,
  query,
  hasItems,
  start,
  ...empty
}: Readonly<EmptyProps & { searching: boolean; search: NoteSearchState; query: string; hasItems: boolean; start: StartActions }>) {
  if (searching) return <SearchNoResults search={search} query={query} />;
  if (!hasItems) return <LibraryStart {...start} />;
  return <LibraryEmpty {...empty} />;
}

function LibraryFilters({
  tree,
  tag,
  onSelectTag,
  research,
  kindFacet,
  authorFacet,
  onFacet,
  activeFilters,
  onClearFilters,
  open,
}: Readonly<{
  tree: readonly TagNode[] | null;
  tag: string | null;
  onSelectTag: (tag: string | null) => void;
  research: boolean;
  kindFacet: FacetState;
  authorFacet: FacetState;
  onFacet: (facet: Facet, value: string) => void;
  activeFilters: number;
  onClearFilters: () => void;
  open: boolean;
}>) {
  const { t } = useTranslation(["notes"]);
  return (
    <SidebarSection
      id="notes-filters"
      title={t(($) => $.notes.library.filters.title)}
      count={activeFilters > 0 ? activeFilters : undefined}
      countLabel={t(($) => $.notes.library.filters.active, { count: activeFilters })}
      open={open}
      onOpenChange={(next) => useNotesPrefsStore.getState().set("filtersOpen", next)}
      className="shrink-0 border-t border-b-0"
      contentClassName="space-y-2 p-2"
    >
      <TagPane tree={tree} selected={tag} onSelect={onSelectTag} />
      {research && (
        <FilterChips
          label={t(($) => $.notes.vault.search.fields.kind)}
          options={KIND_FILTERS}
          value={facetValue(kindFacet)}
          onChange={(value) => onFacet(VAULT_FACETS.kind, value)}
          render={(value) => (
            <>
              {value !== "all" && (
                <span aria-hidden data-kind-dot={value} className={cn("size-1.5 shrink-0 rounded-full", KIND_TONES[value].dot)} />
              )}
              {t(($) => $.notes.library.kind[value])}
            </>
          )}
        />
      )}
      <div className="space-y-1">
        <p aria-hidden className="text-[0.6875rem] leading-4 text-muted-foreground">
          {t(($) => $.notes.library.filters.writtenBy)}
        </p>
        <div className="flex min-h-6 items-center gap-2">
          <FilterChips
            label={t(($) => $.notes.library.filters.writtenBy)}
            options={AUTHOR_FILTERS}
            value={facetValue(authorFacet)}
            onChange={(value) => onFacet(VAULT_FACETS.author, value)}
            render={(value) => t(($) => $.notes.library.author[value])}
          />
          {activeFilters > 0 && (
            <Button variant="ghost" size="xs" className="ml-auto shrink-0" onClick={onClearFilters}>
              {t(($) => $.notes.library.filters.clear)}
            </Button>
          )}
        </div>
      </div>
    </SidebarSection>
  );
}

function searchResults(listing: boolean, listId: string, rows: number, activeRow: number) {
  if (!listing) return undefined;
  const open = rows > 0;
  return { listId, open, activeId: open ? optionId(listId, activeRow) : undefined };
}

export function NotesLibrary({
  iconFor,
  activeNoteId,
  activeArtifactId,
  homeLabel,
  onHome,
  onNewNote,
  onOpenNote,
  onOpenNoteInNewTab,
  onOpenNoteAt,
  onOpenArtifact,
  onToday,
  onOpenGraph,
  onImportFolder,
  onExportFolder,
  onOpenDeadLinks,
}: Readonly<NotesLibraryProps>) {
  const { t } = useTranslation(["notes", "common", "shell"]);
  const { notes, artifacts, openSettings, searchNotes, createNoteFrom, researchTasks } = useNotesData();
  const research = researchTasks !== false;
  const [query, setQuery] = useState("");
  const filtersOpen = useNotesPrefsStore((state) => state.filtersOpen);
  const searchRequest = useVaultStore((state) => state.searchRequest);
  const calendarOpen = useNotesPrefsStore((state) => state.calendarOpen);
  const [picking, setPicking] = useState(false);
  const onTemplates = createNoteFrom ? () => setPicking(true) : undefined;
  const [activeHit, setActiveHit] = useState(0);
  const fullscreen = useFullscreen();
  const listId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const tagRequest = useVaultStore((state) => state.tagRequest);
  const tagCounts = useNoteTagCounts();
  const vault = useVaultQuery(query, tagCounts);
  const { schema, plan } = vault;
  const { actionsFor, dialog } = useNoteActions(onOpenNoteInNewTab);
  const [searchOpen, setSearchOpen] = useState(false);
  const [seenSearchRequest, setSeenSearchRequest] = useState(searchRequest);
  if (seenSearchRequest !== searchRequest) {
    setSeenSearchRequest(searchRequest);
    setSearchOpen(true);
  }
  const searchShown = searchOpen || query !== "";
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const refocusSearchButton = useRef(false);
  const foldTimer = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (searchShown || !refocusSearchButton.current) return;
    refocusSearchButton.current = false;
    searchButtonRef.current?.focus();
  }, [searchShown]);
  useEffect(() => () => window.clearTimeout(foldTimer.current), []);

  useEffect(() => {
    const requested = useVaultStore.getState().tag;
    if (tagRequest === 0 || requested === null) return;
    useVaultStore.setState({ tag: null });
    setQuery((current) => writeTagFilter(current, analyze(current, schema, { now: Date.now() }), requested));
    useNotesPrefsStore.getState().set("filtersOpen", true);
  }, [schema, tagRequest]);

  const tagged = plan.searches.some((search) => TAG_SEARCH.test(search));
  const searching = searchNotes !== undefined && plan.fullText;
  const tagOnly = tagged && !plan.fullText;
  const mode = useSearchModeStore((state) => state.notes);
  const options = useMemo(() => (tagged || mode !== "ranked" ? { mode, blocks: tagged } : undefined), [mode, tagged]);
  const search = useVaultSearch(plan, searching || tagOnly, tagOnly ? TAG_BLOCK_LIMIT : SEARCH_LIMIT, options);
  const listing = searching || tagOnly;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(NO_EXPANDED);
  const tree = useMemo(() => (tagCounts ? tagTree(tagCounts) : null), [tagCounts]);
  const tag = selectedTag(vault.query);
  const kindFacet = readFacet(vault.query, VAULT_FACETS.kind);
  const authorFacet = readFacet(vault.query, VAULT_FACETS.author);
  const kind = kindFacet.kind === "option" ? (kindFacet.id as VaultKind) : null;

  const hitRows = useMemo<SearchRow[]>(() => {
    if (!listing) return [];
    const byId = new Map(notes.map((note) => [note.id, note]));
    const found = new Map((search.hits ?? []).map((hit) => [hit.id, hit]));
    const sources = searching
      ? (search.hits ?? []).flatMap((hit) => {
          const note = byId.get(hit.id);
          return note ? [{ hit, note }] : [];
        })
      : notes.filter(plan.test).map((note) => ({ hit: found.get(note.id) ?? localHit(note), note }));
    return sources.flatMap(({ hit, note }): SearchRow[] => {
      const blocks = hit.blocks ?? [];
      const shown = expanded.has(hit.id) ? blocks : blocks.slice(0, BLOCKS_SHOWN);
      const more = blocks.length - shown.length;
      return [{ hit, note }, ...shown.map((block) => ({ hit, note, block })), ...(more > 0 ? [{ hit, note, more }] : [])];
    });
  }, [expanded, listing, notes, plan.test, search.hits, searching]);

  const activeRow = Math.max(0, Math.min(activeHit, hitRows.length - 1));

  const groups = useMemo(() => {
    const shownNotes = listing ? [] : notes.filter(plan.test);
    const shownArtifacts = research ? artifacts.filter(plan.test) : [];
    const projects = new Map<string, ProjectGroup>();
    const groupFor = (project: string, projectId: string | undefined) => {
      const group = projects.get(project) ?? { notes: [], artifacts: [] };
      group.projectId ??= projectId;
      projects.set(project, group);
      return group;
    };
    for (const note of shownNotes) groupFor(note.project, note.relatedProjectId).notes.push(note);
    for (const artifact of shownArtifacts) groupFor(artifact.project, artifact.projectId).artifacts.push(artifact);
    return [...projects.entries()];
  }, [artifacts, listing, notes, plan.test, research]);

  const groupKeys = useMemo(
    () =>
      new Set([
        ...notes.flatMap((note) => [note.project, note.relatedProjectId]),
        ...artifacts.flatMap((artifact) => [artifact.project, artifact.projectId]),
      ]),
    [artifacts, notes],
  );
  const setGroupOpen = (key: string, open: boolean) => {
    const { closedGroups, set } = useNotesPrefsStore.getState();
    const kept = closedGroups.filter((item) => item !== key && groupKeys.has(item));
    set("closedGroups", open ? kept : [...kept, key]);
  };

  const now = useNow(MINUTE_MS);
  const activeFilters = activeFilterCount(vault.query);
  const clearFilters = () => setQuery(clearQualifiers(query, vault.query));
  const chooseTag = (next: string | null) => setQuery(writeTagFilter(query, vault.query, next));
  const chooseFacet = (facet: Facet, value: string) => {
    if (value === CUSTOM_FILTER) return;
    setQuery(writeFacet(query, vault.query, facet, value === ALL_FILTER ? null : value));
  };
  const openHit = (row: SearchRow, newTab: boolean) => {
    const { note, block, more } = row;
    if (more !== undefined) {
      setExpanded((current) => new Set([...current, note.id]));
      return;
    }
    if (block && onOpenNoteAt) onOpenNoteAt(note.id, block.block ? blockFragment(block.block) : textFragment(block.text));
    else if (newTab && onOpenNoteInNewTab) onOpenNoteInNewTab(note.id);
    else onOpenNote(note.id);
  };
  const foldSearch = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setQuery("");
    refocusSearchButton.current = true;
    setSearchOpen(false);
  };
  const onSearchAreaKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const { target } = event;
    if (event.key !== "Escape" || isImeEnter(event) || !(target instanceof Node)) return;
    if (!event.currentTarget.contains(target)) return;
    if (query === "" || !(target instanceof HTMLInputElement)) foldSearch(event);
  };
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeEnter(event)) return;
    if (event.key === "Escape") {
      foldSearch(event);
      return;
    }
    if (hitRows.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveHit((activeRow + step + hitRows.length) % hitRows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      openHit(hitRows[activeRow], isSelectionModifier(event));
    }
  };
  const searchLabel = research ? t(($) => $.notes.library.search) : t(($) => $.notes.home.search);
  const results = searchResults(listing, listId, hitRows.length, activeRow);

  return (
    <aside className="flex h-full w-76 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div
        data-tauri-drag-region
        className={cn("flex h-12 shrink-0 items-center gap-1.5 px-2", isMac && !fullscreen && "pl-[78px]")}
      >
        {!searchShown && (
          <>
            <HomeBrandButton
              brand={t(($) => $.notes.workspace.brand)}
              label={homeLabel}
              onClick={onHome}
              className="mr-auto min-w-0 shrink overflow-hidden"
            />
            <ShortcutButton ref={searchButtonRef} label={searchLabel} shortcut="notesSearch" className="size-8 shrink-0" onClick={focusNotesSearch}>
              <Search aria-hidden />
            </ShortcutButton>
          </>
        )}
        {/* biome-ignore lint/a11y/useSemanticElements: WebKit before Safari 17 has no search element, so the role keeps the landmark */}
        <div
          role="search"
          hidden={!searchShown}
          className="@container min-w-0 flex-1"
          onKeyDownCapture={onSearchAreaKey}
          onFocus={() => {
            window.clearTimeout(foldTimer.current);
            setSearchOpen(true);
          }}
          onBlur={() => {
            window.clearTimeout(foldTimer.current);
            foldTimer.current = window.setTimeout(() => setSearchOpen(false));
          }}
        >
          <QuerySearch
            value={query}
            onChange={(next) => {
              setQuery(next);
              setActiveHit(0);
            }}
            query={vault.query}
            schema={schema}
            ariaLabel={searchLabel}
            placeholder={searchLabel}
            clearLabel={t(($) => $.notes.vault.search.clear)}
            results={results}
            onKeyDown={onSearchKey}
            focusKey={searchRequest}
            trailing={<SearchTrailing canSearch={searchNotes !== undefined} query={query} mode={mode} />}
            className="h-9 rounded-xl bg-background focus-within:border-primary"
          />
        </div>
        <TooltipIconButton
          label={t(($) => $.notes.library.newNote)}
          variant="default"
          className="size-8 shrink-0"
          disabled={!onNewNote}
          onClick={onNewNote}
        >
          <Plus aria-hidden />
        </TooltipIconButton>
      </div>
      {tag && (
        <div className="flex border-b border-sidebar-border px-2 py-1.5">
          <TagChip tag={tag} onClear={() => chooseTag(null)} />
        </div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-1.5">
        {listing && hitRows.length > 0 && (
          <SearchResultList
            listId={listId}
            label={t(($) => $.notes.vault.search.results)}
            rows={hitRows}
            active={activeRow}
            activeNoteId={activeArtifactId === null ? activeNoteId : null}
            onActiveChange={setActiveHit}
            onOpen={openHit}
          />
        )}
        {hitRows.length === 0 && groups.length === 0 && (
          <LibraryNoRows
            searching={searching}
            search={search}
            query={query}
            hasItems={notes.length + artifacts.length > 0}
            start={{ onNewNote, onToday, onTemplates, onImportFolder }}
            kind={kind}
            activeFilters={activeFilters}
            filtersOpen={filtersOpen}
            onClearFilters={clearFilters}
          />
        )}
        {groups.map(([project, group]) => (
          <LibraryGroup
            key={project}
            project={project}
            group={group}
            scrollRef={scrollRef}
            activeNoteId={activeNoteId}
            activeArtifactId={activeArtifactId}
            now={now}
            iconFor={iconFor}
            actionsFor={actionsFor}
            onOpenNote={onOpenNote}
            onOpenArtifact={onOpenArtifact}
            onOpenChange={setGroupOpen}
          />
        ))}
      </div>
      <SidebarSection
        id="notes-calendar"
        title={t(($) => $.notes.calendar.title)}
        open={calendarOpen}
        onOpenChange={(open) => useNotesPrefsStore.getState().set("calendarOpen", open)}
        className="shrink-0 border-t border-b-0"
        contentClassName="p-1"
      >
        <NotesCalendar onOpenNote={onOpenNote} />
      </SidebarSection>
      <LibraryFilters
        tree={tree}
        tag={tag}
        onSelectTag={chooseTag}
        research={research}
        kindFacet={kindFacet}
        authorFacet={authorFacet}
        onFacet={chooseFacet}
        activeFilters={activeFilters}
        onClearFilters={clearFilters}
        open={filtersOpen}
      />
      <VaultFooter
        onToday={onToday}
        onSwitcher={() => setQuickSwitcherOpen(true)}
        onOpenGraph={onOpenGraph}
        onTemplates={onTemplates}
        onImportFolder={onImportFolder}
        onExportFolder={onExportFolder}
        onOpenDeadLinks={onOpenDeadLinks}
        onSettings={openSettings}
      />
      <TemplatePicker open={picking} onOpenChange={setPicking} onCreated={onOpenNote} />
      {dialog}
    </aside>
  );
}
