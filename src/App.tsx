import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { RefreshCw } from "lucide-react";
import { ThemeProvider } from "@/lib/theme";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TopToolbar } from "@/components/layout/TopToolbar";
import { BackendProtocolBanner } from "@/components/layout/BackendProtocolBanner";
import { BrowserPane } from "@/components/dock/BrowserPane";
import { TerminalPane } from "@/components/dock/TerminalPane";
import { Editor } from "@/components/editor/Editor";
import { editorUndo, editorRedo } from "@/components/editor/cm/controller";
import { PreviewPane } from "@/components/preview/PreviewPane";
import { PdfImportView } from "@/components/import/PdfImportView";
import { Sidebar } from "@/components/layout/Sidebar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { SearchOmnibar } from "@/components/layout/SearchOmnibar";
import { GlobalNewProject } from "@/components/library/GlobalNewProject";
import { BibtexToolView } from "@/components/tools/BibtexToolView";
import { TableToolView } from "@/components/tools/TableToolView";
import { DeadlinesView } from "@/components/deadlines/DeadlinesView";
import { LatexToolsView } from "@/components/tools/LatexToolsView";
import { LabSearchToolView } from "@/components/tools/LabSearchToolView";
import { useHomeViewStore } from "@/store/home-view";
import {
  LanguageServiceRuntimeBoundary,
  LanguageServiceRuntimeUnavailable,
} from "@/components/editor/LanguageServiceRuntimeBoundary";
import { Library } from "@/components/library/Library";
import { dismissBootSplash, markBootStage } from "@/lib/boot-telemetry";
import { useFilesStore, useActiveContent } from "@/store/files";
import {
  isCompileCheckpointCurrent,
  useCompileStore,
} from "@/store/compile";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { usePreflightStore } from "@/store/preflight";
import { useSettingsStore } from "@/store/settings";
import { subscribeToComputerUseStarts } from "@/lib/agent-item-effects";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";
import { useTourStore } from "@/store/tours";
import { resetOpenCompileMarker, shouldCompileOnOpen } from "@/lib/open-compile";
import { useGitStatusStore } from "@/store/git-status";
import { useGithubStore } from "@/store/github";
import { forwardFromCursor } from "@/features/synctex";
import { checkForUpdatesOnStartup, openUpdateWindow } from "@/lib/updater";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";
import { ExternalToolApprovals } from "@/components/ai/ExternalToolApprovals";
import { ChatPanel } from "@/components/ai/ChatPanel";
import { AboutModal } from "@/components/layout/AboutModal";
import { EnginePickerModal } from "@/components/layout/EnginePickerModal";
import { TinytexGuards } from "@/components/layout/TinytexGuards";
import { QuitGuard } from "@/components/layout/QuitGuard";
import { COMPILE_SUCCEEDED_EVENT } from "@/lib/compile-checkpoint";
import { applyRemoteCompileSuccess } from "@/lib/compile-sync";
import { handleDockShortcut } from "@/lib/dock-shortcuts";
import {
  startNativeDockShortcutBridge,
  usesNativeDockMenu,
} from "@/lib/native-dock-shortcuts";
import type { ProjectStateChanged } from "@/lib/tauri";
import {
  assistantMinimumWidth,
  sidebarMinimumPercent,
  sidebarPanelGroupWidth,
} from "@/lib/assistant-layout";

type ExternalFileChange =
  | { kind: "write"; path: string; content: string }
  | { kind: "create" | "delete"; path: string }
  | { kind: "rename"; from: string; to: string };

interface ExternalFileChangePayload {
  projectId: string;
  paths?: string[];
  from?: string;
  change?: ExternalFileChange;
}

function applyExternalFileChange(payload: ExternalFileChangePayload, selfLabel: string) {
  if (payload.from === selfLabel) return;
  const files = useFilesStore.getState();
  if (!payload.projectId) return;
  if (payload.projectId !== files.projectId) return;
  if (applyKnownExternalChange(files, payload.projectId, payload.change)) return;
  void files.refreshTree();
  if (payload.change?.kind === "create") return;
  let paths = payload.paths;
  if (!paths?.length) paths = Object.keys(files.files);
  for (const path of paths) refreshExternalFile(payload.projectId, path, files.files[path]);
}

function applyKnownExternalChange(
  files: ReturnType<typeof useFilesStore.getState>,
  projectId: string,
  change: ExternalFileChange | undefined,
): boolean {
  switch (change?.kind) {
    case "delete":
      files.applyExternalDelete(projectId, change.path);
      return true;
    case "rename":
      files.applyExternalRename(projectId, change.from, change.to);
      return true;
    case "write":
      files.applyExternalWrite(projectId, change.path, change.content);
      return true;
    default:
      return false;
  }
}

function refreshExternalFile(
  projectId: string,
  path: string,
  file: { content: string; dirty: boolean } | undefined,
) {
  if (!file || file.dirty) return;
  const contentBeforeRead = file.content;
  void import("@/lib/tauri").then(({ readFileContent }) => {
    void readFileContent(projectId, path)
      .then((content) => {
        const current = useFilesStore.getState();
        const latest = current.files[path];
        if (current.projectId !== projectId || latest?.dirty) return;
        if (latest?.content !== contentBeforeRead) return;
        current.applyExternalWrite(projectId, path, content);
      })
      .catch(() => {});
  });
}

const SettingsModal = lazy(() =>
  import("@/components/layout/SettingsModal").then((m) => ({ default: m.SettingsModal })),
);
const DiagramComposer = lazy(() =>
  import("@/components/diagram/DiagramComposer").then((m) => ({ default: m.DiagramComposer })),
);
const CopilotOverlay = lazy(() =>
  import("@/components/ai/CopilotOverlay").then((m) => ({ default: m.CopilotOverlay })),
);
const WordCountModal = lazy(() =>
  import("@/components/editor/WordCountModal").then((m) => ({ default: m.WordCountModal })),
);
const HistoryModal = lazy(() =>
  import("@/components/editor/HistoryModal").then((m) => ({ default: m.HistoryModal })),
);
const HotkeysModal = lazy(() =>
  import("@/components/editor/HotkeysModal").then((m) => ({ default: m.HotkeysModal })),
);
const TourGuide = lazy(() =>
  import("@/components/tour/TourGuide").then((m) => ({ default: m.TourGuide })),
);
const EquationToolView = lazy(() =>
  import("@/components/tools/EquationToolView").then((m) => ({ default: m.EquationToolView })),
);
const LiteratureSearchToolView = lazy(() =>
  import("@/components/tools/LiteratureSearchToolView").then((m) => ({
    default: m.LiteratureSearchToolView,
  })),
);

// fallback must stay null - a visible one blocks the whole screen (these mount unconditionally, closed by default).
function LazyModals({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

// One-chunk-fetch placeholder for the lazy editor/preview surfaces: quiet,
// centered, and shaped like the boot progress card so loading reads as one
// continuous system.
function SurfaceLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <span className="ai-shimmer">{label}…</span>
      </div>
    </div>
  );
}

// Control cluster is offset from the centered grab thumb so it never fights the drag.
function VHandle({
  id,
  children,
  placement = "center",
}: {
  id: string;
  children?: ReactNode;
  placement?: "top" | "center" | "bottom";
}) {
  return (
    <div className="resize-handle-col relative flex w-1.5 shrink-0 bg-background">
      <PanelResizeHandle
        id={id}
        style={{ cursor: "col-resize" }}
        className={cn(
          "group absolute inset-0 flex items-center justify-center",
          "transition-colors hover:bg-accent/40"
        )}
      >
        <span
          className={cn(
            "pointer-events-none h-10 w-1 rounded-full bg-border transition-colors",
            "group-hover:bg-ring group-data-[resize-handle-state=drag]:bg-ring"
          )}
        />
      </PanelResizeHandle>
      {children && (
        <div
          className={cn(
            "absolute left-1/2 z-10 flex -translate-x-1/2 items-center",
            placement === "center" && "inset-y-0",
            placement === "top" && "top-1",
            placement === "bottom" && "bottom-1"
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

const AUTO_COMPILE_DEBOUNCE_MS = 2500;
// Deactivated for 0.3.7 — see the comment at its use in the on-open effect.
const RESTORE_PREVIEW_FROM_FINGERPRINT = false;

function AppContent() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const projectId = useFilesStore((s) => s.projectId);
  const projectName = useFilesStore((s) => s.projectName);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const projectLoading = useFilesStore((state) => state.loading);
  const mainDocument = useFilesStore((state) => state.mainDoc);
  const mainDocumentHydrated = useFilesStore(
    (state) =>
      state.activePath === state.mainDoc &&
      state.files[state.mainDoc] !== undefined,
  );
  const refreshProjects = useFilesStore((s) => s.refreshProjects);
  const recompile = useCompileStore((s) => s.recompile);
  const compileStatus = useCompileStore((s) => s.status);
  const compileCheckpoint = useCompileStore(
    (state) => state.lastCompileCheckpoint,
  );
  const analysisIdentity = useProjectAnalysisStore(
    (state) => state.snapshot.identity,
  );
  const viewMode = useSettingsStore((s) => s.viewMode);
  const showTree = useSettingsStore((s) => s.showTree);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const appFontSize = useSettingsStore((s) => s.appFontSize);
  const appFontFamily = useSettingsStore((s) => s.appFontFamily);
  const editorFontFamily = useSettingsStore((s) => s.editorFontFamily);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const chatFloating = useSettingsStore((s) => s.chatFloating);
  const terminalOpen = useSettingsStore((s) => s.terminalOpen);
  const browserOpen = useSettingsStore((s) => s.browserOpen);
  const assistantOpen = useSettingsStore((s) => s.assistantOpen);
  const workspaceHidden = useSettingsStore((s) => s.workspaceHidden);
  const closeDocks = useSettingsStore((s) => s.closeDocks);
  const homePage = useHomeViewStore((state) => state.page);
  const toolsOpen = useHomeViewStore((state) => state.toolsOpen);
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const editorPanelRef = useRef<ImperativePanelHandle>(null);
  const pdfPanelRef = useRef<ImperativePanelHandle>(null);
  const browserPanelRef = useRef<ImperativePanelHandle>(null);
  const terminalPanelRef = useRef<ImperativePanelHandle>(null);
  const previousShowTreeRef = useRef(showTree);

  useLayoutEffect(() => {
    if (projectId) closeDocks();
  }, [projectId, closeDocks]);

  useLayoutEffect(() => {
    if (!projectId) return;
    const panel = browserPanelRef.current;
    if (!panel) return;
    if (browserOpen) {
      if (panel.isCollapsed()) panel.expand(30);
    } else if (panel.isExpanded()) {
      panel.collapse();
    }
  }, [browserOpen, projectId]);

  useLayoutEffect(() => {
    if (!projectId) return;
    const panel = terminalPanelRef.current;
    if (!panel) return;
    if (terminalOpen) {
      if (panel.isCollapsed()) panel.expand(30);
    } else if (panel.isExpanded()) {
      panel.collapse();
    }
  }, [terminalOpen, projectId]);

  useEffect(() => {
    return subscribeToComputerUseStarts(() => {
      useSettingsStore.getState().setBrowserOpen(true);
    });
  }, []);

  const SIDEBAR_DEFAULT_PX = 340;
  const panelAreaRef = useRef<HTMLDivElement>(null);
  const [panelAreaWidth, setPanelAreaWidth] = useState(0);
  useEffect(() => {
    if (!projectId) return;
    const el = panelAreaRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setPanelAreaWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [projectId]);
  const panelGroupWidth = sidebarPanelGroupWidth(panelAreaWidth, appFontSize);
  const sidebarMinSize = sidebarMinimumPercent(
    panelGroupWidth,
    false,
    appFontSize,
  );
  const sidebarDefaultSize =
    panelGroupWidth > 0 ? Math.min(65, (SIDEBAR_DEFAULT_PX / panelGroupWidth) * 100) : 15;
  const assistantMinSize =
    panelGroupWidth > 0
      ? Math.min(55, (assistantMinimumWidth(appFontSize) / panelGroupWidth) * 100)
      : 22;
  const workspacePanelDefaultSize =
    viewMode === "split" ? (browserOpen ? 35 : 50) : browserOpen ? 70 : 100;

  useEffect(() => {
    const wasOpen = previousShowTreeRef.current;
    previousShowTreeRef.current = showTree;
    if (showTree && !wasOpen) {
      window.requestAnimationFrame(() => sidebarPanelRef.current?.resize(sidebarDefaultSize));
    }
  }, [showTree, sidebarDefaultSize]);

  useEffect(() => {
    // React owns the screen from here: retire the inline HTML splash and
    // stamp the boot milestones the BootProgress card reports against.
    markBootStage("react-mounted");
    dismissBootSplash();
    void refreshProjects();
    void useGithubStore.getState().refresh();
    markBootStage("stores-ready");
  }, [refreshProjects]);

  // Closing a project (or a fresh launch) always lands back on the library,
  // unless a global tool command explicitly queued another home page.
  useEffect(() => {
    if (!projectId) {
      const home = useHomeViewStore.getState();
      home.goTo(home.consumeQueuedPageAfterProjectClose() ?? "library");
    }
  }, [projectId]);

  // Panels are sized in percentages, so a window resize would scale the sidebar
  // with it and leave it far from the width it was opened at. Hold its pixel
  // width steady and let the editor and preview absorb the change instead.
  const lastPanelGroupWidthRef = useRef(0);
  useEffect(() => {
    const previousWidth = lastPanelGroupWidthRef.current;
    lastPanelGroupWidthRef.current = panelGroupWidth;
    if (!showTree || panelGroupWidth <= 0) return;
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (previousWidth <= 0) {
      // The pane had not been measured when the sidebar mounted, so it opened
      // on the flat percentage fallback rather than SIDEBAR_DEFAULT_PX. Apply
      // the intended width now that the real width is known.
      panel.resize(sidebarDefaultSize);
      return;
    }
    const pixels = (panel.getSize() / 100) * previousWidth;
    const next = Math.min(
      65,
      Math.max(sidebarMinSize, (pixels / panelGroupWidth) * 100),
    );
    panel.resize(next);
  }, [
    panelGroupWidth,
    showTree,
    sidebarMinSize,
    sidebarDefaultSize,
  ]);

  // No-op in dev / the browser; only prompts if an update is actually available.
  useEffect(() => {
    const id = window.setTimeout(() => checkForUpdatesOnStartup(), 3000);
    return () => window.clearTimeout(id);
  }, []);

  // Manual mode so it reports "up to date" rather than closing silently.
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen("menu://check-updates", () => {
      void openUpdateWindow({ manual: true });
    });
    return () => void unlisten.then((off) => off());
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen("menu://about", () => setAboutOpen(true));
    return () => void unlisten.then((off) => off());
  }, []);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void startNativeDockShortcutBridge().then((cleanup) => {
      if (disposed) cleanup();
      else stop = cleanup;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    // Done here, not at module load, so it never fires IPC at import time.
    void import("@/lib/ai-tools").then((m) => m.initAiPdfCaptureFlag());
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("@/lib/mcp-bridge").then(async (m) => {
      const un = await m.startMcpBridge();
      if (cancelled) un();
      else cleanup = un;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--cm-font-size", `${editorFontSize}px`);
    // Scales the whole rem-based interface.
    root.style.fontSize = `${appFontSize}px`;
    // Empty means keep the app's default stack.
    if (appFontFamily) root.style.fontFamily = appFontFamily;
    else root.style.removeProperty("font-family");
    if (editorFontFamily) root.style.setProperty("--cm-font-family", editorFontFamily);
    else root.style.removeProperty("--cm-font-family");
    const accent = accentColor || "#2563eb";
    root.style.setProperty("--primary", accent);
    root.style.setProperty("--primary-foreground", "#ffffff");
  }, [editorFontSize, appFontSize, appFontFamily, editorFontFamily, accentColor]);

  // SourceControl / DiffView refresh after git mutations; we only re-poll on
  // project switch, window focus, and a slow interval (no 5s hot loop).
  const refreshGitStatus = useGitStatusStore((s) => s.refresh);
  useEffect(() => {
    refreshGitStatus(projectId);
  }, [projectId, refreshGitStatus]);
  useEffect(() => {
    const tick = () => refreshGitStatus(useFilesStore.getState().projectId);
    const id = window.setInterval(tick, 60_000);
    const onFocus = () => tick();
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshGitStatus]);

  useEffect(() => {
    const s = useSettingsStore.getState();
    // Clear the previous project's compile output so a stale PDF never shows.
    useCompileStore.getState().reset();
    // Preflight results belong to the previous project; reset them too.
    usePreflightStore.getState().reset();
    if (projectId) {
      s.setRailTab("files");
      // The default layout drives only the editor/preview/AI panes; the file
      // tree is independent and is honored ONLY here, on project open, from the
      // "show file tree on open" setting. Switching layouts later never touches
      // it. Set it directly so open is deterministic.
      s.setLayoutPreset(s.defaultView);
      s.setShowTree(s.openInTree);
      void import("@/lib/preview-window").then((m) => m.retargetPreviewWindow(projectId));
    }
  }, [projectId]);

  // Detached AI chat / preview windows can mutate disk; reload open buffers
  // and the compiled PDF when they report changes.
  useEffect(() => {
    if (!isTauri()) return;
    const selfLabel = getCurrentWindow().label;
    const unFiles = listen<ExternalFileChangePayload>("project:files-changed", (event) => {
      if (event.payload) applyExternalFileChange(event.payload, selfLabel);
    });
    const unCompile = listen<unknown>(COMPILE_SUCCEEDED_EVENT, (event) => {
      void applyRemoteCompileSuccess(event.payload, selfLabel);
    });
    const unProjectState = listen<ProjectStateChanged>("project-state-changed", (event) => {
      const files = useFilesStore.getState();
      if (!event.payload || event.payload.projectId !== files.projectId) return;
      void files.applyProjectStateChanged(event.payload).then((applied) => {
        if (applied) usePreflightStore.getState().reset();
      });
    });
    const unSettings = listen<{ section?: string }>("settings:open", (e) => {
      const s = useSettingsStore.getState();
      if (e.payload?.section) s.setSettingsInitialSection(e.payload.section);
      s.setSettingsOpen(true);
    });
    return () => {
      void unFiles.then((f) => f());
      void unCompile.then((f) => f());
      void unProjectState.then((f) => f());
      void unSettings.then((f) => f());
    };
  }, []);

  // Manual recompile: Cmd/Ctrl + Enter. Forward SyncTeX: Cmd/Ctrl + Shift + J.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useTourStore.getState().activeTourId) return;
      const bindings = useShortcutStore.getState().bindings;
      if (matchesShortcut(e, bindings.recompile)) {
        e.preventDefault();
        // Reveal the PDF pane if it's hidden, so a keyboard recompile shows output.
        const s = useSettingsStore.getState();
        if (s.viewMode === "editor") s.setViewMode("split");
        void recompile();
      } else if (matchesShortcut(e, bindings.forwardSync)) {
        e.preventDefault();
        void forwardFromCursor();
      } else if (matchesShortcut(e, bindings.shortcutReference)) {
        e.preventDefault();
        useSettingsStore.getState().setHotkeysOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recompile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useTourStore.getState().activeTourId) return;
      if (!useFilesStore.getState().projectId) return;
      if (matchesShortcut(e, useShortcutStore.getState().bindings.toggleSidebar)) {
        // Cmd/Ctrl+B means bold inside the source and visual editors; the
        // sidebar toggle must not shadow it there.
        const el = document.activeElement as HTMLElement | null;
        if (el?.closest(".cm-editor") || el?.closest(".ProseMirror")) return;
        e.preventDefault();
        e.stopPropagation();
        useSettingsStore.getState().toggleTree();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Undo/redo is handled in the webview on every platform. The Edit menu's
  // Undo/Redo carry no accelerator (that would double-fire on Windows/Linux,
  // where the menu and the webview can both receive the key), so the keystroke
  // reaches this handler uniformly. Route by focus: a plain field (title,
  // search, chat) keeps its own native undo; the editor, its toolbar, and
  // anywhere else drive the document's history. The menu items still work as
  // clicks, routed through the same logic.
  useEffect(() => {
    // The document editors are contenteditable surfaces (.cm-content,
    // .ProseMirror), so classify them BEFORE the plain-field check; a plain
    // field also includes the inputs CodeMirror mounts inside its own panels
    // (find/replace), which must undo their own text, not the document. Plain
    // fields get an explicit execCommand undo so the behavior is identical on
    // every platform's webview.
    const inEditor = (active: HTMLElement | null): boolean =>
      !!(active?.closest(".cm-content") || active?.closest(".ProseMirror"));
    const inPlainField = (active: HTMLElement | null): boolean => {
      if (!active || inEditor(active)) return false;
      const tag = active.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || active.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const isUndo = key === "z" && !e.shiftKey;
      const isRedo = (key === "z" && e.shiftKey) || key === "y";
      if (!isUndo && !isRedo) return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (useTourStore.getState().activeTourId) return;
      if (!useFilesStore.getState().projectId) return;
      const active = document.activeElement as HTMLElement | null;
      e.preventDefault();
      e.stopPropagation();
      if (inPlainField(active)) {
        document.execCommand(isRedo ? "redo" : "undo");
        return;
      }
      if (isRedo) editorRedo();
      else editorUndo();
    };
    window.addEventListener("keydown", onKey, true);

    const menuRun = (redo: boolean) => {
      if (!useFilesStore.getState().projectId) return;
      const active = document.activeElement as HTMLElement | null;
      if (inPlainField(active)) {
        document.execCommand(redo ? "redo" : "undo");
        return;
      }
      if (redo) editorRedo();
      else editorUndo();
    };
    const unlisten: Promise<() => void>[] = isTauri()
      ? [listen("menu://undo", () => menuRun(false)), listen("menu://redo", () => menuRun(true))]
      : [];

    return () => {
      window.removeEventListener("keydown", onKey, true);
      void Promise.all(unlisten).then((fns) => {
        for (const fn of fns) fn();
      });
    };
  }, []);

  useEffect(() => {
    if (!projectId || usesNativeDockMenu()) return;
    const onKey = (event: KeyboardEvent) => {
      if (useTourStore.getState().activeTourId) return;
      handleDockShortcut(event);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [projectId]);

  // Compile once when a project opens into a layout that shows the PDF pane,
  // so the user lands on a rendered preview instead of the placeholder. Keyed
  // on the tree, not projectId: projectId is set before the files (and the
  // main doc) are loaded, and compiling then would race the open.
  const tree = useFilesStore((s) => s.tree);
  const openCompiledRef = useRef<string | null>(null);
  const openCompileInFlightRef = useRef<string | null>(null);
  const [openCompileEpoch, setOpenCompileEpoch] = useState(0);
  useEffect(() => {
    void openCompileEpoch;
    openCompiledRef.current = resetOpenCompileMarker(projectId, openCompiledRef.current);
    const analysisReady =
      analysisIdentity.projectId === projectId &&
      analysisIdentity.projectRevision > 0;
    const hydrated =
      !projectLoading &&
      mainDocumentHydrated &&
      analysisReady;
    const hasValidCurrentArtifact =
      compileCheckpoint !== null &&
      isCompileCheckpointCurrent(compileCheckpoint);
    if (hasValidCurrentArtifact && projectId) {
      openCompiledRef.current = projectId;
      return;
    }
    if (
      openCompileInFlightRef.current !== null ||
      !shouldCompileOnOpen(
        projectId,
        tree.length > 0,
        engineLoaded,
        openCompiledRef.current,
        useSettingsStore.getState().viewMode,
        compileStatus,
        hydrated,
        hasValidCurrentArtifact,
      )
    ) {
      return;
    }

    const requestedProjectId = projectId;
    if (!requestedProjectId) return;
    const requestedMainDocument = mainDocument;
    const requestedProjectRevision =
      analysisIdentity.projectRevision;
    openCompileInFlightRef.current = requestedProjectId;
    const compileOrRestore = async () => {
      // Reopen fast path: seed the preview from the persisted compile
      // fingerprint and skip the on-open compile. DEACTIVATED for 0.3.7:
      // e2e caught that skipping the on-open compile breaks subsystems that
      // depended on it (logs pane, library thumbnails, the engine-gap
      // picker) and its activation depends on a write-vs-teardown race.
      // The fingerprint keeps being written and validated server-side; the
      // restore flips on once those flows are covered end to end.
      if (RESTORE_PREVIEW_FROM_FINGERPRINT) {
        const restored = await useCompileStore
          .getState()
          .restoreFromDisk(requestedProjectId, requestedMainDocument)
          .catch(() => false);
        if (restored) return undefined;
      }
      return recompile();
    };
    void compileOrRestore().finally(() => {
      const files = useFilesStore.getState();
      const analysis =
        useProjectAnalysisStore.getState().snapshot.identity;
      const compile = useCompileStore.getState();
      const stillSameHydratedRevision =
        files.projectId === requestedProjectId &&
        files.mainDoc === requestedMainDocument &&
        !files.loading &&
        analysis.projectId === requestedProjectId &&
        analysis.projectRevision === requestedProjectRevision;
      const attempt = compile.lastAttemptIdentity;
      const attemptStartedForRevision =
        stillSameHydratedRevision &&
        attempt?.projectId === requestedProjectId &&
        attempt.mainDocument === requestedMainDocument &&
        attempt.projectRevision === requestedProjectRevision;
      const currentArtifact =
        stillSameHydratedRevision &&
        isCompileCheckpointCurrent(compile.lastCompileCheckpoint);

      if (attemptStartedForRevision || currentArtifact) {
        openCompiledRef.current = requestedProjectId;
      }
      if (
        openCompileInFlightRef.current === requestedProjectId
      ) {
        openCompileInFlightRef.current = null;
      }
      if (
        files.projectId &&
        files.projectId !== openCompiledRef.current
      ) {
        setOpenCompileEpoch((epoch) => epoch + 1);
      }
    });
  }, [
    analysisIdentity,
    compileCheckpoint,
    compileStatus,
    engineLoaded,
    mainDocument,
    mainDocumentHydrated,
    openCompileEpoch,
    projectId,
    projectLoading,
    recompile,
    tree,
  ]);

  if (!projectId) {
    return (
      <ThemeProvider>
        <Library />
        <CommandPalette />
        <SearchOmnibar />
        <GlobalNewProject />
        <Suspense fallback={null}>
          {homePage === "pdf-import" && <PdfImportView />}
          {homePage === "equation" && <EquationToolView />}
          {homePage === "bibtex" && <BibtexToolView />}
          {homePage === "table" && <TableToolView />}
          {homePage === "lab-search" && <LabSearchToolView />}
          {homePage === "literature-search" && <LiteratureSearchToolView />}
          {homePage === "deadlines" && <DeadlinesView />}
          {toolsOpen && <LatexToolsView />}
        </Suspense>
        <ExternalToolApprovals />
        <EnginePickerModal />
        <TinytexGuards />
        <QuitGuard />
        <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
        {chatFloating && (
          <Suspense fallback={null}>
            <CopilotOverlay />
          </Suspense>
        )}
        <LazyModals>
          <SettingsModal />
          <HotkeysModal />
          <DiagramComposer />
          <TourGuide />
        </LazyModals>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      {/* Drives the gutter's horizontal metrics: the line-number column gives
          back a few pixels only while the sidebar is competing for the width
          (see globals.css). */}
      <div data-sidebar-open={showTree ? "true" : "false"} className="flex h-full flex-col">
        <TopToolbar />
        <BackendProtocolBanner />
        <div ref={panelAreaRef} className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
          <ErrorBoundary
            resetKey={projectId}
            fallback={
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
                <p>The panel layout hit a snag. Your project files are safe on disk.</p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  <RefreshCw className="size-4" />
                  Reload Oleafly
                </button>
              </div>
            }
          >
            <PanelGroup direction="vertical" className="min-h-0 min-w-0 flex-1">
              <Panel
                id="content-band"
                order={1}
                defaultSize={terminalOpen ? 72 : 100}
                minSize={25}
                className="min-h-0 min-w-0"
              >
                <PanelGroup direction="horizontal" className="h-full min-h-0 min-w-0">
              {showTree && (
                <Fragment key="sidebar">
                  <Panel
                    ref={sidebarPanelRef}
                    id="sidebar"
                    order={1}
                    defaultSize={sidebarDefaultSize}
                    minSize={sidebarMinSize}
                    maxSize={65}
                    collapsible
                    collapsedSize={0}
                    onCollapse={() => {
                      if (useSettingsStore.getState().showTree) {
                        useSettingsStore.getState().toggleTree();
                      }
                    }}
                    className="bg-sidebar"
                  >
                    <Sidebar />
                  </Panel>
                  <VHandle id="h-tree" />
                </Fragment>
              )}

              {!workspaceHidden && (
              <Panel
                  key="editorpdf"
                  id="editorpdf"
                  order={2}
                  defaultSize={showTree ? 85 : 100}
                  className="min-h-0 min-w-0"
                >
                  <PanelGroup direction="horizontal" className="h-full min-h-0 min-w-0">
                        {viewMode !== "pdf" && (
                          <Panel
                            ref={editorPanelRef}
                            id="editor"
                            order={1}
                            defaultSize={workspacePanelDefaultSize}
                            minSize={15}
                            className="min-h-0 min-w-0"
                          >
                            <ErrorBoundary surface="editor" resetKey={projectId}>
                              <Suspense fallback={<SurfaceLoading label="Loading editor" />}>
                                <Editor />
                              </Suspense>
                            </ErrorBoundary>
                          </Panel>
                        )}
                        {viewMode === "split" && <VHandle id="h-mid" placement="top" />}
                        {viewMode !== "editor" && (
                          <Panel
                            ref={pdfPanelRef}
                            id="pdf"
                            order={2}
                            defaultSize={workspacePanelDefaultSize}
                            minSize={15}
                            className="min-h-0 min-w-0"
                          >
                            <ErrorBoundary surface="PDF preview" resetKey={projectId}>
                              <Suspense fallback={<SurfaceLoading label="Loading preview" />}>
                                <PreviewPane />
                              </Suspense>
                            </ErrorBoundary>
                          </Panel>
                        )}
                        <div className={cn("flex shrink-0", !browserOpen && "hidden")}>
                          <VHandle id="h-browser" placement="top" />
                        </div>
                        <Panel
                          ref={browserPanelRef}
                          id="browser"
                          order={3}
                          defaultSize={browserOpen ? 30 : 0}
                          minSize={15}
                          collapsible
                          collapsedSize={0}
                          onCollapse={() => {
                            if (useSettingsStore.getState().browserOpen) {
                              useSettingsStore.getState().setBrowserOpen(false);
                            }
                          }}
                          className="min-h-0 min-w-0"
                        >
                          <div
                            className={cn(
                              "h-full min-h-0 min-w-0",
                              !browserOpen && "invisible pointer-events-none",
                            )}
                          >
                            <ErrorBoundary surface="browser dock" resetKey={projectId}>
                              <BrowserPane visible={browserOpen} />
                            </ErrorBoundary>
                          </div>
                        </Panel>
                  </PanelGroup>
                </Panel>
              )}

              {assistantOpen && (
                <Fragment key="assistant">
                  {!workspaceHidden && <VHandle id="h-assistant" />}
                  <Panel
                    id="assistant"
                    order={3}
                    defaultSize={workspaceHidden ? 100 : Math.max(28, assistantMinSize)}
                    minSize={workspaceHidden ? 100 : assistantMinSize}
                    maxSize={workspaceHidden ? 100 : 55}
                    collapsible
                    collapsedSize={0}
                    onCollapse={() => {
                      if (useSettingsStore.getState().assistantOpen) {
                        useSettingsStore.getState().setAssistantOpen(false);
                      }
                    }}
                    className="min-h-0 min-w-0 border-l"
                  >
                    <ErrorBoundary surface="AI assistant" resetKey={projectId}>
                      <Suspense fallback={<SurfaceLoading label="Loading assistant" />}>
                        <ChatPanel />
                      </Suspense>
                    </ErrorBoundary>
                  </Panel>
                </Fragment>
              )}
                </PanelGroup>
              </Panel>
              <PanelResizeHandle
                id="v-terminal"
                style={{ cursor: "row-resize" }}
                className={cn(
                  "resize-handle-row group flex h-2.5 items-center justify-center bg-background",
                  "transition-colors hover:bg-accent/40",
                  !terminalOpen && "hidden",
                )}
              >
                <span className="h-0.5 w-8 rounded-full bg-border transition-colors group-hover:bg-ring" />
              </PanelResizeHandle>
              <Panel
                ref={terminalPanelRef}
                id="terminal"
                order={2}
                defaultSize={terminalOpen ? 28 : 0}
                minSize={10}
                collapsible
                collapsedSize={0}
                onCollapse={() => {
                  if (useSettingsStore.getState().terminalOpen) {
                    useSettingsStore.getState().setTerminalOpen(false);
                  }
                }}
                className="min-h-0 min-w-0"
              >
                <div
                  className={cn(
                    "h-full min-h-0 min-w-0",
                    !terminalOpen && "invisible pointer-events-none",
                  )}
                >
                  <ErrorBoundary surface="terminal dock" resetKey={projectId}>
                    <TerminalPane
                      projectId={projectId}
                      projectName={projectName}
                      visible={terminalOpen}
                    />
                  </ErrorBoundary>
                </div>
              </Panel>
            </PanelGroup>
          </ErrorBoundary>
        </div>

        <CommandPalette />
        <SearchOmnibar />
        <GlobalNewProject />
        <ExternalToolApprovals />
        <EnginePickerModal />
        <TinytexGuards />
        <QuitGuard />
        <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
        {chatFloating && (
          <Suspense fallback={null}>
            <CopilotOverlay />
          </Suspense>
        )}
        <LazyModals>
          <SettingsModal />
          <WordCountModal />
          <HistoryModal />
          <HotkeysModal />
          <TourGuide />
        </LazyModals>
      </div>
    </ThemeProvider>
  );
}

/**
 * Watches document text without making the complete AppContent layout a
 * subscriber. A book-sized edit should reschedule auto-compile, not re-render
 * the toolbar, panel tree, editor shell and PDF preview on every keystroke.
 */
function AutoCompileKeeper() {
  const projectId = useFilesStore((state) => state.projectId);
  const activePath = useFilesStore((state) => state.activePath);
  const activeContent = useActiveContent();
  const autoCompile = useCompileStore((state) => state.autoCompile);
  const recompile = useCompileStore((state) => state.recompile);
  const pathRef = useRef<string | null>(null);

  useEffect(() => {
    void activeContent;
    if (!autoCompile || !projectId) {
      pathRef.current = activePath;
      return;
    }
    // Active content changes on a file switch as well as an edit. Establish
    // the new file identity without compiling merely because it was opened.
    if (pathRef.current !== activePath) {
      pathRef.current = activePath;
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const attempt = () => {
      if (cancelled) return;
      if (useCompileStore.getState().status === "compiling") {
        timer = setTimeout(attempt, 500);
        return;
      }
      void recompile();
    };
    timer = setTimeout(attempt, AUTO_COMPILE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeContent, activePath, autoCompile, projectId, recompile]);

  return null;
}

export default function App() {
  return (
    <>
      <ErrorBoundary
        fallback={<LanguageServiceRuntimeUnavailable />}
      >
        <LanguageServiceRuntimeBoundary />
      </ErrorBoundary>
      <AutoCompileKeeper />
      <AppContent />
    </>
  );
}
