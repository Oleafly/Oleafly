import {
  activate,
  closeView,
  groupOfView,
  openView,
  visibleViews,
  Workspace,
  type RenderTooltip,
  type ViewInfo,
  type ViewState,
  type WorkspaceLayout,
} from "@oleafly/workspace";
import { FileText, FolderPlus, House, PanelLeft, PanelRight, Plus, Send, TableOfContents, Waypoints } from "lucide-react";
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
import { lazy } from "@/lib/preloadable";
import { useTranslation } from "react-i18next";
import { HomeBrandButton } from "@/components/layout/HomeBrandButton";
import { WindowControls } from "@/components/layout/WindowControls";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip } from "@/components/ui/tooltip";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { flushOpenNotes } from "@/lib/open-note-editors";
import { useFullscreen } from "@/lib/use-fullscreen";
import { cn, isMac } from "@/lib/utils";
import { matchesShortcut, shortcutLabel, type ShortcutId, useShortcutStore } from "@/store/shortcuts";
import { ArtifactPanel } from "./ArtifactPanel";
import { NoteDocument, type NoteSaveFailure, type SaveStatus } from "./NoteDocument";
import { NoteLiveHeader } from "./NotePresence";
import { NoteSaveStatus } from "./NoteSaveStatus";
import { useLiveNoteClaim, useNoteLiveMode, useNoteReadOnly } from "./use-note-live";
import { artifactSnippet, artifactsForNote, noteForProject } from "./note-artifacts";
import { noteBody } from "./note-file";
import { useRecordNoteOpened } from "./note-home-prefs";
import { NoteChip } from "./note-icons";
import { useNotesByLook } from "./note-signature";
import { NoteExportDialog, NoteImportDialog } from "./NoteImportDialog";
import { NoteOutline } from "./NoteOutline";
import { NotesDataProvider, useNotesData } from "./notes-data";
import {
  ARTIFACTS_SHARE,
  ARTIFACTS_VIEW,
  GRAPH_VIEW,
  HOME_VIEW,
  holdsNotes,
  homeViews,
  isHomeView,
  isSideView,
  LOCAL_GRAPH_VIEW,
  OUTLINE_VIEW,
  openGraphIn,
  openNoteFrom,
  toggleSideView,
  newHomeViewId,
  noteIdOf,
  noteViewId,
  openHomeIn,
  openNoteIn,
  openNoteInPlace,
  openNoteViews,
  readNotesLayout,
  saveNotesLayout,
  stageGroup,
} from "./notes-layout";
import { NotesHome } from "./NotesHome";
import { NotesLibrary } from "./NotesLibrary";
import { NotesVaultLayer } from "./QuickSwitcher";
import { useOpenDailyNote } from "./daily-note";
import { filterByTag } from "./vault-store";
import { RelatedProjectMenu } from "./RelatedProjectMenu";
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
  requestedNoteId?: string | null;
  onRequestHandled?: () => void;
  onExit?: () => void;
  onNewNote?: () => Promise<string | null>;
  onCreateProject?: (seed: ProjectSeed) => void;
  onSendToPaper?: (request: { paperId: string; text: string }) => void;
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

interface WorkspaceActions {
  focusedNoteId: string | null;
  artifactId: string | null;
  setArtifactId: (id: string) => void;
  openNote: (id: string) => void;
  openNoteHeading: (id: string, slug: string) => void;
  openFromHome: (homeId: string, noteId: string) => void;
  insertArtifact?: (artifact: ArtifactItem) => Promise<void>;
  newProject?: (seed: ProjectSeed) => void;
  newNoteFromHome?: (homeId: string) => void;
}

interface NoteViewActions {
  insertRequest: InsertRequest | null;
  holdView: (viewId: string, held: boolean) => void;
  headingRequest: HeadingRequest | null;
  openNote: (id: string) => void;
  openNoteHeading: (id: string, slug: string) => void;
  openTag: (tag: string) => void;
  closeTab: (viewId: string) => void;
  newProject?: (seed: ProjectSeed) => void;
  sendToPaper?: (text: string) => void;
}

interface SideActions {
  openNoteFrom: (id: string) => void;
  openProject?: (projectId: string) => void;
  sideOpen: (viewId: string) => boolean;
  toggleSide: (viewId: string) => void;
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

function useShortcut(id: ShortcutId): string {
  return useShortcutStore((state) => shortcutLabel(state.bindings[id]));
}

function SideToggles() {
  const { t } = useTranslation(["notes", "shell"]);
  const side = useSideActions();
  const outline = side.sideOpen(OUTLINE_VIEW);
  const local = side.sideOpen(LOCAL_GRAPH_VIEW);
  const outlineKeys = useShortcut("notesOutline");
  const localKeys = useShortcut("notesLocalGraph");
  const outlineLabel = outline ? t(($) => $.notes.graph.hideOutline) : t(($) => $.notes.graph.showOutline);
  const localLabel = local ? t(($) => $.notes.graph.hideLocal) : t(($) => $.notes.graph.showLocal);
  return (
    <>
      <TooltipIconButton
        label={outlineLabel}
        tooltip={t(($) => $.shell.rail.withShortcut, { label: outlineLabel, shortcut: outlineKeys })}
        aria-pressed={outline}
        className={cn(outline && "bg-accent")}
        onClick={() => side.toggleSide(OUTLINE_VIEW)}
      >
        <TableOfContents aria-hidden className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        label={localLabel}
        tooltip={t(($) => $.shell.rail.withShortcut, { label: localLabel, shortcut: localKeys })}
        aria-pressed={local}
        className={cn(local && "bg-accent")}
        onClick={() => side.toggleSide(LOCAL_GRAPH_VIEW)}
      >
        <Waypoints aria-hidden className="size-4" />
      </TooltipIconButton>
    </>
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

function OutlineView() {
  const actions = useActions();
  return <NoteOutline noteId={actions.focusedNoteId} onOpenHeading={actions.openNoteHeading} />;
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

const NoteViewBody = memo(function NoteViewBody({ noteId }: Readonly<{ noteId: string }>) {
  const { t } = useTranslation(["notes"]);
  const data = useNotesData();
  const actions = useNoteViewActions();
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
  const { loadNote } = data;
  const sendToPaper = actions.sendToPaper;
  const sendNote = useCallback(async () => {
    if (!sendToPaper) return;
    await flushOpenNotes();
    sendToPaper(noteBody((await loadNote(noteId)).text).trim());
  }, [loadNote, noteId, sendToPaper]);
  if (!note) {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-muted-foreground">{t(($) => $.notes.workspace.missing)}</p>
        <Button variant="outline" size="sm" onClick={() => actions.closeTab(noteViewId(noteId))}>
          {t(($) => $.notes.workspace.closeMissing)}
        </Button>
      </div>
    );
  }
  const showStatus = liveMode !== "live" || save.status === "failed";
  return (
    <div className="flex h-full min-h-0 flex-col" data-note-view={note.id}>
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b px-2">
        <p className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
          <RelatedProjectMenu note={note} />
          <span aria-hidden>/</span>
          <span className="truncate text-foreground">{note.title}</span>
        </p>
        <div className="flex min-w-0 shrink-0 items-center gap-1">
          {showStatus && <NoteSaveStatus status={save.status} failure={save.failure} className="max-w-[18rem] pr-2" />}
          <NoteLiveHeader noteId={note.id} mode={liveMode} onShare={data.shareNote && (() => data.shareNote?.(note.id))} />
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
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <MemoNoteDocument
          note={note}
          insertRequest={insertRequest}
          onSendToPaper={sendToPaper}
          onStatusChange={onStatusChange}
          onOpenNote={onOpenNote}
          onOpenTag={actions.openTag}
          openHeading={openHeading}
          onClose={onClose}
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
  if (!note) return <p className="p-4 text-sm text-muted-foreground">{t(($) => $.notes.artifacts.noNote)}</p>;
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

function HomeView({ viewId }: Readonly<{ viewId: string }>) {
  const actions = useActions();
  return (
    <NotesHome
      iconFor={(item) => item.icon}
      onOpenNote={(noteId) => actions.openFromHome(viewId, noteId)}
      onOpenNoteInNewTab={actions.openNote}
      onNewNote={actions.newNoteFromHome && (() => actions.newNoteFromHome?.(viewId))}
    />
  );
}

function EmptyPanel({ onNewNote, onHome }: Readonly<{ onNewNote?: () => void; onHome: () => void }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground">{t(($) => $.notes.workspace.emptyPanel)}</p>
      <div className="flex items-center gap-2">
        {onNewNote && (
          <Button size="sm" onClick={onNewNote}>
            <Plus aria-hidden />
            {t(($) => $.notes.library.newNote)}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onHome}>
          <House aria-hidden />
          {t(($) => $.notes.workspace.home)}
        </Button>
      </div>
    </div>
  );
}

function viewContent(id: string, view: ViewState): ReactNode {
  if (view.type === "home") return <HomeView viewId={id} />;
  if (view.type === "artifacts") return <ArtifactsView />;
  if (view.type === "graph") return <GraphView local={view.params?.local === true} />;
  if (view.type === "outline") return <OutlineView />;
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
  requestedNoteId = null,
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
  const [focused, setFocused] = useState<string | null>(initial.focused);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [insertRequest, setInsertRequest] = useState<InsertRequest | null>(null);
  const [headingRequest, setHeadingRequest] = useState<HeadingRequest | null>(null);
  const [paperText, setPaperText] = useState<string | null>(null);
  const [paperId, setPaperId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [vaultDialog, setVaultDialog] = useState<"import" | "export" | null>(null);
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
    if (!research) setLayout((current) => (ARTIFACTS_VIEW in current.views ? closeView(current, ARTIFACTS_VIEW) : current));
  }, [research]);

  const shownKey = visibleViews(layout).join("\n");
  const shown = useMemo<ReadonlySet<string>>(() => new Set(shownKey.split("\n")), [shownKey]);

  const focusedNoteId = useMemo(() => {
    const direct = noteIdOf(focused);
    if (direct && layout.views[noteViewId(direct)]) return direct;
    const owner = focused ? groupOfView(layout, focused) : null;
    const nearby = noteIdOf(owner?.active) ?? noteIdOf(openNoteViews(layout)[0]);
    return nearby;
  }, [focused, layout]);
  useRecordNoteOpened(noteIdOf(focused));
  const focusedNote = data.notes.find((note) => note.id === focusedNoteId) ?? null;
  const directNoteId = noteIdOf(focused);
  useLiveNoteClaim(layout, directNoteId && layout.views[noteViewId(directNoteId)] ? directNoteId : null, data.notes);
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
    openNote(requestedNoteId);
    onRequestHandled?.();
  }, [onRequestHandled, openNote, requestedNoteId]);

  const closeTab = useCallback((viewId: string) => setLayout((current) => closeView(current, viewId)), []);
  const showSidebar = useCallback(() => setSidebarOpen(true), []);
  const onOpenTag = useCallback((tag: string) => openTag(tag, showSidebar), [showSidebar]);

  const openFromHome = useCallback((homeId: string, noteId: string) => {
    setLayout((current) => openNoteInPlace(current, homeId, noteId));
    setFocused(noteViewId(noteId));
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
      insertArtifact,
      newProject: onCreateProject,
      newNoteFromHome: onNewNote
        ? (homeId) =>
            void onNewNote().then((id) => {
              if (id) openFromHome(homeId, id);
            })
        : undefined,
    }),
    [artifactId, insertArtifact, insertNoteId, onCreateProject, onNewNote, openFromHome, openNote, openNoteHeading],
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
      openNote,
      openNoteHeading,
      openTag: onOpenTag,
      closeTab,
      newProject: onCreateProject,
      sendToPaper,
    }),
    [closeTab, headingRequest, holdView, insertRequest, onCreateProject, onOpenTag, openNote, openNoteHeading, sendToPaper],
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
  const sideActions = useMemo<SideActions>(
    () => ({
      openNoteFrom: (id) => {
        setLayout((current) => openNoteFrom(current, id, focusedNoteView));
        setFocused(noteViewId(id));
      },
      openProject: data.openProject,
      sideOpen: (viewId) => viewId in layout.views,
      toggleSide,
    }),
    [data.openProject, focusedNoteView, layout.views, toggleSide],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const { bindings } = useShortcutStore.getState();
      let handled = true;
      if (matchesShortcut(event, bindings.notesGraph)) openGraph();
      else if (matchesShortcut(event, bindings.notesLocalGraph)) toggleSide(LOCAL_GRAPH_VIEW);
      else if (matchesShortcut(event, bindings.notesOutline)) toggleSide(OUTLINE_VIEW);
      else handled = false;
      if (handled) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openGraph, toggleSide]);

  const openInPlace = useCallback(
    (id: string) => {
      if (focused && layout.views[focused]) openFromHome(focused, id);
      else openNote(id);
    },
    [focused, layout.views, openFromHome, openNote],
  );
  const openToday = useOpenDailyNote(openNote);

  const onNotesHome = focused !== null && isHomeView(focused) && groupOfView(layout, focused)?.active === focused;
  const goHome = useCallback(() => {
    if (onNotesHome && onExit) {
      onExit();
      return;
    }
    const home = homeViews(layout)[0] ?? HOME_VIEW;
    setLayout((current) => openHomeIn(current, home, stageGroup(current, null).id));
    setFocused(home);
  }, [layout, onExit, onNotesHome]);
  const homeLabel = onNotesHome && onExit ? undefined : t(($) => $.notes.workspace.notesHome);

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
      const note = tabNotes.find((candidate) => candidate.id === noteIdOf(id));
      return {
        title: note?.title ?? t(($) => $.notes.document.untitled),
        icon: note ? (
          <NoteChip icon={note.icon} color={note.color} className="size-4 rounded" />
        ) : (
          <FileText aria-hidden className="size-3.5 shrink-0" />
        ),
      };
    },
    [tabNotes, t],
  );

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
                  onOpenArtifact={openArtifact}
                  onToday={openToday}
                  onOpenGraph={openGraph}
                  onImportFolder={openImport}
                  onExportFolder={openExport}
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
                            {artifactCount > 0 && (
                              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full border border-background bg-primary px-1 text-[0.5625rem] font-bold text-primary-foreground">
                                {artifactCount}
                              </span>
                            )}
                          </TooltipIconButton>
                        )}
                        <WindowControls compact />
                      </>
                    }
                    empty={(group) => <EmptyPanel onNewNote={newNote && (() => newNote(group.id))} onHome={() => newTab(group.id)} />}
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
                  <p className="line-clamp-3 rounded-md border p-2 text-sm text-muted-foreground">{paperText}</p>
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
                        if (paperText !== null) onSendToPaper?.({ paperId: chosenPaper, text: paperText });
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
  );
}
