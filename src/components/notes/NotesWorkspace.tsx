import {
  activate,
  closeView,
  groupOfView,
  groupsOf,
  openView,
  visibleViews,
  Workspace,
  type GroupNode,
  type RenderTooltip,
  type ViewInfo,
  type ViewState,
  type WorkspaceLayout,
} from "@oleafly/workspace";
import {
  ArrowLeft,
  ArrowRight,
  FileOutput,
  FileText,
  FolderPlus,
  House,
  Info,
  Link2Off,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Send,
  TableOfContents,
  Waypoints,
} from "lucide-react";
import {
  createContext,
  memo,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { lazy } from "@/lib/preloadable";
import { useTranslation } from "react-i18next";
import { HomeBrandButton } from "@/components/layout/HomeBrandButton";
import { WindowControls } from "@/components/layout/WindowControls";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { EmptyState } from "@/components/ui/empty";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip } from "@/components/ui/tooltip";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { flushOpenNotes } from "@/lib/open-note-editors";
import { useFullscreen } from "@/lib/use-fullscreen";
import { cn, isMac } from "@/lib/utils";
import { matchesShortcut, type ShortcutId, useShortcutStore } from "@/store/shortcuts";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { useSettingsStore } from "@/store/settings";
import { ArtifactPanel } from "./ArtifactPanel";
import { NoteDocument, type NoteSaveFailure, type SaveStatus } from "./NoteDocument";
import { NoteLiveHeader } from "./NotePresence";
import { NoteSaveStatus } from "./NoteSaveStatus";
import { useLiveNoteClaim, useNoteLiveMode, useNoteReadOnly } from "./use-note-live";
import { artifactSnippet, artifactsForNote, noteForProject } from "./note-artifacts";
import { frontMatterBody } from "@/lib/front-matter";
import { NoteChip } from "./note-icons";
import { useNotesByLook } from "./note-signature";
import { NoteExportDialog, NoteImportDialog } from "./NoteImportDialog";
import { NoteOutline } from "./NoteOutline";
import { NoteDeadLinks } from "./NoteDeadLinks";
import { NoteInfoPanel } from "./NoteInfo";
import { NotesDataProvider, useNotesData } from "./notes-data";
import {
  ARTIFACTS_SHARE,
  ARTIFACTS_VIEW,
  DEAD_LINKS_VIEW,
  GRAPH_VIEW,
  HOME_VIEW,
  holdsNotes,
  INFO_VIEW,
  homeViews,
  isSideView,
  LOCAL_GRAPH_VIEW,
  OUTLINE_VIEW,
  openDeadLinksIn,
  openGraphIn,
  openNoteFrom,
  toggleSideView,
  newHomeViewId,
  noteIdOf,
  noteViewId,
  openHomeIn,
  openHomeInPlace,
  openNoteIn,
  openNoteInPlace,
  openNoteViews,
  readNotesLayout,
  saveNotesLayout,
  stageGroup,
} from "./notes-layout";
import type { HomeTab } from "./home-notes";
import {
  type HistoryDirection,
  homeTabOf,
  type NotesPlace,
  noteScroll,
  placeView,
  recordVisit,
  showHomeTab,
  stepIndexes,
  type TabHistory,
  tabHistory,
  travel,
} from "./notes-history";
import { NotesEmptyPanel } from "./NotesEmptyPanel";
import { NotesHome } from "./NotesHome";
import { NotesLibrary } from "./NotesLibrary";
import { NotesVaultLayer } from "./QuickSwitcher";
import { useOpenDailyNote } from "./daily-note";
import { filterByTag, focusNotesSearch } from "./vault-store";
import { ShortcutButton } from "./vault-sidebar";
import { RelatedProjectMenu } from "./RelatedProjectMenu";
import { DROPDOWN_MENU_KIT, hasNoteMenu, type NoteActions, NoteExportItems, NoteRenameInput, useNoteActions } from "./note-actions";
import { useNoteMenus } from "./NoteCard";
import type { ArtifactItem, NoteItem } from "./types";
import { FrozenNoteLinkIndex } from "./use-note-links";
import { useNotesAppearanceRef } from "@/hooks/use-notes-appearance";
import "./notes.css";

export interface ProjectSeed {
  noteId: string;
  artifactId: string | null;
}

interface NotesWorkspaceProps {
  initialNoteId?: string | null;
  initialFragment?: string | null;
  requestedNoteId?: string | null;
  requestedFragment?: string | null;
  onRequestHandled?: () => void;
  onExit?: () => void;
  onNewNote?: () => Promise<string | null>;
  onCreateProject?: (seed: ProjectSeed) => void;
  onSendToPaper?: (request: { paperId: string; text: string; noteId: string }) => void;
}

interface InsertRequest {
  noteId: string;
  snippet: string;
  id: number;
}

interface HeadingRequest {
  noteId: string;
  slug: string;
  id: number;
}

interface ScrollRequest {
  noteId: string;
  top: number;
  id: number;
}

interface HistoryItem {
  index: number;
  title: string;
  icon: ReactNode;
}

interface WorkspaceActions {
  focusedNoteId: string | null;
  artifactId: string | null;
  setArtifactId: (id: string) => void;
  openNote: (id: string) => void;
  openNoteHeading: (id: string, slug: string) => void;
  openFromHome: (homeId: string, noteId: string) => void;
  chooseHomeTab: (homeId: string, tab: HomeTab) => void;
  insertArtifact?: (artifact: ArtifactItem) => Promise<void>;
  newProject?: (seed: ProjectSeed) => void;
  newNoteFromHome?: (homeId: string) => void;
  importFolder: () => void;
}

interface NoteViewActions {
  insertRequest: InsertRequest | null;
  holdView: (viewId: string, held: boolean) => void;
  headingRequest: HeadingRequest | null;
  scrollRequest: ScrollRequest | null;
  openNote: (id: string) => void;
  openNoteHeading: (id: string, slug: string) => void;
  openTag: (tag: string) => void;
  closeTab: (viewId: string) => void;
  openHomeHere: (viewId: string) => void;
  newProject?: (seed: ProjectSeed) => void;
  sendToPaper?: (request: { text: string; noteId: string }) => void;
}

interface SideActions {
  openNoteFrom: (id: string) => void;
  openProject?: (projectId: string) => void;
  sideOpen: (viewId: string) => boolean;
  toggleSide: (viewId: string) => void;
  infoTarget: HTMLElement | null;
  setInfoTarget: (element: HTMLElement | null) => void;
}

interface SaveState {
  status: SaveStatus;
  failure: NoteSaveFailure | null;
}

const ActionsContext = createContext<WorkspaceActions | null>(null);
const NoteActionsContext = createContext<NoteViewActions | null>(null);
const SideContext = createContext<SideActions | null>(null);
const ShownContext = createContext<ReadonlySet<string>>(new Set());
const LazyNoteGraph = lazy(() => import("./NoteGraph").then((module) => ({ default: module.NoteGraph })), { warm: true });
const WINDOW_DRAG: Readonly<Record<string, string>> = { "data-tauri-drag-region": "" };
const SAVE_DELAY_MS = 150;
const SAVED: SaveState = { status: "saved", failure: null };
const KEPT_HIDDEN_VIEWS = 4;
const HISTORY_MENU_ITEMS = 15;
const MOUSE_STEPS: Readonly<Record<number, HistoryDirection>> = { 3: -1, 4: 1 };
const MemoNoteDocument = memo(NoteDocument);
const renderTooltip: RenderTooltip = (label, trigger, options) => (
  <Tooltip label={label} side={options.side} className={options.className}>
    {trigger}
  </Tooltip>
);

function useActions(): WorkspaceActions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("Notes views need the workspace actions");
  return actions;
}

function useNoteViewActions(): NoteViewActions {
  const actions = useContext(NoteActionsContext);
  if (!actions) throw new Error("Note views need the note actions");
  return actions;
}

function useSideActions(): SideActions {
  const actions = useContext(SideContext);
  if (!actions) throw new Error("Notes views need the side panel actions");
  return actions;
}

function useInfoInPanel(): boolean {
  return useSettingsStore((state) => state.notesInfo) === "side";
}

function infoPanelFor(inPanel: boolean, focused: boolean, target: HTMLElement | null): HTMLElement | null | undefined {
  if (!inPanel) return undefined;
  return focused ? target : null;
}

function withoutView(viewId: string): (layout: WorkspaceLayout) => WorkspaceLayout {
  return (layout) => (viewId in layout.views ? closeView(layout, viewId) : layout);
}

function SideToggles() {
  const { t } = useTranslation(["notes"]);
  const side = useSideActions();
  const outline = side.sideOpen(OUTLINE_VIEW);
  const local = side.sideOpen(LOCAL_GRAPH_VIEW);
  const info = side.sideOpen(INFO_VIEW);
  const infoInPanel = useInfoInPanel();
  return (
    <>
      <ShortcutButton
        label={outline ? t(($) => $.notes.graph.hideOutline) : t(($) => $.notes.graph.showOutline)}
        shortcut="notesOutline"
        aria-pressed={outline}
        className={cn(outline && "bg-accent")}
        onClick={() => side.toggleSide(OUTLINE_VIEW)}
      >
        <TableOfContents aria-hidden className="size-4" />
      </ShortcutButton>
      <ShortcutButton
        label={local ? t(($) => $.notes.graph.hideLocal) : t(($) => $.notes.graph.showLocal)}
        shortcut="notesLocalGraph"
        aria-pressed={local}
        className={cn(local && "bg-accent")}
        onClick={() => side.toggleSide(LOCAL_GRAPH_VIEW)}
      >
        <Waypoints aria-hidden className="size-4" />
      </ShortcutButton>
      {infoInPanel && (
        <ShortcutButton
          label={t(($) => $.notes.info.show)}
          shortcut="notesProperties"
          aria-pressed={info}
          className={cn(info && "bg-accent")}
          onClick={() => side.toggleSide(INFO_VIEW)}
        >
          <Info aria-hidden className="size-4" />
        </ShortcutButton>
      )}
    </>
  );
}

function HistoryButton({
  label,
  shortcut,
  icon,
  items,
  onStep,
  onJump,
}: Readonly<{
  label: string;
  shortcut: ShortcutId;
  icon: ReactNode;
  items: readonly HistoryItem[];
  onStep: () => void;
  onJump: (index: number) => void;
}>) {
  const empty = items.length === 0;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={empty}>
        <ShortcutButton label={label} shortcut={shortcut} disabled={empty} onClick={onStep}>
          {icon}
        </ShortcutButton>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        {items.map((item) => (
          <ContextMenuItem key={item.index} className="gap-2" onSelect={() => onJump(item.index)}>
            {item.icon}
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function GraphView({ local }: Readonly<{ local: boolean }>) {
  const actions = useActions();
  const side = useSideActions();
  const activeId = actions.focusedNoteId;
  return (
    <Suspense fallback={null}>
      <LazyNoteGraph
        mode={local ? "local" : "global"}
        centerId={local ? activeId : null}
        activeId={activeId}
        onOpenNote={(id, { newTab }) => (newTab ? actions.openNote(id) : side.openNoteFrom(id))}
        onOpenProject={side.openProject}
      />
    </Suspense>
  );
}

function DeadLinksView() {
  const actions = useActions();
  return <NoteDeadLinks onOpenNoteAt={actions.openNoteHeading} />;
}

function OutlineView() {
  const actions = useActions();
  return <NoteOutline noteId={actions.focusedNoteId} onOpenHeading={actions.openNoteHeading} />;
}

function InfoView() {
  const side = useSideActions();
  return <NoteInfoPanel onTarget={side.setInfoTarget} />;
}

const KeptWhileHidden = memo(function KeptWhileHidden({ viewId, children }: Readonly<{ viewId: string; children: ReactNode }>) {
  const data = useNotesData();
  const shown = useContext(ShownContext).has(viewId);
  const kept = useRef(data);
  if (shown) kept.current = data;
  return (
    <NotesDataProvider value={kept.current}>
      <FrozenNoteLinkIndex live={shown}>{children}</FrozenNoteLinkIndex>
    </NotesDataProvider>
  );
});

function HeaderMenu({
  label,
  icon,
  onCloseAutoFocus,
  children,
}: Readonly<{ label: string; icon: ReactNode; onCloseAutoFocus?: () => void; children: ReactNode }>) {
  return (
    <DropdownMenu>
      <Tooltip label={label} side="bottom">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={label} className="size-7">
            {icon}
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={onCloseAutoFocus}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useFocusedNoteShortcuts(focused: boolean, actions: NoteActions, toggleInfo: () => void): void {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const toggleInfoRef = useRef(toggleInfo);
  toggleInfoRef.current = toggleInfo;
  useEffect(() => {
    if (!focused) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const { bindings } = useShortcutStore.getState();
      const current = actionsRef.current;
      let handled = true;
      if (current.favorite && matchesShortcut(event, bindings.notesBookmark)) current.favorite.toggle();
      else if (current.copyLink && matchesShortcut(event, bindings.notesCopyLink)) current.copyLink();
      else if (matchesShortcut(event, bindings.notesProperties)) {
        if (useSettingsStore.getState().notesInfo === "side") toggleInfoRef.current();
        else {
          const prefs = useNotesPrefsStore.getState();
          prefs.set("propertiesOpen", !prefs.propertiesOpen);
        }
      } else handled = false;
      if (handled) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused]);
}

function NoteHeader({ note, lead, children }: Readonly<{ note: NoteItem; lead: ReactNode; children: ReactNode }>) {
  const { t } = useTranslation(["notes"]);
  const { openNote, openHomeHere } = useNoteViewActions();
  const { focusedNoteId } = useActions();
  const side = useSideActions();
  const { actionsFor, dialog } = useNoteActions(openNote);
  const actions = actionsFor(note);
  useFocusedNoteShortcuts(focusedNoteId === note.id, actions, () => side.toggleSide(INFO_VIEW));
  const more: NoteActions = { ...actions, openInNewTab: undefined, share: undefined, exportAs: undefined, copyMarkdown: undefined };
  const menus = useNoteMenus(note, more);
  const homeLabel = t(($) => $.notes.workspace.breadcrumbHome);
  return (
    <>
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b px-2">
        <Breadcrumb aria-label={t(($) => $.notes.workspace.breadcrumb)} className="min-w-0 flex-1">
          <BreadcrumbList>
            <BreadcrumbItem className="shrink-0">
              <Tooltip label={homeLabel} side="bottom">
                <BreadcrumbLink asChild className="p-1">
                  <button type="button" aria-label={homeLabel} onClick={() => openHomeHere(noteViewId(note.id))}>
                    <House aria-hidden className="size-4" />
                  </button>
                </BreadcrumbLink>
              </Tooltip>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <RelatedProjectMenu note={note} />
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem className={cn(menus.renaming && "flex-1")}>
              {menus.renaming ? (
                <NoteRenameInput title={note.title} className="h-7 px-2 py-0 text-sm" onDone={menus.finishRename} />
              ) : (
                <Tooltip label={note.title} side="bottom" className="min-w-0">
                  <BreadcrumbPage>{note.title}</BreadcrumbPage>
                </Tooltip>
              )}
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex min-w-0 shrink-0 items-center gap-1">
          {lead}
          <HeaderMenu label={t(($) => $.notes.library.menu.export)} icon={<FileOutput aria-hidden className="size-4" />}>
            <NoteExportItems kit={DROPDOWN_MENU_KIT} actions={actions} />
          </HeaderMenu>
          {children}
          {hasNoteMenu(more) && (
            <HeaderMenu
              label={t(($) => $.notes.library.menu.more)}
              icon={<MoreHorizontal aria-hidden className="size-4" />}
              onCloseAutoFocus={menus.runPending}
            >
              {menus.items(DROPDOWN_MENU_KIT)}
            </HeaderMenu>
          )}
        </div>
      </div>
      {dialog}
    </>
  );
}

const NoteViewBody = memo(function NoteViewBody({ noteId }: Readonly<{ noteId: string }>) {
  const { t } = useTranslation(["notes"]);
  const data = useNotesData();
  const actions = useNoteViewActions();
  const { focusedNoteId } = useActions();
  const { infoTarget } = useSideActions();
  const infoPanel = infoPanelFor(useInfoInPanel(), focusedNoteId === noteId, infoTarget);
  const [save, setSave] = useState<SaveState>(SAVED);
  const onStatusChange = useCallback((status: SaveStatus, failure: NoteSaveFailure | null) => {
    setSave((current) => (current.status === status && current.failure === failure ? current : { status, failure }));
  }, []);
  const openRef = useRef(actions);
  openRef.current = actions;
  const onOpenNote = useCallback((id: string, options?: { newTab: boolean; heading?: string }) => {
    if (options?.heading) openRef.current.openNoteHeading(id, options.heading);
    else openRef.current.openNote(id);
  }, []);
  const onClose = useCallback(() => openRef.current.closeTab(noteViewId(noteId)), [noteId]);
  const note = data.notes.find((candidate) => candidate.id === noteId);
  const liveMode = useNoteLiveMode(noteId, note?.shared === true);
  const { holdView } = actions;
  const held = save.status !== "saved" || liveMode === "live";
  useEffect(() => {
    const viewId = noteViewId(noteId);
    holdView(viewId, held);
    return () => holdView(viewId, false);
  }, [held, holdView, noteId]);
  const insertRequest = actions.insertRequest?.noteId === noteId ? actions.insertRequest : null;
  const openHeading = actions.headingRequest?.noteId === noteId ? actions.headingRequest : null;
  const openScroll = actions.scrollRequest?.noteId === noteId ? actions.scrollRequest : null;
  const { loadNote } = data;
  const sendRequest = actions.sendToPaper;
  const sendToPaper = useMemo(() => sendRequest && ((text: string) => sendRequest({ text, noteId })), [noteId, sendRequest]);
  const sendNote = useCallback(async () => {
    if (!sendToPaper) return;
    await flushOpenNotes();
    sendToPaper(frontMatterBody((await loadNote(noteId)).text).trim());
  }, [loadNote, noteId, sendToPaper]);
  if (!note) {
    return (
      <EmptyState className="h-full p-6" description={t(($) => $.notes.workspace.missing)}>
        <Button variant="outline" size="sm" onClick={() => actions.closeTab(noteViewId(noteId))}>
          {t(($) => $.notes.workspace.closeMissing)}
        </Button>
      </EmptyState>
    );
  }
  const showStatus = liveMode !== "live" || save.status === "failed";
  return (
    <div className="flex h-full min-h-0 flex-col" data-note-view={note.id}>
      <NoteHeader
        note={note}
        lead={
          <>
            {showStatus && <NoteSaveStatus status={save.status} className="max-w-[18rem] pr-2" />}
            <NoteLiveHeader noteId={note.id} mode={liveMode} onShare={data.shareNote && (() => data.shareNote?.(note.id))} />
          </>
        }
      >
        {actions.newProject && (
          <TooltipIconButton
            label={t(($) => $.notes.workspace.newProject)}
            onClick={() => actions.newProject?.({ noteId: note.id, artifactId: null })}
          >
            <FolderPlus aria-hidden className="size-4" />
          </TooltipIconButton>
        )}
        {sendToPaper && (
          <TooltipIconButton label={t(($) => $.notes.workspace.sendToPaper)} onClick={() => void sendNote()}>
            <Send aria-hidden className="size-4" />
          </TooltipIconButton>
        )}
        <SideToggles />
      </NoteHeader>
      <div className="flex min-h-0 flex-1">
        <MemoNoteDocument
          note={note}
          insertRequest={insertRequest}
          onSendToPaper={sendToPaper}
          onStatusChange={onStatusChange}
          onOpenNote={onOpenNote}
          onOpenTag={actions.openTag}
          openHeading={openHeading}
          openScroll={openScroll}
          onClose={onClose}
          infoPanel={infoPanel}
        />
      </div>
    </div>
  );
});

function ArtifactsView() {
  const { t } = useTranslation(["notes"]);
  const actions = useActions();
  const { notes } = useNotesData();
  const note = notes.find((candidate) => candidate.id === actions.focusedNoteId) ?? null;
  const readOnly = useNoteReadOnly(note?.id ?? null);
  if (!note) return <EmptyState className="h-full p-6" description={t(($) => $.notes.artifacts.noNote)} />;
  return (
    <ArtifactPanel
      note={note}
      selectedId={actions.artifactId}
      onSelect={actions.setArtifactId}
      onInsert={readOnly ? undefined : actions.insertArtifact}
      onNewProject={actions.newProject && ((artifact) => actions.newProject?.({ noteId: note.id, artifactId: artifact.id }))}
    />
  );
}

function HomeView({ viewId, tab }: Readonly<{ viewId: string; tab: HomeTab }>) {
  const actions = useActions();
  return (
    <NotesHome
      tab={tab}
      onTabChange={(next) => actions.chooseHomeTab(viewId, next)}
      iconFor={(item) => item.icon}
      onOpenNote={(noteId) => actions.openFromHome(viewId, noteId)}
      onOpenNoteInNewTab={actions.openNote}
      onNewNote={actions.newNoteFromHome && (() => actions.newNoteFromHome?.(viewId))}
      onImport={actions.importFolder}
    />
  );
}

interface EmptyPanelActions {
  newTab: (groupId: string) => void;
  newNote?: (groupId: string | null) => void;
  openNoteAt: (id: string, groupId: string | null) => void;
  openSearch: () => void;
}

function emptyPanelFor({ newTab, newNote, openNoteAt, openSearch }: EmptyPanelActions) {
  return (group: GroupNode) => (
    <NotesEmptyPanel
      onHome={() => newTab(group.id)}
      onNewNote={newNote && (() => newNote(group.id))}
      onOpenNote={(id) => openNoteAt(id, group.id)}
      onSearch={openSearch}
    />
  );
}

function noteShownIn(layout: WorkspaceLayout, noteId: string | null): string | null {
  return noteId && layout.views[noteViewId(noteId)] ? noteId : null;
}

function historySteps(history: TabHistory | null, exists: (entry: NotesPlace) => boolean): { back: number[]; forward: number[] } {
  if (!history) return { back: [], forward: [] };
  return { back: stepIndexes(history, -1, exists), forward: stepIndexes(history, 1, exists) };
}

function viewContent(id: string, view: ViewState): ReactNode {
  if (view.type === "home") return <HomeView viewId={id} tab={homeTabOf(view)} />;
  if (view.type === "artifacts") return <ArtifactsView />;
  if (view.type === "graph") return <GraphView local={view.params?.local === true} />;
  if (view.type === "outline") return <OutlineView />;
  if (view.type === "dead-links") return <DeadLinksView />;
  if (view.type === "info") return <InfoView />;
  const noteId = noteIdOf(id);
  return noteId ? <NoteViewBody noteId={noteId} /> : null;
}

function renderNotesView(id: string, view: ViewState): ReactNode {
  const content = viewContent(id, view);
  return content === null ? null : <KeptWhileHidden viewId={id}>{content}</KeptWhileHidden>;
}

function openTag(tag: string, showSidebar: () => void): void {
  filterByTag(tag);
  showSidebar();
}

export function NotesWorkspace({
  initialNoteId = null,
  initialFragment = null,
  requestedNoteId = null,
  requestedFragment = null,
  onRequestHandled,
  onExit,
  onNewNote,
  onCreateProject,
  onSendToPaper,
}: Readonly<NotesWorkspaceProps>) {
  const { t } = useTranslation(["notes", "common"]);
  const data = useNotesData();
  const research = data.researchTasks !== false;
  const [initial] = useState(() => {
    const saved = readNotesLayout();
    if (!initialNoteId) return { layout: saved, focused: stageGroup(saved, null).active };
    const viewId = noteViewId(initialNoteId);
    const opened = openNoteIn(saved, initialNoteId, null);
    return { layout: opened, focused: viewId };
  });
  const [layout, setLayout] = useState<WorkspaceLayout>(initial.layout);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [focused, setFocused] = useState<string | null>(initial.focused);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [insertRequest, setInsertRequest] = useState<InsertRequest | null>(null);
  const [headingRequest, setHeadingRequest] = useState<HeadingRequest | null>(() =>
    initialNoteId && initialFragment ? { noteId: initialNoteId, slug: initialFragment, id: 1 } : null,
  );
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(null);
  const [paperText, setPaperText] = useState<{ text: string; noteId: string } | null>(null);
  const [paperId, setPaperId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [vaultDialog, setVaultDialog] = useState<"import" | "export" | null>(null);
  const [infoTarget, setInfoTarget] = useState<HTMLElement | null>(null);
  const infoInPanel = useInfoInPanel();
  const fullscreen = useFullscreen();
  const paperFieldId = useId();
  const chosenPaper = data.papers.some((paper) => paper.id === paperId) ? paperId : (data.papers[0]?.id ?? "");

  const pendingSave = useRef<WorkspaceLayout | null>(null);
  useEffect(() => {
    pendingSave.current = layout;
    const timer = window.setTimeout(() => {
      pendingSave.current = null;
      saveNotesLayout(layout);
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [layout]);
  useEffect(() => {
    const flush = () => {
      if (pendingSave.current) saveNotesLayout(pendingSave.current);
      pendingSave.current = null;
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  useEffect(() => {
    if (!research) setLayout(withoutView(ARTIFACTS_VIEW));
  }, [research]);
  useEffect(() => {
    if (!infoInPanel) setLayout(withoutView(INFO_VIEW));
  }, [infoInPanel]);

  const shownKey = visibleViews(layout).join("\n");
  const shown = useMemo<ReadonlySet<string>>(() => new Set(shownKey.split("\n")), [shownKey]);

  const focusedNoteId = useMemo(() => {
    const direct = noteShownIn(layout, noteIdOf(focused));
    if (direct) return direct;
    const owner = focused ? groupOfView(layout, focused) : null;
    const nearby = noteIdOf(owner?.active) ?? noteIdOf(openNoteViews(layout)[0]);
    return nearby;
  }, [focused, layout]);
  const openedNoteId = noteIdOf(focused);
  useEffect(() => {
    if (openedNoteId) useNotesPrefsStore.getState().recordOpened(openedNoteId);
  }, [openedNoteId]);
  const focusedNote = data.notes.find((note) => note.id === focusedNoteId) ?? null;
  useLiveNoteClaim(layout, noteShownIn(layout, noteIdOf(focused)), data.notes);
  const artifactCount = artifactsForNote(data.artifacts, focusedNote).length;
  const artifactsOpen = ARTIFACTS_VIEW in layout.views;

  const openNoteAt = useCallback((id: string, groupId: string | null) => {
    setLayout((current) => openNoteIn(current, id, groupId));
    setFocused(noteViewId(id));
  }, []);
  const openNote = useCallback((id: string) => openNoteAt(id, null), [openNoteAt]);
  const openNoteHeading = useCallback(
    (id: string, slug: string) => {
      openNoteAt(id, null);
      setHeadingRequest((previous) => ({ noteId: id, slug, id: (previous?.id ?? 0) + 1 }));
    },
    [openNoteAt],
  );
  useEffect(() => {
    if (!requestedNoteId) return;
    if (requestedFragment) openNoteHeading(requestedNoteId, requestedFragment);
    else openNote(requestedNoteId);
    onRequestHandled?.();
  }, [onRequestHandled, openNote, openNoteHeading, requestedFragment, requestedNoteId]);

  const closeTab = useCallback((viewId: string) => {
    const owner = groupOfView(layoutRef.current, viewId);
    setLayout((current) => closeView(current, viewId));
    if (!owner) return;
    const next = closeView(layoutRef.current, viewId);
    const neighbour = groupsOf(next.root).find((candidate) => candidate.id === owner.id)?.active;
    if (neighbour && neighbour in next.views) setFocused((now) => (now === viewId ? neighbour : now));
  }, []);
  const removeNote = data.deleteNote;
  const deleteNote = useMemo(
    () =>
      removeNote &&
      (async (id: string) => {
        await removeNote(id);
        closeTab(noteViewId(id));
      }),
    [closeTab, removeNote],
  );
  const scopedData = useMemo(() => (deleteNote ? { ...data, deleteNote } : data), [data, deleteNote]);
  const showSidebar = useCallback(() => setSidebarOpen(true), []);
  const openSearch = useCallback(() => {
    flushSync(() => setSidebarOpen(true));
    focusNotesSearch();
  }, []);
  const onOpenTag = useCallback((tag: string) => openTag(tag, showSidebar), [showSidebar]);

  const openFromHome = useCallback((homeId: string, noteId: string) => {
    const scroll = noteScroll(homeId);
    setLayout((current) => recordVisit(current, openNoteInPlace(current, homeId, noteId), homeId, noteViewId(noteId), scroll));
    setFocused(noteViewId(noteId));
  }, []);
  const chooseHomeTab = useCallback((homeId: string, tab: HomeTab) => {
    setLayout((current) => recordVisit(current, showHomeTab(current, homeId, tab), homeId, homeId));
  }, []);
  const openHomeHere = useCallback((viewId: string) => {
    const home = newHomeViewId(layoutRef.current);
    const scroll = noteScroll(viewId);
    setLayout((current) => recordVisit(current, openHomeInPlace(current, viewId, home), viewId, home, scroll));
    setFocused(home);
  }, []);
  const travelTo = useCallback((viewId: string, index: number) => {
    const next = travel(layoutRef.current, viewId, index, noteScroll(viewId));
    if (!next) return;
    setLayout(next.layout);
    setFocused(next.viewId);
    const noteId = noteIdOf(next.place.view);
    if (noteId) setScrollRequest((previous) => ({ noteId, top: next.place.scroll ?? 0, id: (previous?.id ?? 0) + 1 }));
  }, []);

  const showArtifacts = useCallback(() => {
    setLayout((current) => {
      if (ARTIFACTS_VIEW in current.views) return activate(current, ARTIFACTS_VIEW);
      const stage = stageGroup(current, focusedNoteId ? noteViewId(focusedNoteId) : null);
      return openView(current, ARTIFACTS_VIEW, { type: "artifacts" }, { groupId: stage.id, zone: "right" }, ARTIFACTS_SHARE);
    });
  }, [focusedNoteId]);

  const toggleArtifacts = () => {
    if (artifactsOpen) setLayout((current) => closeView(current, ARTIFACTS_VIEW));
    else showArtifacts();
  };

  const openArtifact = useCallback(
    (artifact: ArtifactItem) => {
      const owner = noteForProject(data.notes, artifact.projectId);
      if (!owner) return;
      openNote(owner.id);
      setArtifactId(artifact.id);
      setLayout((current) => {
        if (ARTIFACTS_VIEW in current.views) return activate(current, ARTIFACTS_VIEW);
        const stage = stageGroup(current, noteViewId(owner.id));
        return openView(current, ARTIFACTS_VIEW, { type: "artifacts" }, { groupId: stage.id, zone: "right" }, ARTIFACTS_SHARE);
      });
    },
    [data.notes, openNote],
  );

  const copyArtifact = data.copyArtifact;
  const insertNoteId = focusedNote?.id ?? null;
  const insertArtifact = useMemo(
    () =>
      insertNoteId && copyArtifact
        ? async (artifact: ArtifactItem) => {
            const path = await copyArtifact(insertNoteId, artifact);
            const snippet = artifactSnippet(artifact, path);
            setInsertRequest((previous) => ({ noteId: insertNoteId, snippet, id: (previous?.id ?? 0) + 1 }));
          }
        : undefined,
    [copyArtifact, insertNoteId],
  );

  const canSend = onSendToPaper !== undefined && data.papers.length > 0;
  const sendToPaper = canSend ? setPaperText : undefined;

  const actions = useMemo<WorkspaceActions>(
    () => ({
      focusedNoteId: insertNoteId,
      artifactId,
      setArtifactId,
      openNote,
      openNoteHeading,
      openFromHome,
      chooseHomeTab,
      insertArtifact,
      newProject: onCreateProject,
      newNoteFromHome: onNewNote
        ? (homeId) =>
            void onNewNote().then((id) => {
              if (id) openFromHome(homeId, id);
            })
        : undefined,
      importFolder: () => setVaultDialog("import"),
    }),
    [artifactId, chooseHomeTab, insertArtifact, insertNoteId, onCreateProject, onNewNote, openFromHome, openNote, openNoteHeading],
  );

  const heldViews = useRef(new Set<string>());
  const holdView = useCallback((viewId: string, held: boolean) => {
    if (held) heldViews.current.add(viewId);
    else heldViews.current.delete(viewId);
  }, []);
  const canRelease = useCallback((viewId: string) => !heldViews.current.has(viewId), []);

  const noteActions = useMemo<NoteViewActions>(
    () => ({
      insertRequest,
      holdView,
      headingRequest,
      scrollRequest,
      openNote,
      openNoteHeading,
      openTag: onOpenTag,
      closeTab,
      openHomeHere,
      newProject: onCreateProject,
      sendToPaper,
    }),
    [closeTab, headingRequest, holdView, insertRequest, onCreateProject, onOpenTag, openHomeHere, openNote, openNoteHeading, scrollRequest, sendToPaper],
  );

  const focusedNoteView = focusedNoteId ? noteViewId(focusedNoteId) : null;
  const toggleSide = useCallback(
    (viewId: string) => setLayout((current) => toggleSideView(current, viewId, focusedNoteView)),
    [focusedNoteView],
  );
  const openGraph = useCallback(() => {
    setLayout((current) => openGraphIn(current, focusedNoteView));
    setFocused(GRAPH_VIEW);
  }, [focusedNoteView]);
  const openDeadLinks = useCallback(() => {
    setLayout((current) => openDeadLinksIn(current, focusedNoteView));
    setFocused(DEAD_LINKS_VIEW);
  }, [focusedNoteView]);
  const sideActions = useMemo<SideActions>(
    () => ({
      openNoteFrom: (id) => {
        const from = stageGroup(layoutRef.current, focusedNoteView).active;
        const scroll = noteScroll(from);
        setLayout((current) => recordVisit(current, openNoteFrom(current, id, focusedNoteView), from, noteViewId(id), scroll));
        setFocused(noteViewId(id));
      },
      openProject: data.openProject,
      sideOpen: (viewId) => viewId in layout.views,
      toggleSide,
      infoTarget,
      setInfoTarget,
    }),
    [data.openProject, focusedNoteView, infoTarget, layout.views, toggleSide],
  );
  const newNoteRef = useRef<(() => void) | undefined>(undefined);
  const stepRef = useRef<(direction: HistoryDirection) => void>(() => undefined);
  useEffect(() => {
    const onMouse = (event: MouseEvent) => {
      const direction = MOUSE_STEPS[event.button];
      if (!direction) return;
      event.preventDefault();
      stepRef.current(direction);
    };
    window.addEventListener("mouseup", onMouse);
    return () => window.removeEventListener("mouseup", onMouse);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const { bindings } = useShortcutStore.getState();
      let handled = true;
      if (matchesShortcut(event, bindings.notesGraph)) openGraph();
      else if (matchesShortcut(event, bindings.notesLocalGraph)) toggleSide(LOCAL_GRAPH_VIEW);
      else if (matchesShortcut(event, bindings.notesOutline)) toggleSide(OUTLINE_VIEW);
      else if (matchesShortcut(event, bindings.notesSearch)) openSearch();
      else if (newNoteRef.current && matchesShortcut(event, bindings.notesNewNote)) newNoteRef.current();
      else if (matchesShortcut(event, bindings.notesBack)) stepRef.current(-1);
      else if (matchesShortcut(event, bindings.notesForward)) stepRef.current(1);
      else handled = false;
      if (handled) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openGraph, openSearch, toggleSide]);

  const openInPlace = useCallback(
    (id: string) => {
      if (focused && layout.views[focused]) openFromHome(focused, id);
      else openNote(id);
    },
    [focused, layout.views, openFromHome, openNote],
  );
  const openToday = useOpenDailyNote(openNote);

  const goNotesHome = useCallback(() => {
    const home = homeViews(layout)[0] ?? HOME_VIEW;
    setLayout((current) => openHomeIn(current, home, stageGroup(current, null).id));
    setFocused(home);
  }, [layout]);
  const goHome = onExit ?? goNotesHome;
  const homeLabel = onExit ? undefined : t(($) => $.notes.workspace.notesHome);

  const newTab = useCallback(
    (groupId: string) => {
      const home = newHomeViewId(layout);
      setLayout((current) => openHomeIn(current, home, groupId));
      setFocused(home);
    },
    [layout],
  );

  const newNote = useMemo(
    () =>
      onNewNote
        ? (groupId: string | null) => {
            void onNewNote().then((id) => {
              if (id) openNoteAt(id, groupId);
            });
          }
        : undefined,
    [onNewNote, openNoteAt],
  );
  const newNoteHere = useMemo(() => (newNote ? () => newNote(null) : undefined), [newNote]);
  newNoteRef.current = newNoteHere;
  const openImport = useCallback(() => setVaultDialog("import"), []);
  const openExport = useCallback(() => setVaultDialog("export"), []);
  const iconFor = useCallback((item: NoteItem) => item.icon, []);
  const tabNotes = useNotesByLook(data.notes);

  const describeView = useCallback(
    (id: string, view: ViewState): ViewInfo => {
      if (view.type === "home") return { title: t(($) => $.notes.workspace.home), icon: <House aria-hidden className="size-3.5 shrink-0" /> };
      if (view.type === "artifacts") {
        return { title: t(($) => $.notes.artifacts.title), icon: <PanelRight aria-hidden className="size-3.5 shrink-0" /> };
      }
      if (view.type === "graph") {
        return {
          title: view.params?.local === true ? t(($) => $.notes.graph.localTitle) : t(($) => $.notes.graph.title),
          icon: <Waypoints aria-hidden className="size-3.5 shrink-0" />,
        };
      }
      if (view.type === "outline") {
        return { title: t(($) => $.notes.graph.outline.title), icon: <TableOfContents aria-hidden className="size-3.5 shrink-0" /> };
      }
      if (view.type === "dead-links") {
        return { title: t(($) => $.notes.linksSearch.dead.title), icon: <Link2Off aria-hidden className="size-3.5 shrink-0" /> };
      }
      if (view.type === "info") return { title: t(($) => $.notes.info.title), icon: <Info aria-hidden className="size-3.5 shrink-0" /> };
      const note = tabNotes.find((candidate) => candidate.id === noteIdOf(id));
      return {
        title: note?.title ?? t(($) => $.notes.document.untitled),
        icon: note ? (
          <NoteChip icon={note.icon} color={note.color} size="xs" />
        ) : (
          <FileText aria-hidden className="size-3.5 shrink-0" />
        ),
      };
    },
    [tabNotes, t],
  );

  const currentTab = stageGroup(layout, focused).active;
  const history = currentTab ? tabHistory(layout, currentTab) : null;
  const noteIds = useMemo(() => new Set(data.notes.map((note) => note.id)), [data.notes]);
  const exists = (entry: NotesPlace) => {
    const noteId = noteIdOf(entry.view);
    return noteId === null || noteIds.has(noteId);
  };
  const { back: backIndexes, forward: forwardIndexes } = historySteps(history, exists);
  stepRef.current = (direction) => {
    const index = (direction < 0 ? backIndexes : forwardIndexes)[0];
    if (currentTab && index !== undefined) travelTo(currentTab, index);
  };
  const historyItems = (indexes: readonly number[]): HistoryItem[] =>
    history
      ? indexes.slice(0, HISTORY_MENU_ITEMS).map((index) => {
          const entry = history.entries[index];
          const info = describeView(entry.view, placeView(entry));
          const tab = entry.tab && entry.tab !== "mine" ? entry.tab : null;
          return { index, title: tab ? t(($) => $.notes.home.tabs[tab]) : info.title, icon: info.icon };
        })
      : [];
  const jump = (index: number) => {
    if (currentTab) travelTo(currentTab, index);
  };

  const labels = useMemo(
    () => ({
      closeTab: (title: string) => t(($) => $.notes.workspace.closeTab, { title }),
      closePanel: t(($) => $.notes.workspace.closePanel),
      newTab: t(($) => $.notes.workspace.newTab),
      maximize: t(($) => $.notes.workspace.maximize),
      restore: t(($) => $.notes.workspace.restore),
      resize: t(($) => $.notes.workspace.resize),
    }),
    [t],
  );

  const onFocusView = useCallback((id: string) => {
    if (!isSideView(id)) setFocused(id);
  }, []);

  const appearanceRef = useNotesAppearanceRef<HTMLDivElement>();
  const headerInset = !sidebarOpen && isMac && !fullscreen;
  const sidebarLabel = sidebarOpen ? t(($) => $.notes.workspace.hideSidebar) : t(($) => $.notes.workspace.showSidebar);

  return (
    <NotesDataProvider value={scopedData}>
      <ActionsContext.Provider value={actions}>
        <NoteActionsContext.Provider value={noteActions}>
          <SideContext.Provider value={sideActions}>
            <ShownContext.Provider value={shown}>
              <div ref={appearanceRef} className="flex h-full min-h-0 bg-background text-foreground">
                {sidebarOpen && (
                  <NotesLibrary
                    iconFor={iconFor}
                    activeNoteId={focusedNoteId}
                    activeArtifactId={artifactsOpen ? artifactId : null}
                    homeLabel={homeLabel}
                    onHome={goHome}
                    onNewNote={newNoteHere}
                    onOpenNote={openNote}
                    onOpenNoteInNewTab={openNote}
                    onOpenNoteAt={openNoteHeading}
                    onOpenArtifact={openArtifact}
                    onToday={openToday}
                    onOpenGraph={openGraph}
                    onImportFolder={openImport}
                    onExportFolder={openExport}
                    onOpenDeadLinks={openDeadLinks}
                  />
                )}
                <NotesVaultLayer onOpenNote={openInPlace} onOpenNoteInNewTab={openNote} onToday={openToday} />
                <main className="flex min-w-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1">
                    <Workspace
                      layout={layout}
                      onLayoutChange={setLayout}
                      renderView={renderNotesView}
                      describeView={describeView}
                      labels={labels}
                      renderTooltip={renderTooltip}
                      onFocusView={onFocusView}
                      onNewTab={newTab}
                      stageCandidate={holdsNotes}
                      keepHidden={KEPT_HIDDEN_VIEWS}
                      canRelease={canRelease}
                      chromeAttributes={WINDOW_DRAG}
                      leading={
                        <>
                          {headerInset && <span aria-hidden className="w-[70px] shrink-0" />}
                          {!sidebarOpen && <HomeBrandButton compact label={homeLabel} onClick={goHome} />}
                          <TooltipIconButton label={sidebarLabel} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>
                            <PanelLeft aria-hidden className="size-4" />
                          </TooltipIconButton>
                          <HistoryButton
                            label={t(($) => $.notes.workspace.back)}
                            shortcut="notesBack"
                            icon={<ArrowLeft aria-hidden className="size-4" />}
                            items={historyItems(backIndexes)}
                            onStep={() => stepRef.current(-1)}
                            onJump={jump}
                          />
                          <HistoryButton
                            label={t(($) => $.notes.workspace.forward)}
                            shortcut="notesForward"
                            icon={<ArrowRight aria-hidden className="size-4" />}
                            items={historyItems(forwardIndexes)}
                            onStep={() => stepRef.current(1)}
                            onJump={jump}
                          />
                        </>
                      }
                      trailing={
                        <>
                          {research && (
                            <TooltipIconButton
                              label={t(($) => $.notes.workspace.artifacts, { total: artifactCount })}
                              aria-pressed={artifactsOpen}
                              className={cn("relative", artifactsOpen && "bg-accent")}
                              onClick={toggleArtifacts}
                            >
                              <PanelRight aria-hidden className="size-4" />
                              {artifactCount > 0 && <Badge size="count">{artifactCount}</Badge>}
                            </TooltipIconButton>
                          )}
                          <WindowControls compact />
                        </>
                      }
                      empty={emptyPanelFor({ newTab, newNote, openNoteAt, openSearch })}
                    />
                  </div>
                </main>
                <NoteImportDialog open={vaultDialog === "import"} onClose={() => setVaultDialog(null)} onImported={() => void data.refreshNotes?.()} />
                {vaultDialog === "export" && (
                  <NoteExportDialog open note={focusedNote} total={data.notes.length} onClose={() => setVaultDialog(null)} />
                )}
                <Dialog open={paperText !== null} onOpenChange={(open) => !open && setPaperText(null)}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t(($) => $.notes.sendToPaper.title)}</DialogTitle>
                      <DialogDescription>{t(($) => $.notes.sendToPaper.description)}</DialogDescription>
                    </DialogHeader>
                    <p className="line-clamp-3 rounded-md border p-2 text-sm text-muted-foreground">{paperText?.text}</p>
                    <RadioGroup value={chosenPaper} onValueChange={setPaperId} className="gap-1">
                      {data.papers.map((paper) => (
                        <label key={paper.id} htmlFor={`${paperFieldId}-${paper.id}`} className="flex items-center gap-2 text-sm">
                          <RadioGroupItem id={`${paperFieldId}-${paper.id}`} value={paper.id} />
                          {paper.label}
                        </label>
                      ))}
                    </RadioGroup>
                    <DialogFooter>
                      <Button variant="ghost" onClick={() => setPaperText(null)}>
                        {t(($) => $.common.actions.cancel)}
                      </Button>
                      <Button
                        disabled={!onSendToPaper || !chosenPaper}
                        onClick={() => {
                          if (paperText !== null) onSendToPaper?.({ paperId: chosenPaper, ...paperText });
                          setPaperText(null);
                        }}
                      >
                        {t(($) => $.notes.sendToPaper.send)}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </ShownContext.Provider>
          </SideContext.Provider>
        </NoteActionsContext.Provider>
      </ActionsContext.Provider>
    </NotesDataProvider>
  );
}
