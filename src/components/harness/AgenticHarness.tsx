import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  FolderOpen,
  GitBranch,
  Globe2,
  House,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  Plus,
  SquareTerminal,
  X,
} from "lucide-react";
import { gitCurrentBranch } from "@/lib/tauri";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ProjectChatsSidebar } from "./ProjectChatsSidebar";
import { cn } from "@/lib/utils";
import { useComposerOutputsStore } from "@/store/composer-outputs";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";
import { PanelResizer } from "./PanelResizer";
import { PdfPane } from "./PdfPane";
import { FilePane } from "./FilePane";
import { FilesPane } from "./FilesPane";
import { BrowserPane } from "./BrowserPane";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ChatCore = lazy(() =>
  import("@/components/ai/ChatCore").then((m) => ({ default: m.ChatCore })),
);
const TerminalPane = lazy(() =>
  import("./TerminalPane").then((m) => ({ default: m.TerminalPane })),
);

// The output panel is a tab strip like the reference: any number of tabs —
// the directory, individual files the run or user opens, the compiled PDF,
// a terminal, a browser — each closable, with a + picker for new ones.
type PanelTab =
  | { id: string; kind: "files"; label: string }
  | { id: string; kind: "pdf"; label: string }
  | { id: string; kind: "terminal"; label: string }
  | { id: string; kind: "browser"; label: string }
  | { id: string; kind: "file"; label: string; path: string };

const NEW_TAB_KINDS: { kind: Exclude<PanelTab["kind"], "file">; label: string; icon: typeof FileText }[] = [
  { kind: "files", label: "Files", icon: FolderOpen },
  { kind: "pdf", label: "PDF preview", icon: FileText },
  { kind: "terminal", label: "Terminal", icon: SquareTerminal },
  { kind: "browser", label: "Browser", icon: Globe2 },
];

const TAB_ICON: Record<PanelTab["kind"], typeof FileText> = {
  files: FolderOpen,
  pdf: FileText,
  terminal: SquareTerminal,
  browser: Globe2,
  file: FileText,
};

const kindTabId = (kind: Exclude<PanelTab["kind"], "file">) => kind;
const fileTabId = (path: string) => `file:${path}`;

// The utility panel's drag-resizable width, persisted locally.
const PANEL_DEFAULT_WIDTH = 416;
const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 768;
const PANEL_WIDTH_KEY = "oleafly.harness.panel-width";

// The composer sidebar: drag-resizable and collapsible, both persisted.
const SIDEBAR_DEFAULT_WIDTH = 288;
const SIDEBAR_MIN_WIDTH = 224;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_WIDTH_KEY = "oleafly.harness.sidebar-width";
const SIDEBAR_COLLAPSED_KEY = "oleafly.harness.sidebar-collapsed";

function loadSidebarWidth(): number {
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
  const parsed = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, parsed));
}

function loadSidebarCollapsed(): boolean {
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
}

function loadPanelWidth(): number {
  const raw = window.localStorage.getItem(PANEL_WIDTH_KEY);
  const parsed = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) return PANEL_DEFAULT_WIDTH;
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, parsed));
}

// Where the session is working: folder, git branch, and the session surface.
function SessionStatus({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const branch = useQuery({
    queryKey: ["git-branch", projectId],
    queryFn: () => gitCurrentBranch(projectId),
    staleTime: 30_000,
    retry: false,
    meta: { silent: true },
  });
  return (
    <div
      data-testid="harness-session-status"
      className="flex shrink-0 items-center gap-3 border-b px-4 py-2 text-[11px] text-muted-foreground"
    >
      <span className="flex items-center gap-1.5">
        <FolderOpen className="size-3" />
        {projectName || "Untitled project"}
      </span>
      {branch.data && (
        <span className="flex items-center gap-1.5">
          <GitBranch className="size-3" />
          {branch.data}
        </span>
      )}
      <span className="ml-auto">Session scope: this project's files</span>
    </div>
  );
}

// The no-project home: pick an existing project or start a fresh one. Runs
// stay project-scoped, so the composer asks before anything can execute.
function ProjectChooser() {
  const projects = useFilesStore((s) => s.projects);
  const openProject = useFilesStore((s) => s.openProject);
  const setNewProjectOpen = useSettingsStore((s) => s.setNewProjectOpen);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center gap-8 px-6 pt-[var(--oleafly-thread-top-inset)]" data-testid="harness-project-chooser">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a project to work in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The composer runs against one project's files and citations. Pick one, or start
          something new.
        </p>
      </div>
      <div className="flex w-full max-w-xl flex-col gap-2">
        {projects.length === 0 && (
          <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            No projects yet — start your first one below.
          </p>
        )}
        {projects.slice(0, 5).map((project) => (
          <button
            key={project.id}
            type="button"
            data-testid={`harness-choose-project-${project.id}`}
            onClick={() => void openProject(project.id)}
            className="flex items-center gap-2.5 rounded-lg border bg-surface-secondary px-3.5 py-3 text-left transition-colors hover:border-border-strong hover:bg-surface-tertiary"
          >
            <FolderOpen className="size-4 shrink-0 text-primary/80" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{project.name}</span>
          </button>
        ))}
        <button
          type="button"
          data-testid="harness-new-project"
          onClick={() => setNewProjectOpen(true)}
          className="flex items-center justify-center gap-2 rounded-lg border border-dashed px-3.5 py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-border-strong hover:bg-surface-secondary hover:text-foreground"
        >
          <Plus className="size-4" />
          Start a new project
        </button>
      </div>
    </div>
  );
}

// The Oleafly AI Composer: the agentic development environment. The chat is
// the center; every artifact the run produces — file reads, edits, compiled
// PDFs — opens in the side output panel automatically. The workspace editor
// never launches behind this surface.
export function AgenticHarness() {
  const active = useHomeViewStore((s) => s.page === "agentic-harness");
  const goTo = useHomeViewStore((s) => s.goTo);
  const projectId = useFilesStore((s) => s.projectId);
  const closeProject = useFilesStore((s) => s.closeProject);
  const projectName = useFilesStore((s) => s.projectName);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  // The output sidebar collapses without losing its tabs — state only
  // resets when the composer itself goes away.
  const [tabs, setTabs] = useState<PanelTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidthState] = useState(loadPanelWidth);
  const setPanelWidth = (width: number) => {
    setPanelWidthState(width);
    try {
      window.localStorage.setItem(PANEL_WIDTH_KEY, String(width));
    } catch {
      /* private mode et al. — the width just won't persist */
    }
  };
  const [sidebarWidth, setSidebarWidthState] = useState(loadSidebarWidth);
  const setSidebarWidth = (width: number) => {
    setSidebarWidthState(width);
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
    } catch {
      /* private mode et al. — the width just won't persist */
    }
  };
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(loadSidebarCollapsed);
  const setSidebarCollapsed = (collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* in-memory only in non-persistent contexts */
    }
  };
  const openTab = useCallback((tab: PanelTab) => {
    setTabs((current) => (current.some((t) => t.id === tab.id) ? current : [...current, tab]));
    setActiveTab(tab.id);
    setPanelOpen(true);
  }, []);
  const openKindTab = useCallback((kind: Exclude<PanelTab["kind"], "file">) => {
    const entry = NEW_TAB_KINDS.find((k) => k.kind === kind);
    openTab({ id: kindTabId(kind), kind, label: entry?.label ?? kind });
  }, [openTab]);
  const openFileInPanel = useCallback(
    (path: string) => {
      openTab({
        id: fileTabId(path),
        kind: "file",
        label: path.split("/").pop() ?? path,
        path,
      });
    },
    [openTab],
  );
  const closeTab = (id: string) => {
    setTabs((current) => {
      const index = current.findIndex((t) => t.id === id);
      if (index < 0) return current;
      const next = current.filter((t) => t.id !== id);
      setActiveTab((active) => {
        if (active !== id) return active;
        const neighbor = next[Math.min(index, next.length - 1)];
        return neighbor?.id ?? null;
      });
      return next;
    });
  };
  const activePanelTab = tabs.find((t) => t.id === activeTab) ?? null;

  // Runs publish their artifacts through the composer-outputs store; open
  // them here so the panel always shows what the session just touched. The
  // store hands us a fresh object per open, so the object identity is the
  // epoch — no extra counter needed.
  const fileOpen = useComposerOutputsStore((s) => s.fileOpen);
  const pdfEpoch = useComposerOutputsStore((s) => s.pdfEpoch);
  useEffect(() => {
    if (!fileOpen) return;
    openFileInPanel(fileOpen.path);
  }, [fileOpen, openFileInPanel]);
  useEffect(() => {
    if (pdfEpoch > 0) openKindTab("pdf");
  }, [pdfEpoch, openKindTab]);

  if (!active) return null;

  // Home means the library, never the editor: with a project open, leaving
  // the composer closes it (the library route), so the workspace can never
  // appear just because the composer exited.
  const close = () => {
    if (useFilesStore.getState().projectId) {
      void closeProject();
    } else {
      goTo("library");
    }
  };

  return (
    <div
      data-testid="agentic-harness"
      className="flex h-full w-full animate-in fade-in duration-200 bg-background text-foreground motion-reduce:animate-none"
    >
      {sidebarCollapsed ? (
        <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-2">
          <button
            type="button"
            aria-label="Open the sidebar"
            data-testid="harness-sidebar-expand"
            onClick={() => setSidebarCollapsed(false)}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        </div>
      ) : (
        <>
        <aside
          className="flex shrink-0 flex-col border-r bg-sidebar"
          style={{ width: sidebarWidth }}
          data-testid="harness-sidebar"
        >
          <div className="flex h-[var(--oleafly-toolbar-height)] shrink-0 items-center gap-2 px-3">
            <LeafLogo className="size-5" />
            <span className="text-sm font-semibold">AI Composer</span>
            <button
              type="button"
              aria-label="Collapse the sidebar"
              data-testid="harness-sidebar-collapse"
              onClick={() => setSidebarCollapsed(true)}
              className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <PanelLeftClose className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Back to home"
              data-testid="harness-home"
              onClick={close}
              title="Back to home"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <House className="size-4" />
            </button>
          </div>

          <ProjectChatsSidebar />
        </aside>
        <PanelResizer
          width={sidebarWidth}
          minWidth={SIDEBAR_MIN_WIDTH}
          maxWidth={SIDEBAR_MAX_WIDTH}
          onResize={setSidebarWidth}
          onReset={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
          side="left"
          label="Resize the composer sidebar"
          testId="harness-sidebar-resizer"
        />
        </>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {projectId && engineLoaded ? (
          <div className="mx-auto flex h-full w-full max-w-4xl flex-col">
            <SessionStatus projectId={projectId} projectName={projectName} />
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading session
                </div>
              }
            >
              <ChatCore variant="composer" />
            </Suspense>
          </div>
        ) : projectId ? (
          <div
            className="flex h-full animate-in fade-in flex-col items-center justify-center gap-3 text-muted-foreground duration-200 motion-reduce:animate-none"
            data-testid="harness-opening-project"
          >
            <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground motion-reduce:animate-none" />
            <div className="text-center">
              <p className="text-sm">Opening project…</p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Loading files and the compile engine.
              </p>
            </div>
          </div>
        ) : (
          <ProjectChooser />
        )}
      </main>

      {tabs.length > 0 && projectId && (
        <PanelResizer
          width={panelWidth}
          minWidth={PANEL_MIN_WIDTH}
          maxWidth={PANEL_MAX_WIDTH}
          onResize={setPanelWidth}
          onReset={() => setPanelWidth(PANEL_DEFAULT_WIDTH)}
          label="Resize the output panel"
        />
      )}
      {tabs.length > 0 && projectId && (
        <section
          className="flex shrink-0 animate-in slide-in-from-right-2 flex-col border-l bg-surface duration-200 motion-reduce:animate-none"
          style={{ width: panelWidth }}
        >
          <div
            className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-1.5 py-1.5"
            data-testid="harness-tabstrip"
          >
            {tabs.map((tab) => {
              const Icon = TAB_ICON[tab.kind];
              const isActive = tab.id === activeTab;
              return (
                <div
                  key={tab.id}
                  data-testid={`harness-tab-${tab.id}`}
                  className={cn(
                    "group flex max-w-44 shrink-0 items-center gap-1 rounded-md pl-1.5 pr-1 text-xs transition-colors",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab(tab.id);
                      // Selecting a tab while collapsed re-expands the body.
                      setPanelOpen(true);
                    }}
                    data-testid={`harness-tab-label-${tab.id}`}
                    className="flex min-w-0 items-center gap-1 py-1"
                    title={tab.kind === "file" ? tab.path : tab.label}
                  >
                    <Icon className="size-3 shrink-0" />
                    <span className="min-w-0 truncate">{tab.label}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${tab.label}`}
                    data-testid={`harness-tab-close-${tab.id}`}
                    onClick={() => closeTab(tab.id)}
                    className="rounded p-0.5 opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              );
            })}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Open a new panel tab"
                  data-testid="harness-new-tab"
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {NEW_TAB_KINDS.map(({ kind, label }) => (
                  <DropdownMenuItem key={kind} onClick={() => openKindTab(kind)}>
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              aria-label="Collapse the output panel"
              data-testid="harness-panel-collapse"
              onClick={() => setPanelOpen(false)}
              className="ml-auto flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <PanelRightClose className="size-3.5" />
            </button>
          </div>
          {panelOpen && (
            <div className="min-h-0 flex-1">
              {activePanelTab?.kind === "files" && <FilesPane onOpenFile={openFileInPanel} />}
              {activePanelTab?.kind === "file" && <FilePane path={activePanelTab.path} />}
              {activePanelTab?.kind === "terminal" && (
                <Suspense fallback={null}>
                  <TerminalPane projectId={projectId} projectName={projectName ?? undefined} />
                </Suspense>
              )}
              {activePanelTab?.kind === "pdf" && <PdfPane />}
              {activePanelTab?.kind === "browser" && <BrowserPane />}
            </div>
          )}
        </section>
      )}

      <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-l bg-sidebar py-2" data-testid="harness-panel-rail">
        {NEW_TAB_KINDS.map(({ kind, label, icon: Icon }) => (
          <Tooltip key={kind} label={label} side="left">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={label}
              data-testid={`harness-panel-${kind}`}
              disabled={!projectId}
              onClick={() => {
                if (activePanelTab?.id === kindTabId(kind) && panelOpen) {
                  setPanelOpen(false);
                } else {
                  openKindTab(kind);
                }
              }}
              className={cn("size-9", activePanelTab?.id === kindTabId(kind) && "bg-accent text-foreground")}
            >
              <Icon className="size-4" />
            </Button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
