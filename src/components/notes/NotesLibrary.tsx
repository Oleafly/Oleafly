import { FolderInput, MoreHorizontal, PanelsTopLeft, Pencil, Plus, Search, Settings, Trash2 } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { HomeBrandButton } from "@/components/layout/HomeBrandButton";
import { SIDEBAR_TITLE_CLASS, SidebarSection } from "@/components/layout/SidebarSection";
import { Button } from "@/components/ui/button";
import { CheckBadge } from "@/components/ui/check-badge";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { useInitialFocus } from "@/components/ui/use-initial-focus";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { logError } from "@/lib/log";
import { shortProjectName } from "@/lib/project-format";
import { notifyError, toast } from "@/lib/toast";
import { useFullscreen } from "@/lib/use-fullscreen";
import { cn, isMac } from "@/lib/utils";
import { Byline, KIND_TONES, KindChip, NoteChip } from "./note-icons";
import { useNotesData } from "./notes-data";
import { ProjectDot, useProjectColor } from "./project-color";
import type { ArtifactItem, ArtifactKind, Author, NoteItem } from "./types";

type KindFilter = "all" | "note" | Exclude<ArtifactKind, "html" | "file">;
type AuthorFilter = "all" | Author;

const KIND_FILTERS: readonly KindFilter[] = ["all", "note", "figure", "report", "data"];
const AUTHOR_FILTERS: readonly AuthorFilter[] = ["all", "agent", "you"];

const NOTES_FILTERS_OPEN_KEY = "oleafly.notes.filtersOpen";

const CHIP_LIST = "flex h-auto flex-wrap justify-start gap-1 bg-transparent p-0";
const CHIP =
  "rounded-full border border-sidebar-border bg-background px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:bg-sidebar-accent data-[state=active]:border-primary/30 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none";
const MENU_ITEM = "gap-2 [&>svg]:size-4 [&>svg]:shrink-0";

interface ProjectGroup {
  projectId?: string;
  notes: NoteItem[];
  artifacts: ArtifactItem[];
}

interface NotesLibraryProps {
  iconFor: (note: NoteItem) => string | undefined;
  activeNoteId: string | null;
  activeArtifactId: string | null;
  onHome: () => void;
  onNewNote?: () => void;
  onOpenNote: (id: string) => void;
  onOpenNoteInNewTab?: (id: string) => void;
  onOpenArtifact: (artifact: ArtifactItem) => void;
}

interface NoteActions {
  openInNewTab?: () => void;
  rename?: (title: string) => void;
  move?: { projects: readonly { id: string; name: string }[]; to: (projectId: string | null) => void };
  remove?: () => void;
}

interface PendingDelete {
  title: string;
  remove: () => Promise<void>;
}

type MenuKit = Readonly<{
  Item: typeof ContextMenuItem;
  Separator: typeof ContextMenuSeparator;
  Sub: typeof ContextMenuSub;
  SubTrigger: typeof ContextMenuSubTrigger;
  SubContent: typeof ContextMenuSubContent;
}>;

const CONTEXT_MENU_KIT: MenuKit = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

const DROPDOWN_MENU_KIT: MenuKit = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

function readFiltersOpen(): boolean {
  try {
    return localStorage.getItem(NOTES_FILTERS_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

function saveFiltersOpen(open: boolean): void {
  try {
    localStorage.setItem(NOTES_FILTERS_OPEN_KEY, String(open));
  } catch {
    return;
  }
}

function Row({
  active,
  icon,
  title,
  meta,
  className,
  onClick,
}: Readonly<{
  active: boolean;
  icon: ReactNode;
  title: string;
  meta: ReactNode;
  className?: string;
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
        <span className={cn("block truncate text-sm", active && "font-medium")}>{title}</span>
        <span className="mt-0.5 block text-[0.6875rem] text-muted-foreground">{meta}</span>
      </span>
    </button>
  );
}

function RenameField({ icon, title, onDone }: Readonly<{ icon: ReactNode; title: string; onDone: (title: string | null) => void }>) {
  const { t } = useTranslation(["notes"]);
  const [value, setValue] = useState(title);
  const inputRef = useInitialFocus<HTMLInputElement>();
  const finished = useRef(false);
  const finish = (next: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(next);
  };
  return (
    <div className="flex items-center gap-2.5 rounded-md bg-sidebar-accent px-2 py-1">
      {icon}
      <Input
        ref={inputRef}
        aria-label={t(($) => $.notes.library.menu.renameLabel)}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => finish(value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") finish(value);
          else if (event.key === "Escape") {
            event.stopPropagation();
            finish(null);
          }
        }}
        className="h-7 min-w-0 flex-1 px-2 py-0 text-sm focus-visible:border-primary/50"
      />
    </div>
  );
}

function NoteMenuItems({
  note,
  kit,
  actions,
  onRename,
  onDelete,
}: Readonly<{ note: NoteItem; kit: MenuKit; actions: NoteActions; onRename: () => void; onDelete: () => void }>) {
  const { t } = useTranslation(["notes"]);
  const colorOf = useProjectColor();
  const { Item, Separator, Sub, SubTrigger, SubContent } = kit;
  const { openInNewTab, rename, move, remove } = actions;
  const current = note.relatedProjectId ?? null;
  const choose = (projectId: string | null) => {
    if (move && projectId !== current) move.to(projectId);
  };
  return (
    <>
      {openInNewTab && (
        <Item className={MENU_ITEM} onSelect={openInNewTab}>
          <PanelsTopLeft aria-hidden />
          {t(($) => $.notes.library.menu.openInNewTab)}
        </Item>
      )}
      {rename && (
        <Item className={MENU_ITEM} onSelect={onRename}>
          <Pencil aria-hidden />
          {t(($) => $.notes.library.menu.rename)}
        </Item>
      )}
      {move && (
        <Sub>
          <SubTrigger className={MENU_ITEM}>
            <FolderInput aria-hidden />
            {t(($) => $.notes.workspace.project)}
          </SubTrigger>
          <SubContent className="max-h-80 w-56 overflow-y-auto">
            <Item className="gap-2" onSelect={() => choose(null)}>
              <ProjectDot color={null} />
              <span className="min-w-0 flex-1 truncate">{t(($) => $.notes.workspace.noProject)}</span>
              {current === null && <CheckBadge />}
            </Item>
            {move.projects.map((project) => (
              <Item key={project.id} className="gap-2" onSelect={() => choose(project.id)}>
                <ProjectDot color={colorOf(project.id)} />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                {current === project.id && <CheckBadge />}
              </Item>
            ))}
          </SubContent>
        </Sub>
      )}
      {remove && (
        <>
          {(openInNewTab || rename || move) && <Separator />}
          <Item className={cn(MENU_ITEM, "text-destructive focus:text-destructive")} onSelect={onDelete}>
            <Trash2 aria-hidden />
            {t(($) => $.notes.library.menu.delete)}
          </Item>
        </>
      )}
    </>
  );
}

function NoteRow({
  note,
  active,
  icon,
  meta,
  actions,
  onOpen,
}: Readonly<{ note: NoteItem; active: boolean; icon: ReactNode; meta: ReactNode; actions: NoteActions; onOpen: () => void }>) {
  const { t } = useTranslation(["notes"]);
  const [renaming, setRenaming] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const hasMenu = Boolean(actions.openInNewTab || actions.rename || actions.move || actions.remove);
  if (!hasMenu) return <Row active={active} icon={icon} title={note.title} meta={meta} onClick={onOpen} />;

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
        <div data-note-row={note.id} className="group/row relative">
          {renaming ? (
            <RenameField icon={icon} title={note.title} onDone={finishRename} />
          ) : (
            <>
              <Row active={active} icon={icon} title={note.title} meta={meta} className="pr-9" onClick={onOpen} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t(($) => $.notes.library.menu.more)}
                    className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:bg-foreground/10 focus-visible:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:bg-foreground/10 data-[state=open]:text-foreground data-[state=open]:opacity-100"
                  >
                    <MoreHorizontal aria-hidden className="size-4" />
                  </button>
                </DropdownMenuTrigger>
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
}

function matchesKind(kind: KindFilter, artifact: ArtifactItem): boolean {
  if (kind === "all") return true;
  if (kind === "figure") return artifact.kind === "figure" || artifact.kind === "html";
  return artifact.kind === kind;
}

export function NotesLibrary({
  iconFor,
  activeNoteId,
  activeArtifactId,
  onHome,
  onNewNote,
  onOpenNote,
  onOpenNoteInNewTab,
  onOpenArtifact,
}: Readonly<NotesLibraryProps>) {
  const { t } = useTranslation(["notes"]);
  const { notes, artifacts, projects, setRelatedProject, renameNote, deleteNote, openSettings } = useNotesData();
  const [kind, setKind] = useState<KindFilter>("all");
  const [author, setAuthor] = useState<AuthorFilter>("all");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(readFiltersOpen);
  const [deleting, setDeleting] = useState<PendingDelete | null>(null);
  const fullscreen = useFullscreen();

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const matches = (item: { title: string; author: Author }) =>
      (author === "all" || item.author === author) && (needle === "" || item.title.toLocaleLowerCase().includes(needle));
    const shownNotes = kind === "all" || kind === "note" ? notes.filter(matches) : [];
    const shownArtifacts =
      kind === "note" ? [] : artifacts.filter((item) => matchesKind(kind, item) && matches({ title: item.title, author: "agent" }));
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
  }, [artifacts, author, kind, notes, query]);

  const colorOf = useProjectColor();
  const now = Date.now();
  const meta = (item: { author: Author; agent?: string; updatedAt: number }) => (
    <Byline author={item.author} agent={item.agent} when={formatRelativeTimeFrom(item.updatedAt, now, { dateAfterDays: 7 })} />
  );
  const activeFilters = (kind === "all" ? 0 : 1) + (author === "all" ? 0 : 1);
  const toggleFilters = (open: boolean) => {
    setFiltersOpen(open);
    saveFiltersOpen(open);
  };

  const actionsFor = (note: NoteItem): NoteActions => ({
    openInNewTab: onOpenNoteInNewTab ? () => onOpenNoteInNewTab(note.id) : undefined,
    rename: renameNote
      ? (title) =>
          void renameNote(note.id, title).catch((error: unknown) =>
            notifyError("rename note", error, t(($) => $.notes.library.menu.renameFailed, { name: note.title })),
          )
      : undefined,
    move:
      projects && setRelatedProject
        ? {
            projects,
            to: (projectId) =>
              void setRelatedProject(note.id, projectId).catch((error: unknown) => {
                void logError("set the note's project", error);
              }),
          }
        : undefined,
    remove: deleteNote ? () => setDeleting({ title: note.title, remove: () => deleteNote(note.id) }) : undefined,
  });

  const confirmDelete = async (target: PendingDelete) => {
    setDeleting(null);
    try {
      await target.remove();
    } catch (error) {
      notifyError("delete note", error, t(($) => $.notes.library.menu.deleteFailed, { name: target.title }));
      return;
    }
    toast.success(t(($) => $.notes.library.menu.deleted, { name: target.title }));
  };

  return (
    <aside className="flex h-full w-76 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div
        data-tauri-drag-region
        className={cn("flex min-h-12 shrink-0 items-center justify-between px-2", isMac && !fullscreen && "pl-[78px]")}
      >
        <HomeBrandButton onClick={onHome} />
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
      <div className="flex items-center gap-1 border-b border-sidebar-border p-2">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={t(($) => $.notes.library.search)}
            placeholder={t(($) => $.notes.library.search)}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-7 focus-visible:border-input focus-visible:bg-accent/40"
          />
        </div>
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
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-1.5">
        {groups.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {notes.length + artifacts.length === 0
              ? t(($) => $.notes.library.noNotes)
              : t(($) => $.notes.library.empty)}
          </p>
        )}
        {groups.map(([project, group]) => (
          <section key={project}>
            <div className="flex items-center gap-2 px-2 pb-1">
              <h2 className={cn("flex min-w-0 items-center gap-1.5", SIDEBAR_TITLE_CLASS)}>
                <ProjectDot color={colorOf(group.projectId)} />
                <span className="truncate">{project}</span>
              </h2>
              <span className="ml-auto text-[0.6875rem] tabular-nums text-muted-foreground">
                {group.notes.length + group.artifacts.length}
              </span>
            </div>
            {group.notes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                active={activeNoteId === note.id && activeArtifactId === null}
                icon={<NoteChip icon={iconFor(note)} color={note.color} />}
                meta={meta(note)}
                actions={actionsFor(note)}
                onOpen={() => onOpenNote(note.id)}
              />
            ))}
            {group.artifacts.map((artifact) => (
              <Row
                key={artifact.id}
                active={activeArtifactId === artifact.id}
                icon={<KindChip kind={artifact.kind} />}
                title={artifact.title}
                meta={meta({ author: "agent", agent: artifact.agent, updatedAt: artifact.updatedAt })}
                onClick={() => onOpenArtifact(artifact)}
              />
            ))}
          </section>
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
        <Tabs value={kind} onValueChange={(value) => setKind(value as KindFilter)}>
          <TabsList size="sm" className={CHIP_LIST}>
            {KIND_FILTERS.map((value) => (
              <TabsTrigger key={value} value={value} className={CHIP}>
                {value !== "all" && (
                  <span aria-hidden data-kind-dot={value} className={cn("size-1.5 shrink-0 rounded-full", KIND_TONES[value].dot)} />
                )}
                {t(($) => $.notes.library.kind[value])}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Tabs value={author} onValueChange={(value) => setAuthor(value as AuthorFilter)}>
          <TabsList size="sm" className={CHIP_LIST}>
            {AUTHOR_FILTERS.map((value) => (
              <TabsTrigger key={value} value={value} className={CHIP}>
                {t(($) => $.notes.library.author[value])}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </SidebarSection>
      {deleting && (
        <ConfirmationDialog
          open
          title={t(($) => $.notes.library.menu.deleteTitle, { name: shortProjectName(deleting.title) })}
          description={t(($) => $.notes.library.menu.deleteDescription)}
          confirmLabel={t(($) => $.notes.library.menu.deleteConfirm)}
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete(deleting)}
        />
      )}
    </aside>
  );
}
