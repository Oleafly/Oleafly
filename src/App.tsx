import { startPreviewWorkspaceBridge } from "@/lib/preview-workspace";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { restoreWorkspaceLayout, workspacePanelId } from "@/lib/workspace-layout";
import { useTranslation } from "react-i18next";
import { CiteOleaflyDialog } from "@/components/layout/CiteOleaflyDialog";
import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type Layout,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import { RefreshCw } from "lucide-react";
import { EditorView } from "@codemirror/view";
import { redo as cmRedo, undo as cmUndo } from "@codemirror/commands";
import { ThemeProvider, applyAccentColor, currentTheme, subscribeTheme, type Theme } from "@/lib/theme";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TopToolbar } from "@/components/layout/TopToolbar";
import { BackendProtocolBanner } from "@/components/layout/BackendProtocolBanner";
import { FolderUnavailableBanner } from "@/components/layout/FolderUnavailableBanner";
import { ProjectAvailabilityKeeper } from "@/components/layout/ProjectAvailabilityKeeper";
import { Editor } from "@/components/editor/Editor";
import {
  editorUndo,
  editorRedo,
  editorVimUndo,
  editorVimRedo,
  getEditorView,
} from "@/components/editor/cm/controller";
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
import { EDITOR_LINE_HEIGHTS, useSettingsStore } from "@/store/settings";
import { registerBrowserCuaSurface } from "@/lib/browser-window";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";
import { useTourStore } from "@/store/tours";
import {
  automaticCompileAllowed,
  openCompileHydrated,
  resetOpenCompileMarker,
  shouldCompileOnOpen,
} from "@/lib/open-compile";
import { useGitStatusStore } from "@/store/git-status";
import { useGithubStore } from "@/store/github";
import { forwardFromCursor } from "@/features/synctex";
import { checkForUpdatesOnStartup, openUpdateWindow } from "@/lib/updater";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";
import {
  PANEL_STYLE,
  afterPanelLayout,
  collapsePanel,
  expandPanel,
  hasStoredPanelLayout,
  panelLimitProps,
  percent,
  useCollapseTransitions,
  useDismissiblePanelLayout,
  usePersistentPanelLayout,
  useSeparatorHitArea,
  useSeparatorKeyboard,
  useSteadyPanelWidth,
  type PanelLimits,
} from "@/lib/panel-layout";
import { AssistantOutputsBridge } from "@/components/ai/AssistantOutputsBridge";
import { ExternalToolApprovals } from "@/components/ai/ExternalToolApprovals";
import { ChatPanel } from "@/components/ai/ChatPanel";
import { AboutModal } from "@/components/layout/AboutModal";
import { EnginePickerModal } from "@/components/layout/EnginePickerModal";
import { TinytexGuards } from "@/components/layout/TinytexGuards";
import { QuitGuard } from "@/components/layout/QuitGuard";
import { SaveBlockedDialog } from "@/components/layout/SaveBlockedDialog";
import { COMPILE_SUCCEEDED_EVENT } from "@/lib/compile-checkpoint";
import {
  CHECKPOINT_PUBLICATION_EVENT,
  applyCheckpointPublicationEvent,
} from "@/lib/checkpoint-publication";

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
import {
  applyExternalFileChange,
  refreshOpenFilesFromDisk,
  type ExternalFileChangePayload,
} from "@/lib/external-file-changes";

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
const VersioningModal = lazy(() =>
  import("@/components/editor/VersioningModal").then((m) => ({
    default: m.VersioningModal,
  })),
);
const HotkeysModal = lazy(() =>
  import("@/components/editor/HotkeysModal").then((m) => ({ default: m.HotkeysModal })),
);
const TourGuide = lazy(() =>
  import("@/components/tour/TourGuide").then((m) => ({ default: m.TourGuide })),
);
const StatsToolView = lazy(() =>
  import("@/components/tools/StatsToolView").then((m) => ({ default: m.StatsToolView })),
);
const GeneratorsToolView = lazy(() =>
  import("@/components/tools/GeneratorsToolView").then((m) => ({ default: m.GeneratorsToolView })),
);
const SymbolsToolView = lazy(() =>
  import("@/components/tools/SymbolsToolView").then((m) => ({ default: m.SymbolsToolView })),
);
const EquationToolView = lazy(() =>
  import("@/components/tools/EquationToolView").then((m) => ({ default: m.EquationToolView })),
);
const ConverterToolView = lazy(() =>
  import("@/components/tools/ConverterToolView").then((m) => ({ default: m.ConverterToolView })),
);
const ReferenceToolView = lazy(() =>
  import("@/components/tools/ReferenceToolView").then((m) => ({ default: m.ReferenceToolView })),
);
const LiteratureSearchToolView = lazy(() =>
  import("@/components/tools/LiteratureSearchToolView").then((m) => ({
    default: m.LiteratureSearchToolView,
  })),
);
const TerminalDock = lazy(() =>
  import("@/components/dock/TerminalDock").then((m) => ({ default: m.TerminalDock })),
);

// fallback must stay null - a visible one blocks the whole screen (these mount unconditionally, closed by default).
function LazyModals({ children }: Readonly<{ children: ReactNode }>) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

// One-chunk-fetch placeholder for the lazy editor/preview surfaces: quiet,
// centered, and shaped like the boot progress card so loading reads as one
// continuous system.
function SurfaceLoading({ label }: Readonly<{ label: string }>) {
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

function VHandle({
  id,
  onKeyDownCapture,
}: Readonly<{
  id: string;
  onKeyDownCapture: KeyboardEventHandler<HTMLElement>;
}>) {
  return (
    <Separator
      id={id}
      disableDoubleClick
      onKeyDownCapture={onKeyDownCapture}
      style={{ cursor: "col-resize" }}
      className="resize-handle-col group relative flex w-1.5 shrink-0 select-none bg-background"
    >
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center",
          "transition-colors hover:bg-accent/40"
        )}
      >
        <span
          className={cn(
            "pointer-events-none h-10 w-1 rounded-full bg-border transition-colors",
            "group-hover:bg-ring group-data-[separator=active]:bg-ring"
          )}
        />
      </span>
    </Separator>
  );
}

const VERTICAL_PANELS = ["content-band", "terminal"];
const HORIZONTAL_PANELS = ["sidebar", "editorpdf", "assistant"];
const DOCUMENT_PANELS = ["editor", "pdf"];
const VERTICAL_LIMITS = {
  "content-band": { minSize: 25 },
  terminal: { minSize: 10, collapsible: true, collapsedSize: 0 },
} satisfies Record<string, PanelLimits>;
const DOCUMENT_LIMITS = {
  editor: { minSize: 15 },
  pdf: { minSize: 15 },
} satisfies Record<string, PanelLimits>;

function closeAssistant() {
  const settings = useSettingsStore.getState();
  if (settings.assistantOpen) settings.setAssistantOpen(false);
}

function workspaceGroupId(projectId: string | null, group: string): string | undefined {
  return projectId ? workspacePanelId(projectId, group) : undefined;
}

const AUTO_COMPILE_DEBOUNCE_MS = 2500;
// Deactivated for 0.3.7 — see the comment at its use in the on-open effect.
const RESTORE_PREVIEW_FROM_FINGERPRINT = false;

function AppContent() {
  const { t } = useTranslation(["workspace"]);
  const [aboutOpen, setAboutOpen] = useState(false);
  const projectId = useFilesStore((s) => s.projectId);
  const projectName = useFilesStore((s) => s.projectName);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const projectLoading = useFilesStore((state) => state.loading);
  const mainDocument = useFilesStore((state) => state.mainDoc);
  const mainDecision = useFilesStore((state) => state.mainDecision);
  const mainDocumentLoaded = useFilesStore(
    (state) => state.files[state.mainDoc] !== undefined,
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
  const selectedViewMode = useSettingsStore((s) => s.viewMode);
  const detached = usePreviewDetachedStore((s) => s.projectId === projectId && projectId !== null);
  const viewMode = detached ? "editor" : selectedViewMode;
  const showTree = useSettingsStore((s) => s.showTree);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const appFontSize = useSettingsStore((s) => s.appFontSize);
  const appFontFamily = useSettingsStore((s) => s.appFontFamily);
  const editorFontFamily = useSettingsStore((s) => s.editorFontFamily);
  const editorLineHeight = useSettingsStore((s) => s.editorLineHeight);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const chatFloating = useSettingsStore((s) => s.chatFloating);
  const terminalOpen = useSettingsStore((s) => s.terminalOpen);
  const assistantOpen = useSettingsStore((s) => s.assistantOpen);
  const workspaceHidden = useSettingsStore((s) => s.workspaceHidden);
  const homePage = useHomeViewStore((state) => state.page);
  const projectToolOpen = homePage === "generators" || homePage === "symbols";
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null);
  const editorPanelRef = useRef<PanelImperativeHandle>(null);
  const pdfPanelRef = useRef<PanelImperativeHandle>(null);
  const terminalPanelRef = useRef<PanelImperativeHandle>(null);
  const verticalGroupRef = useRef<GroupImperativeHandle>(null);
  const horizontalGroupRef = useRef<GroupImperativeHandle>(null);
  const documentGroupRef = useRef<GroupImperativeHandle>(null);
  const verticalGroupId = workspaceGroupId(projectId, "vertical");
  const horizontalGroupId = workspaceGroupId(projectId, "horizontal");
  const documentGroupId = workspaceGroupId(projectId, "document");
  const hasStoredHorizontalLayout = useMemo(
    () => (horizontalGroupId ? hasStoredPanelLayout(horizontalGroupId) : false),
    [horizontalGroupId],
  );
  const verticalLayout = usePersistentPanelLayout(verticalGroupId, VERTICAL_PANELS, VERTICAL_PANELS);
  const documentLayout = usePersistentPanelLayout(
    documentGroupId,
    DOCUMENT_PANELS,
    DOCUMENT_PANELS.filter(
      (id) => (id === "editor" && viewMode !== "pdf") || (id === "pdf" && viewMode !== "editor"),
    ),
  );
  const trackVerticalCollapse = useCollapseTransitions();
  const onVerticalSeparatorKeyDown = useSeparatorKeyboard(verticalGroupRef, VERTICAL_LIMITS);
  const onDocumentSeparatorKeyDown = useSeparatorKeyboard(documentGroupRef, DOCUMENT_LIMITS);
  const separatorHitArea = useSeparatorHitArea(0.375);

  useLayoutEffect(() => {
    if (projectId) return restoreWorkspaceLayout(projectId);
  }, [projectId]);

  useLayoutEffect(() => {
    if (!projectId) return;
    const groupId = workspacePanelId(projectId, "vertical");
    return afterPanelLayout(
      () => terminalPanelRef.current,
      (panel) => {
        if (terminalOpen) expandPanel(groupId, "terminal", panel, 30);
        else collapsePanel(groupId, "terminal", panel);
      },
    );
  }, [terminalOpen, projectId]);

  // The browser opens as its own window, so computer use just needs a CUA
  // surface whose navigate opens/replaces that window; there is no dock to
  // reveal. The computer_use tool is only exposed when the browser flag is on.
  useEffect(() => registerBrowserCuaSurface(), []);

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
    viewMode === "split" ? 50 : 100;
  const horizontalLimits = useMemo(
    () =>
      ({
        sidebar: { minSize: sidebarMinSize, maxSize: 65 },
        editorpdf: {},
        assistant: {
          minSize: assistantMinSize,
          maxSize: workspaceHidden ? 100 : 55,
          collapsible: true,
          collapsedSize: 0,
        },
      }) satisfies Record<string, PanelLimits>,
    [assistantMinSize, sidebarMinSize, workspaceHidden],
  );
  const assistantDefaultSize = workspaceHidden ? 100 : Math.max(28, assistantMinSize);
  const horizontalLayout = useDismissiblePanelLayout(
    horizontalGroupRef,
    horizontalGroupId,
    HORIZONTAL_PANELS,
    HORIZONTAL_PANELS.filter(
      (id) =>
        (id === "sidebar" && showTree) ||
        (id === "editorpdf" && !workspaceHidden) ||
        (id === "assistant" && assistantOpen),
    ),
    horizontalLimits,
    { id: "assistant", defaultSize: assistantDefaultSize, onDismiss: closeAssistant },
  );
  const onHorizontalSeparatorKeyDown = useSeparatorKeyboard(horizontalGroupRef, horizontalLimits);

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

  useSteadyPanelWidth({
    panelRef: sidebarPanelRef,
    active: showTree,
    groupWidth: panelGroupWidth,
    minSize: sidebarMinSize,
    maxSize: 65,
    defaultSize: sidebarDefaultSize,
    applyDefault: !hasStoredHorizontalLayout,
  });

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
    root.style.setProperty(
      "--cm-line-height",
      String(EDITOR_LINE_HEIGHTS[editorLineHeight] ?? EDITOR_LINE_HEIGHTS.normal),
    );
    getEditorView()?.requestMeasure();
  }, [editorFontSize, appFontSize, appFontFamily, editorFontFamily, editorLineHeight]);

  useEffect(() => {
    const apply = (theme: Theme) => applyAccentColor(theme, accentColor);
    apply(currentTheme());
    return subscribeTheme(apply);
  }, [accentColor]);

  // SourceControl / DiffView refresh after git mutations; we only re-poll on
  // project switch, window focus, and a slow interval (no 5s hot loop).
  const refreshGitStatus = useGitStatusStore((s) => s.refresh);
  useEffect(() => {
    refreshGitStatus(projectId);
  }, [projectId, refreshGitStatus]);
  useEffect(() => {
    const tick = () => refreshGitStatus(useFilesStore.getState().projectId);
    const id = window.setInterval(tick, 60_000);
    const onFocus = () => {
      tick();
      refreshOpenFilesFromDisk(useFilesStore.getState().projectId);
    };
    const onVis = () => {
      if (document.visibilityState === "visible") onFocus();
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
    }
  }, [projectId]);

  useEffect(() => {
    void import("@/lib/preview-window").then((m) => m.restorePreviewWindow(projectId, useFilesStore.getState().projectName ?? ""));
  }, [projectId]);

  useEffect(() => {
    const cleanup = startPreviewWorkspaceBridge();
    return () => { void cleanup.then((off) => off()); };
  }, []);

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
    const unCheckpointPublication = listen<unknown>(CHECKPOINT_PUBLICATION_EVENT, (event) => {
      applyCheckpointPublicationEvent(event.payload);
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
      void unCheckpointPublication.then((f) => f());
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
        if (e.defaultPrevented) return;
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
    const sourceEditorOwns = (active: HTMLElement | null): boolean => {
      const source = getEditorView();
      return !!active && !!source && source.contentDOM.contains(active);
    };
    const secondaryCodeEditorOwns = (active: HTMLElement | null): boolean =>
      !!active?.closest(".cm-content") && !sourceEditorOwns(active);
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
      if (secondaryCodeEditorOwns(active)) return;
      // Once Vim owns the source editor, let its modal handler see the key
      // first. Keys it declines still fall through to CodeMirror's ordinary
      // history keymap; capturing them here bypasses Vim entirely.
      const vimEnabled = useSettingsStore.getState().vim;
      if (sourceEditorOwns(active) && vimEnabled) return;
      e.preventDefault();
      e.stopPropagation();
      if (inPlainField(active)) {
        document.execCommand(isRedo ? "redo" : "undo");
        return;
      }
      // Toolbar and other document chrome still target the source editor. In
      // Vim mode, route that history request through Vim so it restores modal
      // cursor and selection state instead of applying bare CM6 history.
      if (!active?.closest(".ProseMirror") && vimEnabled) {
        const handled = isRedo ? editorVimRedo() : editorVimUndo();
        if (handled) return;
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
      // A secondary CodeMirror surface owns its own history; never redirect
      // its menu click into the paper's source buffer.
      if (secondaryCodeEditorOwns(active)) {
        const host = active?.closest(".cm-editor") ?? active?.closest(".cm-content");
        const view = host ? EditorView.findFromDOM(host as HTMLElement) : null;
        if (!view) return;
        if (redo) cmRedo(view);
        else cmUndo(view);
        return;
      }
      // Native menu events have no key event for Vim to intercept. Use its
      // history adapter directly so menu Undo/Redo preserves modal cursor and
      // selection semantics just like the keyboard route above.
      if (!active?.closest(".ProseMirror") && useSettingsStore.getState().vim) {
        const handled = redo ? editorVimRedo() : editorVimUndo();
        if (handled) return;
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
    void mainDocumentLoaded;
    openCompiledRef.current = resetOpenCompileMarker(projectId, openCompiledRef.current);
    const hydrated = openCompileHydrated(
      projectLoading,
      projectId,
      analysisIdentity.projectId,
      analysisIdentity.projectRevision,
    );
    const hasValidCurrentArtifact =
      compileCheckpoint !== null &&
      isCompileCheckpointCurrent(compileCheckpoint);
    if (hasValidCurrentArtifact && projectId) {
      openCompiledRef.current = projectId;
      return;
    }
    if (
      openCompileInFlightRef.current !== null ||
      !automaticCompileAllowed(mainDecision) ||
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
      return recompile({ origin: "automatic" });
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
    mainDecision,
    mainDocument,
    mainDocumentLoaded,
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
          {homePage === "converter" && <ConverterToolView />}
          {homePage === "reference" && <ReferenceToolView />}
          {homePage === "bibtex" && <BibtexToolView />}
          {homePage === "table" && <TableToolView />}
          {homePage === "lab-search" && <LabSearchToolView />}
          {homePage === "literature-search" && <LiteratureSearchToolView />}
          {homePage === "deadlines" && <DeadlinesView />}
          {homePage === "stats" && <StatsToolView />}
          {homePage === "generators" && <GeneratorsToolView />}
          {homePage === "symbols" && <SymbolsToolView />}
          {homePage === "tools" && <LatexToolsView />}
        </Suspense>
        <ExternalToolApprovals />
        <EnginePickerModal />
        <TinytexGuards />
        <QuitGuard />
        <SaveBlockedDialog />
        <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
        {chatFloating && (
          <Suspense fallback={null}>
            <CopilotOverlay />
          </Suspense>
        )}
        <LazyModals>
          <SettingsModal />
          <CiteOleaflyDialog />
          <HotkeysModal />
          <DiagramComposer />
          <TourGuide />
        </LazyModals>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <div data-sidebar-open={showTree ? "true" : "false"} className="flex h-full flex-col">
        <div className="contents" inert={projectToolOpen || undefined}>
          {/* Drives the gutter's horizontal metrics: the line-number column gives
              back a few pixels only while the sidebar is competing for the width
              (see globals.css). */}
          <TopToolbar />
        <BackendProtocolBanner />
        <FolderUnavailableBanner />
        <div ref={panelAreaRef} className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
          <ErrorBoundary
            resetKey={projectId}
            fallback={
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
                <p>{t(($) => $.workspace.panelError.message)}</p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  <RefreshCw className="size-4" />
                  {t(($) => $.workspace.panelError.reload)}
                </button>
              </div>
            }
          >
            <Group
              key={projectId}
              groupRef={verticalGroupRef}
              orientation="vertical"
              defaultLayout={
                verticalLayout.defaultLayout ?? {
                  "content-band": terminalOpen ? 72 : 100,
                  terminal: terminalOpen ? 28 : 0,
                }
              }
              onLayoutChange={(layout: Layout) =>
                trackVerticalCollapse(layout, {
                  terminal: {
                    collapsedSize: 0,
                    onCollapse: () => {
                      if (useSettingsStore.getState().terminalOpen) {
                        useSettingsStore.getState().setTerminalOpen(false);
                      }
                    },
                    onExpand: () => {
                      if (!useSettingsStore.getState().terminalOpen) {
                        useSettingsStore.getState().setTerminalOpen(true);
                      }
                    },
                  },
                })
              }
              onLayoutChanged={verticalLayout.onLayoutChanged}
              resizeTargetMinimumSize={separatorHitArea}
              className="min-h-0 min-w-0 flex-1"
            >
              <Panel
                id="content-band"
                defaultSize={percent(72)}
                {...panelLimitProps(VERTICAL_LIMITS["content-band"])}
                style={PANEL_STYLE}
                className="min-h-0 min-w-0"
              >
                <Group
                  groupRef={horizontalGroupRef}
                  orientation="horizontal"
                  defaultLayout={horizontalLayout.defaultLayout}
                  onLayoutChange={horizontalLayout.onLayoutChange}
                  onLayoutChanged={horizontalLayout.onLayoutChanged}
                  resizeTargetMinimumSize={separatorHitArea}
                  className="h-full min-h-0 min-w-0"
                >
              {showTree && (
                <Fragment key="sidebar">
                  <Panel
                    panelRef={sidebarPanelRef}
                    id="sidebar"
                    defaultSize={percent(sidebarDefaultSize)}
                    {...panelLimitProps(horizontalLimits.sidebar)}
                    style={PANEL_STYLE}
                    className="bg-sidebar"
                  >
                    <Sidebar />
                  </Panel>
                  <VHandle id="h-tree" onKeyDownCapture={onHorizontalSeparatorKeyDown} />
                </Fragment>
              )}

              {!workspaceHidden && (
              <Panel
                  key="editorpdf"
                  id="editorpdf"
                  defaultSize={percent(showTree ? 85 : 100)}
                  {...panelLimitProps(horizontalLimits.editorpdf)}
                  style={PANEL_STYLE}
                  className="min-h-0 min-w-0"
                >
                  <Group
                    groupRef={documentGroupRef}
                    orientation="horizontal"
                    defaultLayout={documentLayout.defaultLayout}
                    onLayoutChanged={documentLayout.onLayoutChanged}
                    resizeTargetMinimumSize={separatorHitArea}
                    className="h-full min-h-0 min-w-0"
                  >
                        {viewMode !== "pdf" && (
                          <Panel
                            panelRef={editorPanelRef}
                            id="editor"
                            defaultSize={percent(workspacePanelDefaultSize)}
                            {...panelLimitProps(DOCUMENT_LIMITS.editor)}
                            style={PANEL_STYLE}
                            className="min-h-0 min-w-0"
                          >
                            <ErrorBoundary surface="editor" resetKey={projectId}>
                              <Suspense fallback={<SurfaceLoading label={t(($) => $.workspace.surfaces.editor)} />}>
                                <Editor />
                              </Suspense>
                            </ErrorBoundary>
                          </Panel>
                        )}
                        {viewMode === "split" && (
                          <VHandle id="h-mid" onKeyDownCapture={onDocumentSeparatorKeyDown} />
                        )}
                        {viewMode !== "editor" && (
                          <Panel
                            panelRef={pdfPanelRef}
                            id="pdf"
                            defaultSize={percent(workspacePanelDefaultSize)}
                            {...panelLimitProps(DOCUMENT_LIMITS.pdf)}
                            style={PANEL_STYLE}
                            className="min-h-0 min-w-0"
                          >
                            <ErrorBoundary surface="PDF preview" resetKey={projectId}>
                              <Suspense fallback={<SurfaceLoading label={t(($) => $.workspace.surfaces.preview)} />}>
                                <PreviewPane />
                              </Suspense>
                            </ErrorBoundary>
                          </Panel>
                        )}
                  </Group>
                </Panel>
              )}

              {assistantOpen && (
                <Fragment key="assistant">
                  {!workspaceHidden && (
                    <VHandle id="h-assistant" onKeyDownCapture={onHorizontalSeparatorKeyDown} />
                  )}
                  <Panel
                    id="assistant"
                    defaultSize={percent(assistantDefaultSize)}
                    {...panelLimitProps(horizontalLimits.assistant)}
                    style={PANEL_STYLE}
                    className="min-h-0 min-w-0 border-l"
                  >
                    <ErrorBoundary surface="AI assistant" resetKey={projectId}>
                      <Suspense fallback={<SurfaceLoading label={t(($) => $.workspace.surfaces.assistant)} />}>
                        <ChatPanel />
                      </Suspense>
                    </ErrorBoundary>
                  </Panel>
                </Fragment>
              )}
                </Group>
              </Panel>
              <Separator
                id="v-terminal"
                disabled={!terminalOpen}
                disableDoubleClick
                onKeyDownCapture={onVerticalSeparatorKeyDown}
                style={{ cursor: "row-resize" }}
                className={cn(
                  "resize-handle-row group flex h-1.5 select-none items-center justify-center bg-background",
                  "transition-colors hover:bg-accent/40",
                  !terminalOpen && "invisible h-0 overflow-hidden",
                )}
              >
                <span className="h-0.5 w-8 rounded-full bg-border transition-colors group-hover:bg-ring" />
              </Separator>
              <Panel
                panelRef={terminalPanelRef}
                id="terminal"
                defaultSize={percent(28)}
                {...panelLimitProps(VERTICAL_LIMITS.terminal)}
                style={PANEL_STYLE}
                className="min-h-0 min-w-0"
              >
                <div
                  className={cn(
                    "h-full min-h-0 min-w-0",
                    !terminalOpen && "invisible pointer-events-none",
                  )}
                >
                  <ErrorBoundary surface="terminal dock" resetKey={projectId}>
                    <Suspense fallback={<SurfaceLoading label={t(($) => $.workspace.surfaces.terminal)} />}>
                      <TerminalDock
                        projectId={projectId}
                        projectName={projectName}
                        visible={terminalOpen}
                      />
                    </Suspense>
                  </ErrorBoundary>
                </div>
              </Panel>
            </Group>
          </ErrorBoundary>
        </div>

        <CommandPalette />
        <SearchOmnibar />
        <GlobalNewProject />
        <AssistantOutputsBridge />
        <ExternalToolApprovals />
        <EnginePickerModal />
        <TinytexGuards />
        <QuitGuard />
        <SaveBlockedDialog />
        <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
        {chatFloating && (
          <Suspense fallback={null}>
            <CopilotOverlay />
          </Suspense>
        )}
        <LazyModals>
          <CiteOleaflyDialog />
          <WordCountModal />
          <VersioningModal />
          <HotkeysModal />
          <TourGuide />
        </LazyModals>
        </div>
        <LazyModals>
          <SettingsModal />
        </LazyModals>
        {projectToolOpen && (
          <Suspense fallback={null}>
            <div className="fixed inset-0 z-[70]">
              {homePage === "generators" ? <GeneratorsToolView /> : <SymbolsToolView />}
            </div>
          </Suspense>
        )}
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
      void recompile({ origin: "automatic" });
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
      <ProjectAvailabilityKeeper />
      <AppContent />
    </>
  );
}
