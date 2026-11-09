import { MoreHorizontal, Plus, Settings } from "lucide-react";
import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { analyze, clearQualifiers, readFacet, writeFacet, type Facet, type FacetState } from "@oleafly/search-query";
import { isImeEnter } from "@/components/ai/composer/ime";
import { HomeBrandButton } from "@/components/layout/HomeBrandButton";
import { SIDEBAR_TITLE_CLASS, SidebarSection } from "@/components/layout/SidebarSection";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { QuerySearch } from "@/components/ui/query-search";
import { Tooltip } from "@/components/ui/tooltip";
import { ROW_WINDOW_ITEM, useRowWindow } from "@/hooks/use-row-window";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { readString, writeString } from "@/lib/local-storage";
import { useFullscreen } from "@/lib/use-fullscreen";
import { cn, isMac } from "@/lib/utils";
import { isSelectionModifier } from "@/store/library-selection";
import {
  CONTEXT_MENU_KIT,
  ConflictMark,
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
  selectedTag,
  useVaultQuery,
  VAULT_AUTHORS,
  VAULT_FACETS,
  VAULT_KINDS,
  type VaultKind,
  writeTagFilter,
} from "./note-query";
import { tagTree, useNoteTagCounts, useVaultSearch } from "./note-search";
import { SharedMark } from "./NoteShareButton";
import { useNotesData } from "./notes-data";
import { SidebarGraphActions } from "./NoteImportDialog";
import { ProjectDot, useProjectColor } from "./project-color";
import { TemplatePicker } from "./TemplatePicker";
import type { ArtifactItem, Author, NoteItem } from "./types";
import { setQuickSwitcherOpen, useVaultStore } from "./vault-store";
import { optionId, SearchResultList, type SearchRow, TagChip, TagPane, TemplateButton, VaultHeaderActions } from "./vault-sidebar";

type KindFilter = "all" | VaultKind;
type AuthorFilter = "all" | Author;

const KIND_FILTERS: readonly KindFilter[] = ["all", ...VAULT_KINDS];
const AUTHOR_FILTERS: readonly AuthorFilter[] = ["all", ...VAULT_AUTHORS];
const ALL_FILTER = "all";
const CUSTOM_FILTER = "custom";

const NOTES_FILTERS_OPEN_KEY = "oleafly.notes.filtersOpen";
const MINUTE_MS = 60_000;

const CHIP_LIST = "m-0 flex min-w-0 flex-wrap justify-start gap-1 border-0 p-0";
const CHIP =
  "inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-full border border-sidebar-border bg-background px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:bg-sidebar-accent aria-pressed:border-primary/30 aria-pressed:bg-primary/10 aria-pressed:text-primary motion-reduce:transition-none";

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
  onOpenArtifact: (artifact: ArtifactItem) => void;
  onToday?: () => void;
  onOpenGraph?: () => void;
  onImportFolder?: () => void;
  onExportFolder?: () => void;
}

function readFiltersOpen(): boolean {
  return readString(NOTES_FILTERS_OPEN_KEY) === "true";
}

function saveFiltersOpen(open: boolean): void {
  writeString(NOTES_FILTERS_OPEN_KEY, String(open));
}

function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function Row({
  active,
  icon,
  title,
  meta,
  className,
  badge,
  onClick,
}: Readonly<{
  active: boolean;
  icon: ReactNode;
  title: string;
  meta: ReactNode;
  className?: string;
  badge?: ReactNode;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent focus-visible:bg-sidebar-accent",
        active && "bg-primary/10 hover:bg-primary/15 focus-visible:bg-primary/15",
        className,
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1">
          <span className={cn("block truncate text-sm", active && "font-medium")}>{title}</span>
          {badge}
        </span>
        <span className="mt-0.5 block text-[0.6875rem] text-muted-foreground">{meta}</span>
      </span>
    </button>
  );
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
  const meta = bylineFor(note, now);
  const badge =
    note.shared || actions.conflict ? (
      <>
        {note.shared && <SharedMark />}
        {actions.conflict && <ConflictMark />}
      </>
    ) : null;
  const open = () => onOpenNote(note.id);
  if (!hasNoteMenu(actions)) {
    return (
      <div {...{ [ROW_WINDOW_ITEM]: "" }} data-note-row={note.id}>
        <Row active={active} icon={icon} title={note.title} meta={meta} badge={badge} onClick={open} />
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
        <div {...{ [ROW_WINDOW_ITEM]: "" }} data-note-row={note.id} className="group/row relative">
          {renaming ? (
            <div className="flex items-center gap-2.5 rounded-md bg-sidebar-accent px-2 py-1">
              {icon}
              <NoteRenameInput title={note.title} className="h-7 px-2 py-0 text-sm" onDone={finishRename} />
            </div>
          ) : (
            <>
              <Row active={active} icon={icon} title={note.title} meta={meta} badge={badge} className="pr-9" onClick={open} />
              <DropdownMenu>
                <Tooltip
                  label={t(($) => $.notes.library.menu.more)}
                  side="bottom"
                  relative={false}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2"
                >
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={t(($) => $.notes.library.menu.more)}
                      className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:bg-foreground/10 focus-visible:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:bg-foreground/10 data-[state=open]:text-foreground data-[state=open]:opacity-100"
                    >
                      <MoreHorizontal aria-hidden className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-52" onCloseAutoFocus={runPending}>
                  {items(DROPDOWN_MENU_KIT)}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
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
      <Row
        active={active}
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
}>) {
  const colorOf = useProjectColor();
  const listRef = useRef<HTMLDivElement>(null);
  const entries = useMemo<GroupEntry[]>(
    () => [
      ...group.notes.map((note) => ({ kind: "note" as const, note })),
      ...group.artifacts.map((artifact) => ({ kind: "artifact" as const, artifact })),
    ],
    [group],
  );
  const rows = useRowWindow({ count: entries.length, scrollRef, listRef });
  return (
    <section>
      <div className="flex items-center gap-2 px-2 pb-1">
        <h2 className={cn("flex min-w-0 items-center gap-1.5", SIDEBAR_TITLE_CLASS)}>
          <ProjectDot color={colorOf(group.projectId)} />
          <span className="truncate">{project}</span>
        </h2>
        <span className="ml-auto text-[0.6875rem] tabular-nums text-muted-foreground">{entries.length}</span>
      </div>
      <div ref={listRef} style={{ paddingTop: rows.paddingTop, paddingBottom: rows.paddingBottom }}>
        {entries.slice(rows.start, rows.end).map((entry) =>
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
          ),
        )}
      </div>
    </section>
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
        <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)} className={CHIP}>
          {render(option)}
        </button>
      ))}
    </fieldset>
  );
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
  onOpenArtifact,
  onToday,
  onOpenGraph,
  onImportFolder,
  onExportFolder,
}: Readonly<NotesLibraryProps>) {
  const { t } = useTranslation(["notes"]);
  const { notes, artifacts, openSettings, searchNotes, createNoteFrom, researchTasks } = useNotesData();
  const research = researchTasks !== false;
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(readFiltersOpen);
  const [picking, setPicking] = useState(false);
  const [activeHit, setActiveHit] = useState(0);
  const fullscreen = useFullscreen();
  const listId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const tagRequest = useVaultStore((state) => state.tagRequest);
  const tagCounts = useNoteTagCounts();
  const vault = useVaultQuery(query, tagCounts);
  const { schema, plan } = vault;
  const { actionsFor, dialog } = useNoteActions(onOpenNoteInNewTab);

  useEffect(() => {
    const requested = useVaultStore.getState().tag;
    if (tagRequest === 0 || requested === null) return;
    useVaultStore.setState({ tag: null });
    setQuery((current) => writeTagFilter(current, analyze(current, schema, { now: Date.now() }), requested));
    setFiltersOpen(true);
    saveFiltersOpen(true);
  }, [schema, tagRequest]);

  const searching = searchNotes !== undefined && plan.fullText;
  const search = useVaultSearch(plan, searching);
  const tree = useMemo(() => (tagCounts ? tagTree(tagCounts) : null), [tagCounts]);
  const tag = selectedTag(vault.query);
  const kindFacet = readFacet(vault.query, VAULT_FACETS.kind);
  const authorFacet = readFacet(vault.query, VAULT_FACETS.author);
  const kind = kindFacet.kind === "option" ? (kindFacet.id as VaultKind) : null;

  const hitRows = useMemo<SearchRow[]>(() => {
    if (!searching || !search.hits) return [];
    const byId = new Map(notes.map((note) => [note.id, note]));
    return search.hits.flatMap((hit) => {
      const note = byId.get(hit.id);
      return note ? [{ hit, note }] : [];
    });
  }, [notes, search.hits, searching]);

  const activeRow = Math.max(0, Math.min(activeHit, hitRows.length - 1));

  const groups = useMemo(() => {
    const shownNotes = searching ? [] : notes.filter(plan.test);
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
  }, [artifacts, notes, plan.test, research, searching]);

  const now = useMinuteClock();
  const activeFilters = activeFilterCount(vault.query);
  const clearFilters = () => setQuery(clearQualifiers(query, vault.query));
  const chooseTag = (next: string | null) => setQuery(writeTagFilter(query, vault.query, next));
  const chooseFacet = (facet: Facet, value: string) => {
    if (value === CUSTOM_FILTER) return;
    setQuery(writeFacet(query, vault.query, facet, value === ALL_FILTER ? null : value));
  };
  const openHit = (id: string, newTab: boolean) => {
    if (newTab && onOpenNoteInNewTab) onOpenNoteInNewTab(id);
    else onOpenNote(id);
  };
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeEnter(event)) return;
    if (event.key === "Escape" && query !== "") {
      event.stopPropagation();
      setQuery("");
      return;
    }
    if (hitRows.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveHit((activeRow + step + hitRows.length) % hitRows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = hitRows[activeRow];
      openHit(row.note.id, isSelectionModifier(event));
    }
  };
  const toggleFilters = (open: boolean) => {
    setFiltersOpen(open);
    saveFiltersOpen(open);
  };
  const searchLabel = research ? t(($) => $.notes.library.search) : t(($) => $.notes.home.search);
  const emptyText = kind === null ? t(($) => $.notes.library.empty) : t(($) => $.notes.library.emptyKind[kind]);
  const hasHits = hitRows.length > 0;
  const activeId = hasHits ? optionId(listId, activeRow) : undefined;
  const results = searching ? { listId, open: hasHits, activeId } : undefined;

  return (
    <aside className="flex h-full w-76 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div
        data-tauri-drag-region
        className={cn("flex min-h-12 shrink-0 items-center justify-between px-2", isMac && !fullscreen && "pl-[78px]")}
      >
        <HomeBrandButton label={homeLabel} onClick={onHome} />
        <div data-notes-header-actions className="flex items-center gap-0.5">
          <VaultHeaderActions onToday={onToday} onSwitcher={() => setQuickSwitcherOpen(true)} />
          <SidebarGraphActions onOpenGraph={onOpenGraph} onImportFolder={onImportFolder} onExportFolder={onExportFolder} />
          <Tooltip label={t(($) => $.notes.library.settings)} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t(($) => $.notes.library.settings)}
              className="size-7"
              disabled={!openSettings}
              onClick={openSettings}
            >
              <Settings aria-hidden />
            </Button>
          </Tooltip>
        </div>
      </div>
      <div className="flex items-center gap-1 border-b border-sidebar-border p-2">
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
          className="h-9 flex-1 rounded-xl bg-background has-[input:focus-visible]:bg-accent/40"
        />
        <Tooltip label={t(($) => $.notes.library.newNote)} side="bottom">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t(($) => $.notes.library.newNote)}
            className="size-9 shrink-0"
            disabled={!onNewNote}
            onClick={onNewNote}
          >
            <Plus aria-hidden />
          </Button>
        </Tooltip>
        <TemplateButton onClick={createNoteFrom ? () => setPicking(true) : undefined} />
      </div>
      {tag && (
        <div className="flex border-b border-sidebar-border px-2 py-1.5">
          <TagChip tag={tag} onClear={() => chooseTag(null)} />
        </div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-1.5">
        {searching && hitRows.length > 0 && (
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
        {searching && hitRows.length === 0 && groups.length === 0 && (
          <p aria-live="polite" className="px-2 py-3 text-xs text-muted-foreground">
            {search.pending || search.hits === null
              ? t(($) => $.notes.vault.search.searching)
              : t(($) => $.notes.vault.search.noResults, { query: query.trim() })}
          </p>
        )}
        {!searching && groups.length === 0 && (
          <div className="flex flex-col items-start gap-2 px-2 py-3">
            <p className="text-xs text-muted-foreground">
              {notes.length + artifacts.length === 0 ? t(($) => $.notes.library.noNotes) : emptyText}
            </p>
            {activeFilters > 0 && !filtersOpen && (
              <Button variant="outline" size="xs" onClick={clearFilters}>
                {t(($) => $.notes.library.filters.clear)}
              </Button>
            )}
          </div>
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
          />
        ))}
      </div>
      <SidebarSection
        id="notes-filters"
        title={t(($) => $.notes.library.filters.title)}
        count={activeFilters > 0 ? activeFilters : undefined}
        countLabel={t(($) => $.notes.library.filters.active, { count: activeFilters })}
        open={filtersOpen}
        onOpenChange={toggleFilters}
        className="shrink-0 border-t border-b-0"
        contentClassName="space-y-2 p-2"
      >
        <TagPane tree={tree} selected={tag} onSelect={chooseTag} />
        {research && (
          <FilterChips
            label={t(($) => $.notes.vault.search.fields.kind)}
            options={KIND_FILTERS}
            value={facetValue(kindFacet)}
            onChange={(value) => chooseFacet(VAULT_FACETS.kind, value)}
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
        <FilterChips
          label={t(($) => $.notes.vault.search.fields.author)}
          options={AUTHOR_FILTERS}
          value={facetValue(authorFacet)}
          onChange={(value) => chooseFacet(VAULT_FACETS.author, value)}
          render={(value) => t(($) => $.notes.library.author[value])}
        />
        {activeFilters > 0 && (
          <Button variant="ghost" size="xs" onClick={clearFilters}>
            {t(($) => $.notes.library.filters.clear)}
          </Button>
        )}
      </SidebarSection>
      <TemplatePicker open={picking} onOpenChange={setPicking} onCreated={onOpenNote} />
      {dialog}
    </aside>
  );
}
