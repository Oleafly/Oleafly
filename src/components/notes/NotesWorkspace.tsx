import {
  activate,
  closeView,
  groupOfView,
  openView,
  Workspace,
  type ViewInfo,
  type ViewState,
  type WorkspaceLayout,
} from "@oleafly/workspace";
import { FileText, FolderPlus, House, PanelLeft, PanelRight, Plus, Send } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { HomeBrandButton } from "@/components/layout/HomeBrandButton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip } from "@/components/ui/tooltip";
import { useFullscreen } from "@/lib/use-fullscreen";
import { cn, isMac } from "@/lib/utils";
import { ArtifactPanel } from "./ArtifactPanel";
import { NewProjectDialog, type ProjectFormat, type ProjectSeed } from "./NewProjectDialog";
import { NoteDocument, type SaveStatus } from "./NoteDocument";
import { artifactSnippet, artifactsForNote, noteForProject } from "./note-artifacts";
import { NoteChip } from "./note-icons";
import { useNotesData } from "./notes-data";
import {
  ARTIFACTS_SHARE,
  ARTIFACTS_VIEW,
  HOME_VIEW,
  holdsNotes,
  homeViews,
  isHomeView,
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
import { RelatedProjectMenu } from "./RelatedProjectMenu";
import type { ArtifactItem, NoteItem } from "./types";
import "./notes.css";

interface NotesWorkspaceProps {
  initialNoteId?: string | null;
  onExit?: () => void;
  onNewNote?: () => Promise<string | null>;
  onStartNote?: (prompt: string) => void;
  onCreateProject?: (request: { seed: ProjectSeed; name: string; format: ProjectFormat; files: readonly string[] }) => void;
  onSendToPaper?: (request: { paperId: string; text: string }) => void;
}

interface InsertRequest {
  noteId: string;
  snippet: string;
  id: number;
}

interface WorkspaceActions {
  focusedNote: NoteItem | null;
  artifactId: string | null;
  insertRequest: InsertRequest | null;
  setArtifactId: (id: string) => void;
  openNote: (id: string) => void;
  closeTab: (viewId: string) => void;
  openFromHome: (homeId: string, noteId: string) => void;
  openArtifact: (artifact: ArtifactItem, homeId?: string) => void;
  insertArtifact?: (artifact: ArtifactItem) => Promise<void>;
  newProject?: (seed: ProjectSeed) => void;
  sendToPaper?: (text: string) => void;
  startNote?: (prompt: string) => void;
}

const ActionsContext = createContext<WorkspaceActions | null>(null);
const WINDOW_DRAG: Readonly<Record<string, string>> = { "data-tauri-drag-region": "" };
const SAVE_DELAY_MS = 150;

function useActions(): WorkspaceActions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("Notes views need the workspace actions");
  return actions;
}

function IconAction({
  label,
  children,
  className,
  ...props
}: Readonly<{ label: string; children: ReactNode } & ComponentProps<typeof Button>>) {
  return (
    <Tooltip label={label} side="bottom">
      <Button variant="ghost" size="icon" aria-label={label} className={cn("relative size-7", className)} {...props}>
        {children}
      </Button>
    </Tooltip>
  );
}

function NoteView({ noteId }: Readonly<{ noteId: string }>) {
  const { t } = useTranslation(["notes"]);
  const data = useNotesData();
  const actions = useActions();
  const [status, setStatus] = useState<SaveStatus>("saved");
  const note = data.notes.find((candidate) => candidate.id === noteId);
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
  const insertRequest = actions.insertRequest?.noteId === noteId ? actions.insertRequest : null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b px-2">
        <p className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
          <RelatedProjectMenu note={note} />
          <span aria-hidden>/</span>
          <span className="truncate text-foreground">{note.title}</span>
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <span aria-live="polite" className={cn("pr-2 text-xs", status === "failed" ? "text-destructive" : "text-muted-foreground")}>
            {status === "saved" && t(($) => $.notes.workspace.saved)}
            {status === "saving" && t(($) => $.notes.workspace.saving)}
            {status === "failed" && t(($) => $.notes.workspace.saveFailed)}
          </span>
          {actions.newProject && (
            <IconAction
              label={t(($) => $.notes.workspace.newProject)}
              onClick={() => actions.newProject?.({ noteId: note.id, artifactId: null })}
            >
              <FolderPlus aria-hidden className="size-4" />
            </IconAction>
          )}
          {actions.sendToPaper && (
            <IconAction label={t(($) => $.notes.workspace.sendToPaper)} onClick={() => actions.sendToPaper?.(note.summary)}>
              <Send aria-hidden className="size-4" />
            </IconAction>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <NoteDocument
          note={note}
          insertRequest={insertRequest}
          onSendToPaper={(text) => actions.sendToPaper?.(text)}
          onStatusChange={setStatus}
        />
      </div>
    </div>
  );
}

function ArtifactsView() {
  const { t } = useTranslation(["notes"]);
  const actions = useActions();
  const note = actions.focusedNote;
  if (!note) return <p className="p-4 text-sm text-muted-foreground">{t(($) => $.notes.artifacts.noNote)}</p>;
  return (
    <ArtifactPanel
      note={note}
      selectedId={actions.artifactId}
      onSelect={actions.setArtifactId}
      onInsert={actions.insertArtifact}
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
      onOpenArtifact={(artifact) => actions.openArtifact(artifact, viewId)}
      onStartNote={actions.startNote}
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

function renderNotesView(id: string, view: ViewState): ReactNode {
  if (view.type === "home") return <HomeView viewId={id} />;
  if (view.type === "artifacts") return <ArtifactsView />;
  const noteId = noteIdOf(id);
  return noteId ? <NoteView noteId={noteId} /> : null;
}

export function NotesWorkspace({
  initialNoteId = null,
  onExit,
  onNewNote,
  onStartNote,
  onCreateProject,
  onSendToPaper,
}: Readonly<NotesWorkspaceProps>) {
  const { t } = useTranslation(["notes", "common"]);
  const data = useNotesData();
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
  const [paperText, setPaperText] = useState<string | null>(null);
  const [paperId, setPaperId] = useState(data.papers[0]?.id ?? "");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [projectSeed, setProjectSeed] = useState<ProjectSeed | null>(null);
  const fullscreen = useFullscreen();
  const paperFieldId = useId();

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

  const focusedNoteId = useMemo(() => {
    const direct = noteIdOf(focused);
    if (direct && layout.views[noteViewId(direct)]) return direct;
    const owner = focused ? groupOfView(layout, focused) : null;
    const nearby = noteIdOf(owner?.active) ?? noteIdOf(openNoteViews(layout)[0]);
    return nearby;
  }, [focused, layout]);
  const focusedNote = data.notes.find((note) => note.id === focusedNoteId) ?? null;
  const artifactCount = artifactsForNote(data.artifacts, focusedNote).length;
  const artifactsOpen = ARTIFACTS_VIEW in layout.views;

  const openNoteAt = useCallback((id: string, groupId: string | null) => {
    setLayout((current) => openNoteIn(current, id, groupId));
    setFocused(noteViewId(id));
  }, []);
  const openNote = useCallback((id: string) => openNoteAt(id, null), [openNoteAt]);

  const closeTab = useCallback((viewId: string) => setLayout((current) => closeView(current, viewId)), []);

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
    (artifact: ArtifactItem, homeId?: string) => {
      const owner = noteForProject(data.notes, artifact.projectId);
      if (!owner) return;
      if (homeId) openFromHome(homeId, owner.id);
      else openNote(owner.id);
      setArtifactId(artifact.id);
      setLayout((current) => {
        if (ARTIFACTS_VIEW in current.views) return activate(current, ARTIFACTS_VIEW);
        const stage = stageGroup(current, noteViewId(owner.id));
        return openView(current, ARTIFACTS_VIEW, { type: "artifacts" }, { groupId: stage.id, zone: "right" }, ARTIFACTS_SHARE);
      });
    },
    [data.notes, openFromHome, openNote],
  );

  const copyArtifact = data.copyArtifact;
  const insertArtifact = useMemo(
    () =>
      focusedNote && copyArtifact
        ? async (artifact: ArtifactItem) => {
            const path = await copyArtifact(focusedNote.id, artifact);
            const snippet = artifactSnippet(artifact, path);
            setInsertRequest((previous) => ({ noteId: focusedNote.id, snippet, id: (previous?.id ?? 0) + 1 }));
          }
        : undefined,
    [copyArtifact, focusedNote],
  );

  const actions = useMemo<WorkspaceActions>(
    () => ({
      focusedNote,
      artifactId,
      insertRequest,
      setArtifactId,
      openNote,
      closeTab,
      openFromHome,
      openArtifact,
      insertArtifact,
      newProject: onCreateProject ? setProjectSeed : undefined,
      sendToPaper: onSendToPaper ? setPaperText : undefined,
      startNote: onStartNote,
    }),
    [
      artifactId,
      closeTab,
      focusedNote,
      insertArtifact,
      insertRequest,
      onCreateProject,
      onSendToPaper,
      onStartNote,
      openArtifact,
      openFromHome,
      openNote,
    ],
  );

  const goHome = () => {
    const onHome = focused !== null && isHomeView(focused) && groupOfView(layout, focused)?.active === focused;
    if (onHome && onExit) {
      onExit();
      return;
    }
    const home = homeViews(layout)[0] ?? HOME_VIEW;
    setLayout((current) => openHomeIn(current, home, stageGroup(current, null).id));
    setFocused(home);
  };

  const newTab = (groupId: string) => {
    const home = newHomeViewId(layout);
    setLayout((current) => openHomeIn(current, home, groupId));
    setFocused(home);
  };

  const newNote = onNewNote
    ? (groupId: string | null) => {
        void onNewNote().then((id) => {
          if (id) openNoteAt(id, groupId);
        });
      }
    : undefined;

  const describeView = useCallback(
    (id: string, view: ViewState): ViewInfo => {
      if (view.type === "home") return { title: t(($) => $.notes.workspace.home), icon: <House aria-hidden className="size-3.5 shrink-0" /> };
      if (view.type === "artifacts") {
        return { title: t(($) => $.notes.artifacts.title), icon: <PanelRight aria-hidden className="size-3.5 shrink-0" /> };
      }
      const note = data.notes.find((candidate) => candidate.id === noteIdOf(id));
      return {
        title: note?.title ?? t(($) => $.notes.document.untitled),
        icon: note ? (
          <NoteChip icon={note.icon} color={note.color} className="size-4 rounded" />
        ) : (
          <FileText aria-hidden className="size-3.5 shrink-0" />
        ),
      };
    },
    [data.notes, t],
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
    if (id !== ARTIFACTS_VIEW) setFocused(id);
  }, []);

  const headerInset = !sidebarOpen && isMac && !fullscreen;
  const sidebarLabel = sidebarOpen ? t(($) => $.notes.workspace.hideSidebar) : t(($) => $.notes.workspace.showSidebar);

  return (
    <ActionsContext.Provider value={actions}>
      <div className="flex h-full min-h-0 bg-background text-foreground">
        {sidebarOpen && (
          <NotesLibrary
            iconFor={(item) => item.icon}
            activeNoteId={focusedNoteId}
            activeArtifactId={artifactsOpen ? artifactId : null}
            onHome={goHome}
            onNewNote={newNote && (() => newNote(null))}
            onOpenNote={openNote}
            onOpenNoteInNewTab={openNote}
            onOpenArtifact={openArtifact}
          />
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <Workspace
              layout={layout}
              onLayoutChange={setLayout}
              renderView={renderNotesView}
              describeView={describeView}
              labels={labels}
              onFocusView={onFocusView}
              onNewTab={newTab}
              stageCandidate={holdsNotes}
              chromeAttributes={WINDOW_DRAG}
              leading={
                <>
                  {headerInset && <span aria-hidden className="w-[70px] shrink-0" />}
                  {!sidebarOpen && <HomeBrandButton compact onClick={goHome} />}
                  <IconAction label={sidebarLabel} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>
                    <PanelLeft aria-hidden className="size-4" />
                  </IconAction>
                </>
              }
              trailing={
                <IconAction
                  label={t(($) => $.notes.workspace.artifacts, { total: artifactCount })}
                  aria-pressed={artifactsOpen}
                  className={cn(artifactsOpen && "bg-accent")}
                  onClick={toggleArtifacts}
                >
                  <PanelRight aria-hidden className="size-4" />
                  {artifactCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full border border-background bg-primary px-1 text-[0.5625rem] font-bold text-primary-foreground">
                      {artifactCount}
                    </span>
                  )}
                </IconAction>
              }
              empty={(group) => (
                <EmptyPanel onNewNote={newNote && (() => newNote(group.id))} onHome={() => newTab(group.id)} />
              )}
            />
          </div>
        </main>
        {projectSeed && (
          <NewProjectDialog
            key={`${projectSeed.noteId}-${projectSeed.artifactId}`}
            seed={projectSeed}
            onClose={() => setProjectSeed(null)}
            onCreate={
              onCreateProject &&
              ((request) => {
                onCreateProject({ seed: projectSeed, ...request });
                setProjectSeed(null);
              })
            }
          />
        )}
        <Dialog open={paperText !== null} onOpenChange={(open) => !open && setPaperText(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t(($) => $.notes.sendToPaper.title)}</DialogTitle>
              <DialogDescription>{t(($) => $.notes.sendToPaper.description)}</DialogDescription>
            </DialogHeader>
            <p className="line-clamp-3 rounded-md border p-2 text-sm text-muted-foreground">{paperText}</p>
            <RadioGroup value={paperId} onValueChange={setPaperId} className="gap-1">
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
                disabled={!onSendToPaper || !paperId}
                onClick={() => {
                  if (paperText !== null) onSendToPaper?.({ paperId, text: paperText });
                  setPaperText(null);
                }}
              >
                {t(($) => $.notes.sendToPaper.send)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ActionsContext.Provider>
  );
}
