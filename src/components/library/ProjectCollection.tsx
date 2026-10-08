import {
  memo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  BookmarkCheck,
  Check,
  CopyPlus,
  Eye,
  FileText,
  FolderMinus,
  FolderOpen,
  GitFork,
  History,
  Info,
  Palette,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Book, BOOK_COLOR_OPTIONS, useBookColorLabels } from "@/components/library/Book";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { FolderStateLine, type UnavailableFolder } from "@/components/library/folder-state";
import { projectEngineLabel } from "@/components/library/project-search";
import { ROW_WINDOW_ITEM, useRowWindow } from "@/hooks/use-row-window";
import { isFolderProject } from "@/lib/library-projects";
import { projectModifiedLabel } from "@/lib/project-format";
import type { ProjectInfo } from "@/lib/tauri";
import { cn, isMac, isWindows } from "@/lib/utils";

type LibraryTranslate = ReturnType<typeof useTranslation<["common", "library"]>>["t"];

export function projectKindLabel(t: LibraryTranslate, kind: string | undefined): string {
  switch (kind || "document") {
    case "document":
      return t(($) => $.library.projects.kind.document);
    case "image":
      return t(($) => $.library.projects.kind.image);
    case "diagram":
      return t(($) => $.library.projects.kind.diagram);
    default:
      return kind ?? "";
  }
}

function projectTypeLabel(t: LibraryTranslate, project: ProjectInfo): string {
  if (isFolderProject(project)) return t(($) => $.library.projects.kind.external);
  return projectKindLabel(t, project.kind);
}

function projectCardLabels(t: LibraryTranslate, project: ProjectInfo, updatedAt: number) {
  if (project.recovery_pending) {
    return {
      date: t(($) => $.library.projects.openToRecover),
      engine: t(($) => $.library.projects.openToRecover),
      kind: t(($) => $.library.projects.recoveryRequired),
      openLabel: t(($) => $.library.projects.openToRecoverNamed, { name: project.name }),
    };
  }
  return {
    date: projectModifiedLabel(updatedAt),
    engine: projectEngineLabel(project),
    kind: projectTypeLabel(t, project),
    openLabel: undefined,
  };
}

function projectRowColumns(t: LibraryTranslate, project: ProjectInfo, updatedAt: number) {
  if (project.recovery_pending) {
    return {
      kind: t(($) => $.library.projects.recoveryShort),
      engine: t(($) => $.library.projects.recoveryMetadata),
      activity: t(($) => $.library.projects.recoveryModified),
    };
  }
  return {
    kind: projectTypeLabel(t, project),
    engine: projectEngineLabel(project),
    activity: projectModifiedLabel(updatedAt),
  };
}

function projectOpenLabel(t: LibraryTranslate, project: ProjectInfo) {
  return project.recovery_pending
    ? t(($) => $.library.projects.openToRecoverNamed, { name: project.name })
    : t(($) => $.library.projects.open, { name: project.name });
}

function projectPreviewLabel(t: LibraryTranslate, project: ProjectInfo) {
  return project.has_preview
    ? t(($) => $.library.projects.previewPdf)
    : t(($) => $.library.projects.previewUnavailable);
}

function starredStyle(starred: boolean) {
  return starred ? { color: "#f59e0b" } : undefined;
}

function projectFavoriteLabel(t: LibraryTranslate, starred: boolean) {
  return starred
    ? t(($) => $.library.projects.favoriteRemove)
    : t(($) => $.library.projects.favoriteAdd);
}

function ProjectRowCaption({
  t,
  project,
  folderState,
}: Readonly<{
  t: LibraryTranslate;
  project: ProjectInfo;
  folderState: UnavailableFolder | null;
}>) {
  if (project.recovery_pending) {
    return (
      <span className="mt-1 block truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-600 dark:text-amber-400">
        {t(($) => $.library.projects.openToRecover)}
      </span>
    );
  }
  const caption = `${projectEngineLabel(project)} · ${projectTypeLabel(t, project)}`;
  if (folderState) {
    return (
      <span className="mt-1 block min-w-0 text-xs lg:hidden">
        <FolderStateLine state={folderState} className="sm:hidden" />
        <span className="hidden truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:block lg:hidden">
          {caption}
        </span>
      </span>
    );
  }
  return (
    <span className="mt-1 block truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground lg:hidden">
      {caption}
    </span>
  );
}

export type ProjectCardActions = Readonly<{
  open: (project: ProjectInfo) => void;
  openById: (id: string) => void;
  toggleFavorite: (id: string) => void;
  showPreview: (project: ProjectInfo) => void;
  requestThumbnail: (project: ProjectInfo) => void;
  releaseThumbnail: (project: ProjectInfo) => void;
  reveal: (id: string) => void;
  copyIntoLibrary: (project: ProjectInfo) => void;
  setColor: (id: string, hex: string) => void;
  remove: (project: ProjectInfo) => void;
  details: (project: ProjectInfo) => void;
  history: (project: ProjectInfo) => void;
  fork: (project: ProjectInfo) => void;
  trash: (project: ProjectInfo) => void;
}>;

type MenuKit = Readonly<{
  Item: typeof ContextMenuItem;
  Sub: typeof ContextMenuSub;
  SubTrigger: typeof ContextMenuSubTrigger;
  SubContent: typeof ContextMenuSubContent;
}>;

const CONTEXT_MENU_KIT: MenuKit = {
  Item: ContextMenuItem,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

const DROPDOWN_MENU_KIT: MenuKit = {
  Item: DropdownMenuItem,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

function ProjectMenuItems({
  project: p,
  color,
  reachable,
  kit,
  actions,
}: Readonly<{
  project: ProjectInfo;
  color: string;
  reachable: boolean;
  kit: MenuKit;
  actions: ProjectCardActions;
}>) {
  const { t } = useTranslation(["common", "library"]);
  const colorLabels = useBookColorLabels();
  const { Item, Sub, SubTrigger, SubContent } = kit;
  if (p.recovery_pending) {
    return (
      <Item onClick={() => actions.openById(p.id)}>
        <FileText className="mr-2 size-4" /> {t(($) => $.library.projects.openToRecover)}
      </Item>
    );
  }
  const colorSub = (
    <Sub>
      <SubTrigger>
        <Palette className="mr-2 size-4" /> {t(($) => $.library.projects.changeColor)}
      </SubTrigger>
      <SubContent className="w-44">
        {BOOK_COLOR_OPTIONS.map((c) => (
          <Item key={c.hex} onClick={() => actions.setColor(p.id, c.hex)}>
            <span
              className="mr-2 size-3.5 shrink-0 rounded-full border border-black/10"
              style={{ background: c.hex }}
            />
            {colorLabels[c.name] ?? c.name}
            {color === c.hex && <Check className="ml-auto size-3.5" />}
          </Item>
        ))}
      </SubContent>
    </Sub>
  );
  if (isFolderProject(p)) {
    let revealLabel = t(($) => $.library.folder.menu.showInFileManager);
    if (isMac) revealLabel = t(($) => $.library.folder.menu.showInFinder);
    else if (isWindows) revealLabel = t(($) => $.library.folder.menu.showInExplorer);
    return (
      <>
        <Item onClick={() => actions.open(p)}>
          <FileText className="mr-2 size-4" /> {t(($) => $.library.projects.openProject)}
        </Item>
        <Item disabled={!reachable} onClick={() => actions.reveal(p.id)}>
          <FolderOpen className="mr-2 size-4" /> {revealLabel}
        </Item>
        <Item disabled={!reachable} onClick={() => actions.copyIntoLibrary(p)}>
          <CopyPlus className="mr-2 size-4" /> {t(($) => $.library.folder.menu.copyToLibrary)}
        </Item>
        {colorSub}
        <Item onClick={() => actions.remove(p)}>
          <FolderMinus className="mr-2 size-4" /> {t(($) => $.library.folder.menu.remove)}
        </Item>
      </>
    );
  }
  return (
    <>
      <Item onClick={() => actions.openById(p.id)}>
        <FileText className="mr-2 size-4" /> {t(($) => $.library.projects.openProject)}
      </Item>
      <Item onClick={() => actions.details(p)}>
        <Info className="mr-2 size-4" /> {t(($) => $.library.projects.details)}
      </Item>
      <Item onClick={() => actions.history(p)}>
        <History className="mr-2 size-4" /> {t(($) => $.library.projects.exportHistory)}
      </Item>
      {colorSub}
      <Item onClick={() => actions.fork(p)}>
        <GitFork className="mr-2 size-4" /> {t(($) => $.library.projects.fork)}
      </Item>
      <Item
        className="text-destructive focus:text-destructive"
        onClick={() => actions.trash(p)}
      >
        <Trash2 className="mr-2 size-4" /> {t(($) => $.library.projects.delete)}
      </Item>
    </>
  );
}

export type ProjectCardData = Readonly<{
  colorOf: (project: ProjectInfo) => string;
  folderStateOf: (project: ProjectInfo) => UnavailableFolder | null;
  updatedAtOf: (project: ProjectInfo) => number;
  favorites: ReadonlySet<string>;
  thumbs: Readonly<Record<string, string | null>>;
  forkNames: ReadonlyMap<string, string>;
  hoverPreview: boolean;
  actions: ProjectCardActions;
}>;

type CardProps = Readonly<{
  project: ProjectInfo;
  color: string;
  folderState: UnavailableFolder | null;
  updatedAt: number;
  starred: boolean;
  hoverPreview: boolean;
  thumb: string | null | undefined;
  actions: ProjectCardActions;
}>;

const ProjectGridCard = memo(function ProjectGridCard({
  project: p,
  color,
  folderState,
  updatedAt,
  starred,
  hoverPreview,
  thumb,
  actions,
  lastRow,
}: CardProps & Readonly<{ lastRow: boolean }>) {
  const { t } = useTranslation(["common", "library"]);
  const labels = projectCardLabels(t, p, updatedAt);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          {...{ [ROW_WINDOW_ITEM]: "" }}
          className={cn("flex justify-center", !lastRow && "pb-14 xl:pb-16")}
        >
          <Book
            title={p.name}
            color={color}
            date={folderState ? <FolderStateLine state={folderState} /> : labels.date}
            engine={labels.engine}
            forkedFrom={p.forked_from}
            dimmed={folderState !== null}
            kind={labels.kind}
            openLabel={labels.openLabel}
            starred={starred}
            onStarToggle={p.recovery_pending ? undefined : () => actions.toggleFavorite(p.id)}
            menu={
              p.recovery_pending ? null : <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t(($) => $.library.projects.actions, { name: p.name })}
                    onClick={(event) => event.stopPropagation()}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                  >
                    <Info className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <ProjectMenuItems
                    project={p}
                    color={color}
                    reachable={folderState === null}
                    kit={DROPDOWN_MENU_KIT}
                    actions={actions}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            }
            onClick={() => actions.open(p)}
            onPreviewRequest={
              p.recovery_pending || folderState ? undefined : () => actions.requestThumbnail(p)
            }
            onPreviewCancel={
              p.recovery_pending || folderState ? undefined : () => actions.releaseThumbnail(p)
            }
            preview={!p.recovery_pending && !folderState && hoverPreview ? thumb : undefined}
            width={180}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ProjectMenuItems
          project={p}
          color={color}
          reachable={folderState === null}
          kit={CONTEXT_MENU_KIT}
          actions={actions}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
});

type ActiveIdStore = Readonly<{
  get: () => string | null;
  set: (next: string | null) => void;
  release: (id: string) => void;
  subscribe: (listener: () => void) => () => void;
}>;

function createActiveIdStore(): ActiveIdStore {
  let current: string | null = null;
  const listeners = new Set<() => void>();
  const set = (next: string | null) => {
    if (next === current) return;
    current = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => current,
    set,
    release: (id) => {
      if (current === id) set(null);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const ProjectListRow = memo(function ProjectListRow({
  project: p,
  color,
  folderState,
  updatedAt,
  starred,
  hoverPreview,
  thumb,
  actions,
  forkSource,
  previewing: previewStore,
}: CardProps &
  Readonly<{
    forkSource: string | null;
    previewing: ActiveIdStore;
  }>) {
  const { t } = useTranslation(["common", "library"]);
  const previewing = useSyncExternalStore(
    previewStore.subscribe,
    () => previewStore.get() === p.id,
  );
  const recoveryPending = p.recovery_pending;
  const columns = projectRowColumns(t, p, updatedAt);
  const startPreview = () => {
    if (recoveryPending || folderState || !hoverPreview) return;
    previewStore.set(p.id);
    actions.requestThumbnail(p);
  };
  const endPreview = () => {
    previewStore.release(p.id);
    actions.releaseThumbnail(p);
  };
  const favoriteLabel = projectFavoriteLabel(t, starred);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          {...{ [ROW_WINDOW_ITEM]: "" }}
          className="group grid min-h-[5.25rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 px-3 transition-colors last:border-b-0 hover:bg-accent/35 sm:grid-cols-[minmax(0,1fr)_9rem_auto] lg:grid-cols-[minmax(0,1fr)_7rem_7rem_9rem_6.5rem] lg:gap-4 lg:px-4"
        >
          <button
            type="button"
            aria-label={projectOpenLabel(t, p)}
            onClick={() => actions.open(p)}
            onMouseEnter={startPreview}
            onMouseLeave={endPreview}
            onFocus={startPreview}
            onBlur={endPreview}
            className="flex min-w-0 items-center gap-3 rounded-md py-3 text-left focus-visible:bg-accent/60"
          >
            <span
              aria-hidden="true"
              className={cn(
                "relative h-12 w-9 shrink-0 overflow-hidden rounded-[4px] border border-black/10 shadow-sm",
                folderState && "opacity-60 grayscale",
              )}
              style={{ backgroundColor: color }}
            >
              {hoverPreview && !recoveryPending && previewing && thumb ? (
                <img
                  src={thumb}
                  alt=""
                  draggable={false}
                  className="size-full object-cover object-top"
                />
              ) : null}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">
                {p.name}
              </span>
              <ProjectRowCaption t={t} project={p} folderState={folderState} />
            </span>
          </button>
          <span className="hidden text-xs capitalize text-muted-foreground lg:block">
            {columns.kind}
          </span>
          <span className="hidden text-xs text-muted-foreground lg:block">
            {columns.engine}
          </span>
          <span className="hidden min-w-0 text-xs text-muted-foreground sm:block">
            {folderState ? <FolderStateLine state={folderState} /> : columns.activity}
          </span>
          <span className="flex items-center justify-end gap-0.5">
            {recoveryPending ? (
              <Badge variant="warning" size="sm">
                {t(($) => $.library.projects.recoveryRequired)}
              </Badge>
            ) : null}
            {!recoveryPending && forkSource ? (
              <Tooltip label={t(($) => $.library.projects.forkedFrom, { name: forkSource })}>
                <span
                  role="img"
                  aria-label={t(($) => $.library.projects.forkedFrom, { name: forkSource })}
                  className="flex size-7 items-center justify-center text-muted-foreground"
                >
                  <GitFork aria-hidden className="size-4" />
                </span>
              </Tooltip>
            ) : null}
            {!recoveryPending ? (
              <Tooltip label={projectPreviewLabel(t, p)}>
                <button
                  type="button"
                  disabled={!p.has_preview || folderState !== null}
                  onClick={() => actions.showPreview(p)}
                  aria-label={t(($) => $.library.projects.previewNamed, { name: p.name })}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 focus-visible:bg-accent focus-visible:text-foreground"
                >
                  <Eye aria-hidden className="size-4" />
                </button>
              </Tooltip>
            ) : null}
            {!recoveryPending ? (
              <Tooltip label={favoriteLabel}>
                <button
                  type="button"
                  onClick={() => actions.toggleFavorite(p.id)}
                  aria-label={favoriteLabel}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground",
                    starred && "text-amber-500 hover:text-amber-500",
                  )}
                  style={starredStyle(starred)}
                >
                  {starred ? (
                    <BookmarkCheck aria-hidden className="size-4 fill-current" />
                  ) : (
                    <Bookmark aria-hidden className="size-4" />
                  )}
                </button>
              </Tooltip>
            ) : null}
            {!recoveryPending ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t(($) => $.library.projects.actions, { name: p.name })}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
                  >
                    <Info aria-hidden className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <ProjectMenuItems
                    project={p}
                    color={color}
                    reachable={folderState === null}
                    kit={DROPDOWN_MENU_KIT}
                    actions={actions}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ProjectMenuItems
          project={p}
          color={color}
          reachable={folderState === null}
          kit={CONTEXT_MENU_KIT}
          actions={actions}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
});

const GRID_COLUMN_QUERIES: readonly (readonly [string, number])[] = [
  ["(min-width: 96rem)", 5],
  ["(min-width: 80rem)", 4],
  ["(min-width: 64rem)", 3],
];

let gridMediaLists: { matchMedia: typeof window.matchMedia; lists: MediaQueryList[] } | null = null;

function mediaLists(): MediaQueryList[] {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return [];
  if (gridMediaLists?.matchMedia !== window.matchMedia) {
    gridMediaLists = {
      matchMedia: window.matchMedia,
      lists: GRID_COLUMN_QUERIES.map(([query]) => window.matchMedia(query)),
    };
  }
  return gridMediaLists.lists;
}

function gridColumnCount(): number {
  const lists = mediaLists();
  for (let index = 0; index < lists.length; index += 1) {
    if (lists[index]?.matches) return GRID_COLUMN_QUERIES[index][1];
  }
  return 2;
}

function subscribeGridColumns(listener: () => void): () => void {
  const lists = mediaLists();
  for (const list of lists) list.addEventListener?.("change", listener);
  return () => {
    for (const list of lists) list.removeEventListener?.("change", listener);
  };
}

function useGridColumns(): number {
  return useSyncExternalStore(subscribeGridColumns, gridColumnCount, () => 2);
}

const GRID_OVERSCAN_ROWS = 2;
const GRID_UNMEASURED_ROWS = 4;
const LIST_UNMEASURED_ROWS = 16;

function cardProps(project: ProjectInfo, data: ProjectCardData) {
  return {
    project,
    color: data.colorOf(project),
    folderState: data.folderStateOf(project),
    updatedAt: data.updatedAtOf(project),
    starred: data.favorites.has(project.id),
    hoverPreview: data.hoverPreview,
    thumb: data.thumbs[project.id],
    actions: data.actions,
  };
}

export function ProjectGrid({
  projects,
  data,
  scrollRef,
}: Readonly<{
  projects: readonly ProjectInfo[];
  data: ProjectCardData;
  scrollRef: RefObject<HTMLElement | null>;
}>) {
  const listRef = useRef<HTMLDivElement>(null);
  const columns = useGridColumns();
  const rowCount = Math.ceil(projects.length / columns);
  const rows = useRowWindow({
    count: rowCount,
    scrollRef,
    listRef,
    overscan: GRID_OVERSCAN_ROWS,
    unmeasuredCount: GRID_UNMEASURED_ROWS,
  });
  const first = rows.start * columns;
  const lastRowStart = (rowCount - 1) * columns;
  return (
    <div
      ref={listRef}
      data-testid="project-grid"
      className="grid grid-cols-2 gap-x-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 xl:gap-x-16 2xl:grid-cols-5"
      style={{ paddingTop: rows.paddingTop, paddingBottom: rows.paddingBottom }}
    >
      {projects.slice(first, rows.end * columns).map((project, index) => (
        <ProjectGridCard
          key={project.id}
          {...cardProps(project, data)}
          lastRow={first + index >= lastRowStart}
        />
      ))}
    </div>
  );
}

export function ProjectList({
  projects,
  data,
  scrollRef,
}: Readonly<{
  projects: readonly ProjectInfo[];
  data: ProjectCardData;
  scrollRef: RefObject<HTMLElement | null>;
}>) {
  const { t } = useTranslation(["common", "library"]);
  const listRef = useRef<HTMLDivElement>(null);
  const [previewing] = useState(createActiveIdStore);
  const rows = useRowWindow({
    count: projects.length,
    scrollRef,
    listRef,
    unmeasuredCount: LIST_UNMEASURED_ROWS,
  });
  return (
    <div data-testid="project-list" className="border-b border-border/70">
      <div
        aria-hidden="true"
        className="hidden min-h-10 grid-cols-[minmax(0,1fr)_7rem_7rem_9rem_6.5rem] items-center gap-4 border-b border-border/70 px-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground lg:grid"
      >
        <span>{t(($) => $.library.home.columns.name)}</span>
        <span>{t(($) => $.library.home.columns.type)}</span>
        <span>{t(($) => $.library.home.columns.engine)}</span>
        <span>{t(($) => $.library.home.columns.modified)}</span>
        <span />
      </div>
      <div
        ref={listRef}
        style={{ paddingTop: rows.paddingTop, paddingBottom: rows.paddingBottom }}
      >
        {projects.slice(rows.start, rows.end).map((project) => (
          <ProjectListRow
            key={project.id}
            {...cardProps(project, data)}
            forkSource={
              project.forked_from
                ? (data.forkNames.get(project.forked_from) ?? project.forked_from)
                : null
            }
            previewing={previewing}
          />
        ))}
      </div>
    </div>
  );
}
