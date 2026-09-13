import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelGroupHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { FileText, Loader2, Search } from "lucide-react";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { searchDocs, type SearchHit } from "@/lib/tauri";
import { gotoLine } from "@/components/editor/cm/controller";
import { registry } from "@oleafly/registry";
import { FileTree } from "@/components/files/FileTree";
import { SidebarViews } from "@/components/layout/WorkspaceControls";
import { cn } from "@/lib/utils";
import { objectKey } from "@/lib/react-key";
import { useInitialFocus } from "@/components/ui/use-initial-focus";
import { Input } from "@/components/ui/input";

const DocumentOutline = lazy(() =>
  import("@/components/layout/DocumentOutline").then((module) => ({
    default: module.DocumentOutline,
  })),
);

const ProjectStructure = lazy(() =>
  import("@/components/layout/Outline").then((module) => ({
    default: module.Outline,
  })),
);

function basename(p: string) {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

export function reclaimExplorerFillerLayout(
  layout: readonly number[],
  collapsedSize: number,
): number[] | null {
  const fillerIndex = layout.length - 1;
  const fillerSize = layout[fillerIndex] ?? 0;
  if (fillerSize < 0.1) return null;
  let receivingIndex = -1;
  for (let index = fillerIndex - 1; index >= 0; index -= 1) {
    if ((layout[index] ?? 0) > collapsedSize + 0.1) {
      receivingIndex = index;
      break;
    }
  }
  const receivingSize = layout[receivingIndex];
  if (receivingIndex < 0 || receivingSize === undefined) return null;

  const nextLayout = [...layout];
  nextLayout[receivingIndex] = receivingSize + fillerSize;
  nextLayout[fillerIndex] = 0;
  return nextLayout;
}

export function ProjectSearch() {
  const { t } = useTranslation(["shell"]);
  const projectId = useFilesStore((s) => s.projectId);
  const openFile = useFilesStore((s) => s.openFile);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const searchInputRef = useInitialFocus<HTMLInputElement>();

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const all = await searchDocs(q);
        setHits(projectId ? all.filter((h) => h.project_id === projectId) : all);
      } catch {
        setHits([]);
      }
      setLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [q, projectId]);

  const open = async (hit: SearchHit) => {
    useSettingsStore.getState().revealEditor();
    await openFile(hit.path);
    window.setTimeout(() => gotoLine(hit.line), 80);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center gap-2 border-b border-sidebar-border px-3">
        <Search className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70">
          {t(($) => $.shell.projectSearch.title)}
        </span>
      </div>
      <div className="border-b border-sidebar-border p-2">
        <Input
          ref={searchInputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t(($) => $.shell.projectSearch.placeholder)}
          className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="flex-1 overflow-auto p-1.5">
        {hits.map((hit) => (
          <button type="button"
            key={objectKey(hit, "search-hit")}
            onClick={() => void open(hit)}
            className="block w-full cursor-pointer rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent"
          >
            <div className="flex items-center gap-1.5 text-sm">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{basename(hit.path)}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                {`:${hit.line}`}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {hit.preview}
            </div>
          </button>
        ))}
        {q.trim() && !loading && hits.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t(($) => $.shell.projectSearch.noResults)}
          </p>
        )}
        {!q.trim() && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t(($) => $.shell.projectSearch.hint)}
          </p>
        )}
      </div>
    </div>
  );
}

export function FilesPanel() {
  const { t } = useTranslation(["workspace"]);
  const [sourceCollapsed, setSourceCollapsed] = useState(false);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [structureCollapsed, setStructureCollapsed] = useState(true);
  const sourcePanelRef = useRef<ImperativePanelHandle>(null);
  const outlinePanelRef = useRef<ImperativePanelHandle>(null);
  const structurePanelRef = useRef<ImperativePanelHandle>(null);
  const fillerPanelRef = useRef<ImperativePanelHandle>(null);
  const explorerGroupRef = useRef<ImperativePanelGroupHandle>(null);
  const fillerResetTimer = useRef<number | null>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const [collapsedSize, setCollapsedSize] = useState(6);
  const collapsedSizeRef = useRef(collapsedSize);
  const sourceTitle = t(($) => $.workspace.files.title);
  const outlineTitle = t(($) => $.workspace.outline.title);
  const structureTitle = t(($) => $.workspace.structure.title);

  const reclaimCurrentExplorerFiller = useCallback(() => {
    if (!stackRef.current?.isConnected) return;
    const panelGroup = explorerGroupRef.current;
    if (!panelGroup) return;
    const nextLayout = reclaimExplorerFillerLayout(
      panelGroup.getLayout(),
      collapsedSizeRef.current,
    );
    if (nextLayout) panelGroup.setLayout(nextLayout);
  }, []);

  const scheduleFillerReclaim = useCallback(() => {
    if (fillerResetTimer.current !== null) return;
    fillerResetTimer.current = window.setTimeout(() => {
      fillerResetTimer.current = null;
      reclaimCurrentExplorerFiller();
    }, 0);
  }, [reclaimCurrentExplorerFiller]);

  useEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const updateCollapsedSize = () => {
      const height = stack.getBoundingClientRect().height;
      if (height <= 0) return;
      const next = Math.max(1.5, Math.min(28, (32 / height) * 100));
      setCollapsedSize((current) =>
        Math.abs(current - next) < 0.05 ? current : next,
      );
    };
    updateCollapsedSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateCollapsedSize);
      return () => window.removeEventListener("resize", updateCollapsedSize);
    }
    const observer = new ResizeObserver(updateCollapsedSize);
    observer.observe(stack);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (fillerResetTimer.current !== null) {
        window.clearTimeout(fillerResetTimer.current);
        fillerResetTimer.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    collapsedSizeRef.current = collapsedSize;
    if (sourceCollapsed && outlineCollapsed && structureCollapsed) return;
    scheduleFillerReclaim();
  }, [
    collapsedSize,
    outlineCollapsed,
    scheduleFillerReclaim,
    sourceCollapsed,
    structureCollapsed,
  ]);

  const minExpandedSize = Math.max(16, Math.min(32, collapsedSize + 4));
  const resizeLabel = (first: string, second: string) =>
    t(($) => $.workspace.explorer.resizeSections, { first, second });

  const keepVisibleStackAtBottom = (layout: number[]) => {
    if ((layout[3] ?? 0) < 0.1) return;
    // The filler exists only so all three sections can be reduced to header
    // height at once. As soon as any section is open, atomically give that
    // spare space to an already-open section so collapsed panels stay closed.
    scheduleFillerReclaim();
  };

  const changeCollapsed = (
    next: boolean,
    panelRef: RefObject<ImperativePanelHandle | null>,
    setCollapsed: (collapsed: boolean) => void,
    expansionReserveRef?: RefObject<ImperativePanelHandle | null>,
  ) => {
    setCollapsed(next);
    const panel = panelRef.current;
    if (!panel) return;
    if (next && panel.isExpanded()) panel.collapse();
    if (!next && panel.isCollapsed()) {
      const reserve = expansionReserveRef?.current;
      // Structure has a zero-size filler after it so all section headers can
      // sit at the bottom. If that reserve is empty, the panel library cannot
      // grow Structure forward; briefly fund its minimum size from the panels
      // above, then the normal layout callback returns the filler to zero.
      if (reserve && reserve.getSize() < minExpandedSize) {
        reserve.resize(minExpandedSize);
      }
      panel.expand();
    }
  };

  return (
    <div ref={stackRef} data-testid="explorer-stack" className="h-full min-h-0">
        <PanelGroup
          ref={explorerGroupRef}
          direction="vertical"
          autoSaveId="sidebar-explorer-sections-v3"
          onLayout={keepVisibleStackAtBottom}
          className="h-full min-h-0"
        >
        <Panel
          ref={sourcePanelRef}
          id="source-tree-v"
          order={1}
          defaultSize={(100 - collapsedSize) / 2}
          minSize={minExpandedSize}
          collapsible
          collapsedSize={collapsedSize}
          onCollapse={() => setSourceCollapsed(true)}
          onExpand={() => setSourceCollapsed(false)}
        >
          <FileTree
            collapsed={sourceCollapsed}
            onCollapsedChange={(next) =>
              changeCollapsed(next, sourcePanelRef, setSourceCollapsed)
            }
          />
        </Panel>
        <SidebarSectionHandle
          id="source-outline-resize"
          ariaLabel={resizeLabel(sourceTitle, outlineTitle)}
        />
        <Panel
          ref={outlinePanelRef}
          id="document-outline-v"
          order={2}
          defaultSize={(100 - collapsedSize) / 2}
          minSize={minExpandedSize}
          collapsible
          collapsedSize={collapsedSize}
          onCollapse={() => setOutlineCollapsed(true)}
          onExpand={() => setOutlineCollapsed(false)}
        >
          <Suspense fallback={<SidebarPanelFallback />}>
            <DocumentOutline
              collapsed={outlineCollapsed}
              onCollapsedChange={(next) =>
                changeCollapsed(next, outlinePanelRef, setOutlineCollapsed)
              }
            />
          </Suspense>
        </Panel>
        <SidebarSectionHandle
          id="outline-structure-resize"
          ariaLabel={resizeLabel(outlineTitle, structureTitle)}
        />
        <Panel
          ref={structurePanelRef}
          id="project-structure-v"
          order={3}
          defaultSize={collapsedSize}
          minSize={minExpandedSize}
          collapsible
          collapsedSize={collapsedSize}
          onCollapse={() => setStructureCollapsed(true)}
          onExpand={() => setStructureCollapsed(false)}
        >
          <Suspense fallback={<SidebarPanelFallback />}>
            <ProjectStructure
              collapsed={structureCollapsed}
              onCollapsedChange={(next) =>
                changeCollapsed(
                  next,
                  structurePanelRef,
                  setStructureCollapsed,
                  fillerPanelRef,
                )
              }
            />
          </Suspense>
        </Panel>
        <PanelResizeHandle
          id="explorer-filler-resize"
          disabled
          aria-hidden="true"
          tabIndex={-1}
          className="hidden"
        />
        <Panel
          ref={fillerPanelRef}
          id="explorer-filler-v"
          order={4}
          defaultSize={0}
          minSize={0}
          aria-hidden="true"
          className="pointer-events-none"
        >
          <span />
        </Panel>
        </PanelGroup>
    </div>
  );
}

function SidebarSectionHandle({
  id,
  ariaLabel,
}: Readonly<{
  id: string;
  ariaLabel: string;
}>) {
  return (
    <PanelResizeHandle
      id={id}
      aria-label={ariaLabel}
      style={{ cursor: "row-resize" }}
      className={cn(
        "resize-handle-row group flex h-2.5 items-center justify-center",
        "transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      )}
    >
      <span className="h-0.5 w-8 rounded-full bg-transparent opacity-0 transition-[background-color,opacity] group-hover:bg-ring group-hover:opacity-100 group-focus-visible:bg-ring group-focus-visible:opacity-100 group-data-[resize-handle-state=drag]:bg-ring group-data-[resize-handle-state=drag]:opacity-100" />
    </PanelResizeHandle>
  );
}

function SidebarPanelFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-4 animate-spin text-muted-foreground" />
    </div>
  );
}

export function Sidebar() {
  const railTab = useSettingsStore((s) => s.railTab);
  const ActivePanel = registry.railTabs.find((t) => t.id === railTab)?.panel ?? FilesPanel;
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-sidebar-border bg-background px-1.5">
        <SidebarViews />
      </div>
      <div className="min-h-0 flex-1">
        <Suspense fallback={<SidebarPanelFallback />}>
          <ActivePanel />
        </Suspense>
      </div>
    </div>
  );
}
