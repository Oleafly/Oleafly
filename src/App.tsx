import { useEffect, useRef, type ReactNode } from "react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import { ThemeProvider } from "@/lib/theme";
import { TopToolbar } from "@/components/layout/TopToolbar";
import { Rail } from "@/components/layout/Rail";
import { Sidebar } from "@/components/layout/Sidebar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { SearchOmnibar } from "@/components/layout/SearchOmnibar";
import { SettingsModal } from "@/components/layout/SettingsModal";
import { Editor } from "@/components/editor/Editor";
import { PreviewPane } from "@/components/preview/PreviewPane";
import { Library } from "@/components/library/Library";
import { WordCountModal } from "@/components/editor/WordCountModal";
import { HistoryModal } from "@/components/editor/HistoryModal";
import { HotkeysModal } from "@/components/editor/HotkeysModal";
import { useFilesStore, useActiveContent } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { usePreflightStore } from "@/store/preflight";
import { useSettingsStore } from "@/store/settings";
import { useGitStatusStore } from "@/store/git-status";
import { useGithubStore } from "@/store/github";
import { forwardFromCursor } from "@/features/synctex";
import { checkForUpdatesOnStartup, openUpdateWindow } from "@/lib/updater";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";

/** A clearly-grabbable, visible vertical resize handle (12px hit area).
 *  Optionally renders a control cluster at the top/bottom (Overleaf-style),
 *  kept away from the centered grab thumb so it never fights the drag. */
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
    <div className="relative flex w-3 shrink-0 cursor-col-resize">
      <PanelResizeHandle
        id={id}
        style={{ cursor: "col-resize" }}
        className={cn(
          "group absolute inset-0 flex cursor-col-resize items-center justify-center",
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

function DividerBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Tooltip label={title} side="right">
      <button
        type="button"
        aria-label={title}
        onClick={onClick}
        className="flex size-6 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
      >
        {children}
      </button>
    </Tooltip>
  );
}

const AUTO_COMPILE_DEBOUNCE_MS = 2500;

export default function App() {
  const projectId = useFilesStore((s) => s.projectId);
  const refreshProjects = useFilesStore((s) => s.refreshProjects);
  const activeContent = useActiveContent();
  const activePath = useFilesStore((s) => s.activePath);
  const recompile = useCompileStore((s) => s.recompile);
  const autoCompile = useCompileStore((s) => s.autoCompile);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const showTree = useSettingsStore((s) => s.showTree);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const appFontSize = useSettingsStore((s) => s.appFontSize);
  const appFontFamily = useSettingsStore((s) => s.appFontFamily);
  const editorFontFamily = useSettingsStore((s) => s.editorFontFamily);
  const accentColor = useSettingsStore((s) => s.accentColor);

  // On startup: populate the library. The user picks a project from there.
  useEffect(() => {
    void refreshProjects();
    void useGithubStore.getState().refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Silently check for a new release shortly after launch (no-op in dev / the
  // browser). Only prompts the user if an update is actually available.
  useEffect(() => {
    const id = window.setTimeout(() => checkForUpdatesOnStartup(), 3000);
    return () => window.clearTimeout(id);
  }, []);

  // "Check for Updates…" in the app menu opens the update window (manual mode,
  // so it reports "up to date" rather than closing silently).
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen("menu://check-updates", () => {
      void openUpdateWindow({ manual: true });
    });
    return () => void unlisten.then((off) => off());
  }, []);

  // Apply cosmetic settings (fonts, sizes, accent color) to the document.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--cm-font-size", `${editorFontSize}px`);
    // Global app font size scales the whole (rem-based) interface.
    root.style.fontSize = `${appFontSize}px`;
    // Font families: empty means keep the app's default stack.
    if (appFontFamily) root.style.fontFamily = appFontFamily;
    else root.style.removeProperty("font-family");
    if (editorFontFamily) root.style.setProperty("--cm-font-family", editorFontFamily);
    else root.style.removeProperty("--cm-font-family");
    // Default accent is primary blue; accentColor is always a real color.
    const accent = accentColor || "#2563eb";
    root.style.setProperty("--primary", accent);
    root.style.setProperty("--primary-foreground", "#ffffff");
  }, [editorFontSize, appFontSize, appFontFamily, editorFontFamily, accentColor]);

  // Keep the source-control badge count fresh for the current project.
  const refreshGitStatus = useGitStatusStore((s) => s.refresh);
  useEffect(() => {
    refreshGitStatus(projectId);
  }, [projectId, refreshGitStatus]);
  useEffect(() => {
    const tick = () => refreshGitStatus(useFilesStore.getState().projectId);
    const id = window.setInterval(tick, 5000);
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshGitStatus]);

  // Open a project in the user's preferred view (Appearance settings).
  useEffect(() => {
    const s = useSettingsStore.getState();
    if (projectId) setViewMode(s.defaultView);
    // Clear the previous project's compile output so a stale PDF never shows.
    useCompileStore.getState().reset();
    // Preflight results belong to the previous project; reset them too.
    usePreflightStore.getState().reset();
    // Show (or hide) the file tree on open per the user's preference.
    if (projectId) {
      s.setRailTab("files");
      if (s.openInTree && !s.showTree) s.toggleTree();
      else if (!s.openInTree && s.showTree) s.toggleTree();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Manual recompile: Cmd/Ctrl + Enter. Forward SyncTeX: Cmd/Ctrl + Shift + J.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        // Reveal the PDF pane if it's hidden, so a keyboard recompile shows output.
        const s = useSettingsStore.getState();
        if (s.viewMode === "editor") s.setViewMode("split");
        void recompile();
      } else if (e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        void forwardFromCursor();
      } else if (e.key === "/") {
        e.preventDefault();
        useSettingsStore.getState().setHotkeysOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recompile]);

  // Auto-compile: debounced on real edits. `activeContent` also changes when you
  // merely switch tabs or open a project, so skip those (they aren't edits) by
  // only compiling when the active file is unchanged from the previous render.
  const autoCompilePathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoCompile || !projectId) {
      autoCompilePathRef.current = activePath;
      return;
    }
    // Tab switch / project open: the path changed, not the content. Don't compile.
    if (autoCompilePathRef.current !== activePath) {
      autoCompilePathRef.current = activePath;
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const attempt = () => {
      if (cancelled) return;
      // If a compile is in flight, retry shortly so the newest edits still get
      // compiled instead of being silently skipped.
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
        <SettingsModal />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <div className="flex h-full flex-col">
        <TopToolbar />
        <div className="flex min-h-0 flex-1">
          <Rail />
          <PanelGroup direction="horizontal" className="flex-1">
            {showTree && (
              <>
                <Panel id="sidebar" order={1} defaultSize={20} minSize={12} maxSize={42} className="bg-sidebar">
                  <Sidebar />
                </Panel>
                <VHandle id="h-tree" />
              </>
            )}

            <Panel id="editorpdf" order={2} defaultSize={showTree ? 80 : 100}>
              <PanelGroup direction="horizontal">
                {viewMode !== "pdf" && (
                  <Panel id="editor" order={1} defaultSize={viewMode === "editor" ? 100 : 50} minSize={15}>
                    <Editor />
                  </Panel>
                )}
                {viewMode === "split" && (
                  <VHandle id="h-mid" placement="top">
                    <DividerBtn onClick={() => void forwardFromCursor()} title="Go to PDF (SyncTeX)">
                      <ArrowRight className="size-3.5" />
                    </DividerBtn>
                  </VHandle>
                )}
                {viewMode !== "editor" && (
                  <Panel id="pdf" order={2} defaultSize={viewMode === "pdf" ? 100 : 50} minSize={15}>
                    <PreviewPane />
                  </Panel>
                )}
              </PanelGroup>
            </Panel>
          </PanelGroup>
        </div>

        <CommandPalette />
        <SearchOmnibar />
        <SettingsModal />
        <WordCountModal />
        <HistoryModal />
        <HotkeysModal />
      </div>
    </ThemeProvider>
  );
}
