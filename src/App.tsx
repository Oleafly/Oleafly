import {
  Fragment,
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
import { Editor } from "@/components/editor/Editor";
import { PreviewPane } from "@/components/preview/PreviewPane";
import { PdfImportView } from "@/components/import/PdfImportView";
import { Rail } from "@/components/layout/Rail";
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
import { EnginePickerModal } from "@/components/layout/EnginePickerModal";
import { TinytexGuards } from "@/components/layout/TinytexGuards";
import { QuitGuard } from "@/components/layout/QuitGuard";
import { COMPILE_SUCCEEDED_EVENT } from "@/lib/compile-checkpoint";
import { applyRemoteCompileSuccess } from "@/lib/compile-sync";
import type { ProjectStateChanged } from "@/lib/tauri";

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
  const recompile = useCompileStore((s) => s.recompile);
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
      // Reopen fast path: when the persisted compile fingerprint still
      // matches the sources on disk, seed the preview from the already-built
      // PDF and skip the compile entirely.
      const restored = await useCompileStore
        .getState()
        .restoreFromDisk(requestedProjectId, requestedMainDocument)
        .catch(() => false);
      if (restored) return undefined;
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
      <div className="flex h-full flex-col">
        <TopToolbar />
        <div ref={panelAreaRef} className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
          <Rail />
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
            <PanelGroup direction="horizontal" className="min-h-0 min-w-0 flex-1">
              {showTree && (
                <Fragment key="sidebar">
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
                      if (useSettingsStore.getState().showTree) {
                        useSettingsStore.getState().toggleTree();
                      }
                    }}
                    className="bg-sidebar"
                  >
                    <Sidebar />
                  </Panel>
                  {!hideEditorArea && <VHandle id="h-tree" />}
                </Fragment>
              )}

              {!hideEditorArea && (
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
                        defaultSize={viewMode === "editor" ? 100 : 50}
                        minSize={15}
                        className="min-h-0 min-w-0"
                      >
                        <Suspense fallback={<SurfaceLoading label="Loading editor" />}>
                          <Editor />
                        </Suspense>
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
                        <Suspense fallback={<SurfaceLoading label="Loading preview" />}>
                          <PreviewPane />
                        </Suspense>
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
