import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { ThemeProvider } from "@/lib/theme";
import { TopToolbar } from "@/components/layout/TopToolbar";
import { Rail } from "@/components/layout/Rail";
import { Sidebar } from "@/components/layout/Sidebar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { SearchOmnibar } from "@/components/layout/SearchOmnibar";
import { GlobalNewProject } from "@/components/library/GlobalNewProject";
import { PdfImportView } from "@/components/import/PdfImportView";
import { DeadlinesView } from "@/components/deadlines/DeadlinesView";
import { LatexToolsView } from "@/components/tools/LatexToolsView";
import { EquationToolView } from "@/components/tools/EquationToolView";
import { BibtexToolView } from "@/components/tools/BibtexToolView";
import { TableToolView } from "@/components/tools/TableToolView";
import { LabSearchToolView } from "@/components/tools/LabSearchToolView";
import { useHomeViewStore } from "@/store/home-view";
import { Editor } from "@/components/editor/Editor";
import { PreviewPane } from "@/components/preview/PreviewPane";
import { Library } from "@/components/library/Library";
import { useFilesStore, useActiveContent } from "@/store/files";
import { useCompileStore } from "@/store/compile";
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

export default function App() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const projectId = useFilesStore((s) => s.projectId);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const refreshProjects = useFilesStore((s) => s.refreshProjects);
  const activeContent = useActiveContent();
  const activePath = useFilesStore((s) => s.activePath);
  const recompile = useCompileStore((s) => s.recompile);
  const autoCompile = useCompileStore((s) => s.autoCompile);
  const compileStatus = useCompileStore((s) => s.status);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const showTree = useSettingsStore((s) => s.showTree);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const appFontSize = useSettingsStore((s) => s.appFontSize);
  const appFontFamily = useSettingsStore((s) => s.appFontFamily);
  const editorFontFamily = useSettingsStore((s) => s.editorFontFamily);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const chatFloating = useSettingsStore((s) => s.chatFloating);
  const railTab = useSettingsStore((s) => s.railTab);
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const editorPanelRef = useRef<ImperativePanelHandle>(null);
  const pdfPanelRef = useRef<ImperativePanelHandle>(null);
  const previousRailTabRef = useRef<string | null>(null);
  const previousShowTreeRef = useRef(showTree);
  const sidebarSizeBeforeAiRef = useRef<number | null>(null);
  const aiResizePendingRef = useRef(false);

  const RAIL_WIDTH_PX = 48;
  const SIDEBAR_DEFAULT_PX = 340;
  const SIDEBAR_MIN_PX = 240;
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
      window.requestAnimationFrame(() => sidebarPanelRef.current?.resize(sidebarDefaultSize));
    }
  }, [showTree, railTab, sidebarDefaultSize]);

  useEffect(() => {
    void refreshProjects();
    void useGithubStore.getState().refresh();
  }, [refreshProjects]);

  // Closing a project (or a fresh launch) always lands back on the library,
  // never stranded on whatever home-shell page was open beforehand.
  useEffect(() => {
    if (!projectId) useHomeViewStore.getState().goTo("library");
  }, [projectId]);

  useEffect(() => {
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
        if (previousSize != null) sidebarPanelRef.current?.resize(previousSize);
        if (viewMode === "split") {
          editorPanelRef.current?.resize(50);
          pdfPanelRef.current?.resize(50);
        }
      });
    }
  }, [railTab, setViewMode, viewMode]);

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
    const unCompile = listen<{ projectId: string; from?: string }>("compile:done", (e) => {
      if (e.payload?.from === selfLabel) return;
      const pid = e.payload?.projectId;
      if (!pid || pid !== useFilesStore.getState().projectId) return;
      void import("@/lib/tauri").then(({ readCompiledPdf }) => {
        void readCompiledPdf(pid)
          .then((buf) => {
            if (useFilesStore.getState().projectId !== pid) return;
            useCompileStore.setState({
              status: "success",
              phase: "idle",
              pdfBytes: new Uint8Array(buf),
              lastCompiledAt: Date.now(),
            });
            void import("@/lib/preview-window").then((m) => m.refreshPreviewWindow());
          })
          .catch(() => {});
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
  useEffect(() => {
    openCompiledRef.current = resetOpenCompileMarker(projectId, openCompiledRef.current);
    const view = useSettingsStore.getState().viewMode;
    if (!shouldCompileOnOpen(projectId, tree.length > 0, engineLoaded, openCompiledRef.current, view, compileStatus)) return;
    openCompiledRef.current = projectId;
    void recompile();
  }, [projectId, tree, engineLoaded, compileStatus, recompile]);

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
        <PdfImportView />
        <EquationToolView />
        <BibtexToolView />
        <TableToolView />
        <LabSearchToolView />
        <DeadlinesView />
        <LatexToolsView />
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
          <TourGuide />
        </LazyModals>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <div className="flex h-full flex-col">
        <TopToolbar />
        <div ref={panelAreaRef} className="flex min-h-0 flex-1">
          <Rail />
          <PanelGroup direction="horizontal" className="flex-1">
            {showTree && (
              <>
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
                    if (useSettingsStore.getState().showTree) useSettingsStore.getState().toggleTree();
                  }}
                  className="bg-sidebar"
                >
                  <Sidebar />
                </Panel>
                <VHandle id="h-tree" />
              </>
            )}

            <Panel id="editorpdf" order={2} defaultSize={showTree ? 85 : 100}>
              <PanelGroup direction="horizontal">
                {viewMode !== "pdf" && (
                  <Panel
                    ref={editorPanelRef}
                    id="editor"
                    order={1}
                    defaultSize={viewMode === "editor" ? 100 : 50}
                    minSize={15}
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
                  >
                    <PreviewPane />
                  </Panel>
                )}
              </PanelGroup>
            </Panel>
          </PanelGroup>
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
          <DiagramComposer />
          <TourGuide />
        </LazyModals>
      </div>
    </ThemeProvider>
  );
}
