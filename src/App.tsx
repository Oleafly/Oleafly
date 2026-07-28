import {
  lazy,
  Suspense,
  useEffect,
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
import { Rail } from "@/components/layout/Rail";
import { Sidebar } from "@/components/layout/Sidebar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { SearchOmnibar } from "@/components/layout/SearchOmnibar";
import { GlobalNewProject } from "@/components/library/GlobalNewProject";
import { BibtexToolView } from "@/components/tools/BibtexToolView";
import { TableToolView } from "@/components/tools/TableToolView";
import { PdfImportView } from "@/components/import/PdfImportView";
import { DeadlinesView } from "@/components/deadlines/DeadlinesView";
import { LatexToolsView } from "@/components/tools/LatexToolsView";
import { LabSearchToolView } from "@/components/tools/LabSearchToolView";
import { useHomeViewStore } from "@/store/home-view";
import { Editor } from "@/components/editor/Editor";
import {
  LanguageServiceRuntimeBoundary,
  LanguageServiceRuntimeUnavailable,
} from "@/components/editor/LanguageServiceRuntimeBoundary";
import { PreviewPane } from "@/components/preview/PreviewPane";
import { Library } from "@/components/library/Library";
import { useFilesStore, useActiveContent } from "@/store/files";
import {
  isCompileCheckpointCurrent,
  useCompileStore,
} from "@/store/compile";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { usePreflightStore } from "@/store/preflight";
import { layoutPresetViewMode, layoutPresetWantsAi, useSettingsStore } from "@/store/settings";
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
import { AboutModal } from "@/components/layout/AboutModal";
import { COMPILE_SUCCEEDED_EVENT } from "@/lib/compile-checkpoint";
import { applyRemoteCompileSuccess } from "@/lib/compile-sync";

// Heavy surfaces load on demand so cold start stays lean.
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
    <div className="resize-handle-col relative flex w-3 shrink-0">
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

function AppContent() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const projectId = useFilesStore((s) => s.projectId);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const projectLoading = useFilesStore((state) => state.loading);
  const mainDocument = useFilesStore((state) => state.mainDoc);
  const mainDocumentHydrated = useFilesStore(
    (state) =>
      state.activePath === state.mainDoc &&
      state.files[state.mainDoc] !== undefined,
  );
  const refreshProjects = useFilesStore((s) => s.refreshProjects);
  const activeContent = useActiveContent();
  const activePath = useFilesStore((s) => s.activePath);
  const recompile = useCompileStore((s) => s.recompile);
  const autoCompile = useCompileStore((s) => s.autoCompile);
  const compileStatus = useCompileStore((s) => s.status);
  const compileCheckpoint = useCompileStore(
    (state) => state.lastCompileCheckpoint,
  );
  const analysisIdentity = useProjectAnalysisStore(
    (state) => state.snapshot.identity,
  );
  const viewMode = useSettingsStore((s) => s.viewMode);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const showTree = useSettingsStore((s) => s.showTree);
  const hideEditorArea = useSettingsStore((s) => s.hideEditorArea);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const appFontSize = useSettingsStore((s) => s.appFontSize);
  const appFontFamily = useSettingsStore((s) => s.appFontFamily);
  const editorFontFamily = useSettingsStore((s) => s.editorFontFamily);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const chatFloating = useSettingsStore((s) => s.chatFloating);
  const railTab = useSettingsStore((s) => s.railTab);
  const homePage = useHomeViewStore((state) => state.page);
  const toolsOpen = useHomeViewStore((state) => state.toolsOpen);
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const editorPanelRef = useRef<ImperativePanelHandle>(null);
  const pdfPanelRef = useRef<ImperativePanelHandle>(null);
  const previousRailTabRef = useRef<string | null>(null);
  const previousShowTreeRef = useRef(showTree);
  const sidebarSizeBeforeAiRef = useRef<number | null>(null);
  const aiResizePendingRef = useRef(false);

  const RAIL_WIDTH_PX = 48;
  const SIDEBAR_DEFAULT_PX = 340;
  const SIDEBAR_MIN_PX = 250;
  const panelAreaRef = useRef<HTMLDivElement>(null);
  const [panelAreaWidth, setPanelAreaWidth] = useState(0);
  useEffect(() => {
    const el = panelAreaRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setPanelAreaWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const panelGroupWidth = Math.max(0, panelAreaWidth - RAIL_WIDTH_PX);
  const sidebarMinSize = panelGroupWidth > 0 ? Math.min(65, (SIDEBAR_MIN_PX / panelGroupWidth) * 100) : 15;
  const sidebarDefaultSize =
    panelGroupWidth > 0 ? Math.min(65, (SIDEBAR_DEFAULT_PX / panelGroupWidth) * 100) : 15;

  useEffect(() => {
    const wasOpen = previousShowTreeRef.current;
    previousShowTreeRef.current = showTree;
    const isAiTab = railTab === "ai" || railTab === "chat";
    if (showTree && !wasOpen && !isAiTab) {
      // The assistant has its own layout effect below, which balances the
      // sidebar against the editor and preview panels.
      window.requestAnimationFrame(() => sidebarPanelRef.current?.resize(sidebarDefaultSize));
    }
  }, [showTree, railTab, sidebarDefaultSize]);

  useEffect(() => {
    void refreshProjects();
    void useGithubStore.getState().refresh();
  }, [refreshProjects]);

  // Closing a project (or a fresh launch) always lands back on the library,
  // unless a global tool command explicitly queued another home page.
  useEffect(() => {
    if (!projectId) {
      const home = useHomeViewStore.getState();
      home.goTo(home.consumeQueuedPageAfterProjectClose() ?? "library");
    }
  }, [projectId]);

  useEffect(() => {
    // No adjacent editor/pdf panel to balance against in this mode: the
    // sidebar just stays at its own 100% width.
    if (hideEditorArea) {
      previousRailTabRef.current = railTab;
      return;
    }

    const suppressAutoLayout = useSettingsStore.getState().suppressAiAutoLayout;
    if (suppressAutoLayout) useSettingsStore.getState().setSuppressAiAutoLayout(false);

    const wasAi =
      previousRailTabRef.current === "ai" || previousRailTabRef.current === "chat";
    const isAi = railTab === "ai" || railTab === "chat";
    previousRailTabRef.current = railTab;

    if (isAi && !wasAi) {
      useSettingsStore.getState().setChatFloating(false);
      aiResizePendingRef.current = true;
      const panel = sidebarPanelRef.current;
      if (panel) sidebarSizeBeforeAiRef.current = panel.getSize();
      if (!suppressAutoLayout) setViewMode("pdf");
    }

    if (isAi && aiResizePendingRef.current) {
      const frame = window.requestAnimationFrame(() => {
        const panel = sidebarPanelRef.current;
        if (panel) {
          if (sidebarSizeBeforeAiRef.current == null) {
            sidebarSizeBeforeAiRef.current = panel.getSize();
          }
          if (viewMode === "split") {
            panel.resize(30);
            editorPanelRef.current?.resize((30 / 70) * 100);
            pdfPanelRef.current?.resize((40 / 70) * 100);
          } else {
            panel.resize(50);
            if (viewMode === "editor") editorPanelRef.current?.resize(100);
            else if (viewMode === "pdf") pdfPanelRef.current?.resize(100);
          }
        }
        aiResizePendingRef.current = false;
      });
      return () => window.cancelAnimationFrame(frame);
    }

    if (!isAi && wasAi) {
      aiResizePendingRef.current = false;
      const previousSize = sidebarSizeBeforeAiRef.current;
      sidebarSizeBeforeAiRef.current = null;
      window.requestAnimationFrame(() => {
        // Without a remembered size the sidebar would keep the assistant's
        // half-width for the file tree, so fall back to its normal width.
        sidebarPanelRef.current?.resize(previousSize ?? sidebarDefaultSize);
        if (viewMode === "split") {
          editorPanelRef.current?.resize(50);
          pdfPanelRef.current?.resize(50);
        }
      });
    }
  }, [railTab, setViewMode, viewMode, hideEditorArea, sidebarDefaultSize]);

  // Panels are sized in percentages, so a window resize would scale the sidebar
  // with it and leave it far from the width it was opened at. Hold its pixel
  // width steady and let the editor and preview absorb the change instead.
  const lastPanelGroupWidthRef = useRef(0);
  useEffect(() => {
    const previousWidth = lastPanelGroupWidthRef.current;
    lastPanelGroupWidthRef.current = panelGroupWidth;
    if (!showTree || hideEditorArea || panelGroupWidth <= 0) return;
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
    hideEditorArea,
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
    if (projectId) setViewMode(layoutPresetViewMode(s.defaultView));
    // Clear the previous project's compile output so a stale PDF never shows.
    useCompileStore.getState().reset();
    // Preflight results belong to the previous project; reset them too.
    usePreflightStore.getState().reset();
    if (projectId) {
      s.setRailTab(layoutPresetWantsAi(s.defaultView) ? "ai" : "files");
      s.setHideEditorArea(s.defaultView === "ai-only");
      if (s.openInTree && !s.showTree) s.toggleTree();
      else if (!s.openInTree && s.showTree) s.toggleTree();
      void import("@/lib/preview-window").then((m) => m.retargetPreviewWindow(projectId));
    }
  }, [projectId, setViewMode]);

  // Detached AI chat / preview windows can mutate disk; reload open buffers
  // and the compiled PDF when they report changes.
  useEffect(() => {
    if (!isTauri()) return;
    const selfLabel = getCurrentWindow().label;
    const unFiles = listen<{ projectId: string; paths?: string[]; from?: string }>(
      "project:files-changed",
      (e) => {
        // Ignore our own broadcast: this window already applied the write
        // directly, and re-reading it would bump docVersion and reset the
        // editor cursor/undo on the active file.
        if (e.payload?.from === selfLabel) return;
        const pid = e.payload?.projectId;
        const fs = useFilesStore.getState();
        if (!pid || pid !== fs.projectId) return;
        void fs.refreshTree();
        const paths = e.payload?.paths?.length
          ? e.payload.paths
          : Object.keys(fs.files);
        for (const path of paths) {
          if (!fs.files[path]?.dirty) {
            void import("@/lib/tauri").then(({ readFileContent }) => {
              void readFileContent(pid, path)
                .then((content) => {
                  const cur = useFilesStore.getState();
                  if (cur.projectId !== pid) return;
                  // Skip if the user typed while we were reading.
                  if (cur.files[path]?.dirty) return;
                  cur.applyExternalWrite(path, content);
                })
                .catch(() => {});
            });
          }
        }
      },
    );
    const unCompile = listen<unknown>(COMPILE_SUCCEEDED_EVENT, (event) => {
      void applyRemoteCompileSuccess(event.payload, selfLabel);
    });
    const unSettings = listen<{ section?: string }>("settings:open", (e) => {
      const s = useSettingsStore.getState();
      if (e.payload?.section) s.setSettingsInitialSection(e.payload.section);
      s.setSettingsOpen(true);
    });
    return () => {
      void unFiles.then((f) => f());
      void unCompile.then((f) => f());
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
    void recompile().finally(() => {
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

  // `activeContent` also changes on tab switch / project open, not just edits;
  // only compile when the active file is unchanged from the previous render.
  const autoCompilePathRef = useRef<string | null>(null);
  useEffect(() => {
    void activeContent;
    if (!autoCompile || !projectId) {
      autoCompilePathRef.current = activePath;
      return;
    }
    if (autoCompilePathRef.current !== activePath) {
      autoCompilePathRef.current = activePath;
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const attempt = () => {
      if (cancelled) return;
      // Retry shortly instead of silently skipping the newest edits.
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
  }, [activeContent, activePath, autoCompile, recompile, projectId]);

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
      <div className="flex h-full flex-col">
        <TopToolbar />
        <div ref={panelAreaRef} className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
          <Rail />
          <ErrorBoundary
            key={`${showTree}-${hideEditorArea}-${viewMode}`}
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
          <PanelGroup direction="horizontal" className="min-h-0 min-w-0 flex-1">
            {showTree && (
              <>
                <Panel
                  ref={sidebarPanelRef}
                  id="sidebar"
                  order={1}
                  defaultSize={hideEditorArea ? 100 : sidebarDefaultSize}
                  minSize={hideEditorArea ? 100 : sidebarMinSize}
                  maxSize={hideEditorArea ? 100 : 65}
                  collapsible={!hideEditorArea}
                  collapsedSize={0}
                  onCollapse={() => {
                    if (useSettingsStore.getState().showTree) useSettingsStore.getState().toggleTree();
                  }}
                  className="bg-sidebar"
                >
                  <Sidebar />
                </Panel>
                {!hideEditorArea && <VHandle id="h-tree" />}
              </>
            )}

            {!hideEditorArea && (
            <Panel id="editorpdf" order={2} defaultSize={showTree ? 85 : 100} className="min-h-0 min-w-0">
              <PanelGroup direction="horizontal" className="h-full min-h-0 min-w-0">
                {viewMode !== "pdf" && (
                  <Panel
                    ref={editorPanelRef}
                    id="editor"
                    order={1}
                    defaultSize={viewMode === "editor" ? 100 : 50}
                    minSize={15}
                    className="min-h-0 min-w-0"
                  >
                    <Editor />
                  </Panel>
                )}
                {viewMode === "split" && <VHandle id="h-mid" placement="top" />}
                {viewMode !== "editor" && (
                  <Panel
                    ref={pdfPanelRef}
                    id="pdf"
                    order={2}
                    defaultSize={viewMode === "pdf" ? 100 : 50}
                    minSize={15}
                    className="min-h-0 min-w-0"
                  >
                    <PreviewPane />
                  </Panel>
                )}
              </PanelGroup>
            </Panel>
            )}
          </PanelGroup>
          </ErrorBoundary>
        </div>

        <CommandPalette />
        <SearchOmnibar />
        <GlobalNewProject />
        <ExternalToolApprovals />
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

export default function App() {
  return (
    <>
      <ErrorBoundary
        fallback={<LanguageServiceRuntimeUnavailable />}
      >
        <LanguageServiceRuntimeBoundary />
      </ErrorBoundary>
      <AppContent />
    </>
  );
}
