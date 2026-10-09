import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type Layout,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import { FileText, Search } from "lucide-react";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import type { SearchHit } from "@/lib/tauri";
import { useDocSearch } from "@/hooks/use-doc-search";
import { useScrollMemory } from "@/hooks/use-scroll-memory";
import { useSidebarViewMemory } from "@/hooks/use-sidebar-view-memory";
import { readSidebarView } from "@/store/sidebar-view-state";
import { gotoLine } from "@/components/editor/cm/controller";
import { registry } from "@oleafly/registry";
import { FileTree } from "@/components/files/FileTree";
import { SidebarViews } from "@/components/layout/WorkspaceControls";
import { SidebarPanelHeader } from "@/components/layout/SidebarSection";
import { cn } from "@/lib/utils";
import { objectKey } from "@/lib/react-key";
import { basename } from "@/lib/path-utils";
import { useInitialFocus } from "@/components/ui/use-initial-focus";
import { Input } from "@/components/ui/input";
import {
  PANEL_STYLE,
  collapsePanel,
  expandPanel,
  panelLimitProps,
  percent,
  useCollapseTransitions,
  usePersistentPanelLayout,
  useSeparatorHitArea,
  useSeparatorKeyboard,
  type PanelLimits,
} from "@/lib/panel-layout";
import { Spinner } from "@/components/ui/spinner";

const DocumentOutline = lazy(() =>
  import("@/components/layout/DocumentOutline").then((module) => ({
    default: memo(module.DocumentOutline),
  })),
);

const ProjectStructure = lazy(() =>
  import("@/components/layout/Outline").then((module) => ({
    default: memo(module.Outline),
  })),
);

const SourceTree = memo(FileTree);

type CollapseChange = (
  next: boolean,
  panelId: string,
  panelRef: RefObject<PanelImperativeHandle | null>,
  setCollapsed: (collapsed: boolean) => void,
  followingPanelRefs: readonly RefObject<PanelImperativeHandle | null>[],
) => void;

const EXPLORER_GROUP_ID = "sidebar-explorer-sections-v3";
const SOURCE_PANEL = "source-tree-v";
const OUTLINE_PANEL = "document-outline-v";
const STRUCTURE_PANEL = "project-structure-v";
const FILLER_PANEL = "explorer-filler-v";
const EXPLORER_PANELS = [SOURCE_PANEL, OUTLINE_PANEL, STRUCTURE_PANEL, FILLER_PANEL];

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
  const [remembered] = useState(() => readSidebarView(projectId, "search"));
  const [q, setQ] = useState(remembered?.query ?? "");
  const { hits, loading, term } = useDocSearch(q, { projectId });
  const searchInputRef = useInitialFocus<HTMLInputElement>();
  const resultsRef = useRef<HTMLDivElement>(null);
  const settled = useRef<{ term: string; hits: readonly SearchHit[] } | null>(
    remembered?.term ? remembered : null,
  );
  if (!loading) settled.current = term ? { term, hits } : null;
  const shownHits =
    loading && settled.current?.term === term ? settled.current.hits : hits;
  useSidebarViewMemory(projectId, "search", {
    query: q,
    term: settled.current?.term ?? "",
    hits: settled.current?.hits ?? [],
  });
  useScrollMemory({ scrollRef: resultsRef, projectId, slot: "search" });
  const previousProjectId = useRef(projectId);
  useEffect(() => {
    if (previousProjectId.current === projectId) return;
    previousProjectId.current = projectId;
    const next = readSidebarView(projectId, "search");
    settled.current = next?.term ? next : null;
    setQ(next?.query ?? "");
  }, [projectId]);

  const open = async (hit: SearchHit) => {
    useSettingsStore.getState().revealEditor();
    await openFile(hit.path);
    window.setTimeout(() => gotoLine(hit.line), 80);
  };

  return (
    <div className="flex h-full flex-col">
      <SidebarPanelHeader icon={Search} title={t(($) => $.shell.projectSearch.title)} />
      <div className="border-b border-sidebar-border p-2">
        <Input
          ref={searchInputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t(($) => $.shell.projectSearch.placeholder)}
          className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm focus:border-ring"
        />
      </div>
      <div ref={resultsRef} className="flex-1 overflow-auto p-1.5">
        {shownHits.map((hit) => (
          <button type="button"
            key={objectKey(hit, "search-hit")}
            onClick={() => void open(hit)}
            className="block w-full cursor-pointer rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent"
          >
            <div className="flex items-center gap-1.5 text-sm">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{basename(hit.path)}</span>
              <span className="ml-auto shrink-0 font-mono text-[0.625rem] text-muted-foreground">
                {`:${hit.line}`}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[0.6875rem] text-muted-foreground">
              {hit.preview}
            </div>
          </button>
        ))}
        {q.trim() && !loading && shownHits.length === 0 && (
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
  const sourcePanelRef = useRef<PanelImperativeHandle>(null);
  const outlinePanelRef = useRef<PanelImperativeHandle>(null);
  const structurePanelRef = useRef<PanelImperativeHandle>(null);
  const fillerPanelRef = useRef<PanelImperativeHandle>(null);
  const explorerGroupRef = useRef<GroupImperativeHandle>(null);
  const fillerResetTimer = useRef<number | null>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const [collapsedSize, setCollapsedSize] = useState(6);
  const collapsedSizeRef = useRef(collapsedSize);
  const changeCollapsedRef = useRef<CollapseChange | null>(null);
  const onSourceCollapsedChange = useCallback(
    (next: boolean) =>
      changeCollapsedRef.current?.(next, SOURCE_PANEL, sourcePanelRef, setSourceCollapsed, [
        outlinePanelRef,
        structurePanelRef,
      ]),
    [],
  );
  const onOutlineCollapsedChange = useCallback(
    (next: boolean) =>
      changeCollapsedRef.current?.(next, OUTLINE_PANEL, outlinePanelRef, setOutlineCollapsed, [
        structurePanelRef,
      ]),
    [],
  );
  const onStructureCollapsedChange = useCallback(
    (next: boolean) =>
      changeCollapsedRef.current?.(next, STRUCTURE_PANEL, structurePanelRef, setStructureCollapsed, []),
    [],
  );
  const sourceTitle = t(($) => $.workspace.files.title);
  const outlineTitle = t(($) => $.workspace.outline.title);
  const structureTitle = t(($) => $.workspace.structure.title);
  const { defaultLayout, onLayoutChanged } = usePersistentPanelLayout(
    EXPLORER_GROUP_ID,
    EXPLORER_PANELS,
    EXPLORER_PANELS,
  );
  const trackCollapse = useCollapseTransitions();
  // The section handles take no layout space; their 10px band straddling the
  // divider line is the whole hit area (see SidebarSectionHandle).
  const hitArea = useSeparatorHitArea(0);

  const reclaimCurrentExplorerFiller = useCallback(() => {
    if (!stackRef.current?.isConnected) return;
    const panelGroup = explorerGroupRef.current;
    if (!panelGroup) return;
    const layout = panelGroup.getLayout();
    const sizes = EXPLORER_PANELS.map((id) => layout[id]);
    if (!sizes.every((size): size is number => size !== undefined)) return;
    const nextLayout = reclaimExplorerFillerLayout(sizes, collapsedSizeRef.current);
    if (nextLayout) {
      panelGroup.setLayout(
        Object.fromEntries(EXPLORER_PANELS.map((id, index) => [id, nextLayout[index] ?? 0])),
      );
    }
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
      const style = window.getComputedStyle(stack);
      const height =
        stack.getBoundingClientRect().height -
        (Number.parseFloat(style.paddingTop) || 0) -
        (Number.parseFloat(style.paddingBottom) || 0);
      if (height <= 0) return;
      // A collapsed section is its 32px header plus the 1px divider under it.
      // The handles take no space, so that divider is all that separates two
      // collapsed headers.
      const next = Math.max(1.5, Math.min(28, (33 / height) * 100));
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
  const explorerLimits = useMemo(() => {
    const section: PanelLimits = {
      minSize: minExpandedSize,
      collapsible: true,
      collapsedSize,
    };
    return {
      [SOURCE_PANEL]: section,
      [OUTLINE_PANEL]: section,
      [STRUCTURE_PANEL]: section,
      [FILLER_PANEL]: { minSize: 0 },
    } satisfies Record<string, PanelLimits>;
  }, [collapsedSize, minExpandedSize]);
  const onSeparatorKeyDown = useSeparatorKeyboard(explorerGroupRef, explorerLimits);
  const resizeLabel = (first: string, second: string) =>
    t(($) => $.workspace.explorer.resizeSections, { first, second });

  const keepVisibleStackAtBottom = (layout: Layout) => {
    if ((layout[FILLER_PANEL] ?? 0) < 0.1) return;
    // The filler exists only so all three sections can be reduced to header
    // height at once. As soon as any section is open, atomically give that
    // spare space to an already-open section so collapsed panels stay closed.
    scheduleFillerReclaim();
  };

  const onExplorerLayoutChange = (layout: Layout) => {
    trackCollapse(layout, {
      [SOURCE_PANEL]: {
        collapsedSize,
        onCollapse: () => setSourceCollapsed(true),
        onExpand: () => setSourceCollapsed(false),
      },
      [OUTLINE_PANEL]: {
        collapsedSize,
        onCollapse: () => setOutlineCollapsed(true),
        onExpand: () => setOutlineCollapsed(false),
      },
      [STRUCTURE_PANEL]: {
        collapsedSize,
        onCollapse: () => setStructureCollapsed(true),
        onExpand: () => setStructureCollapsed(false),
      },
    });
    keepVisibleStackAtBottom(layout);
  };

  const changeCollapsed: CollapseChange = (
    next,
    panelId,
    panelRef,
    setCollapsed,
    followingPanelRefs,
  ) => {
    setCollapsed(next);
    const panel = panelRef.current;
    if (!panel) return;
    if (next) collapsePanel(EXPLORER_GROUP_ID, panelId, panel);
    if (!next && panel.isCollapsed()) {
      const reserve = fillerPanelRef.current;
      const canGrowForward = followingPanelRefs.some(
        (ref) => ref.current?.isCollapsed() === false,
      );
      if (!canGrowForward && reserve && reserve.getSize().asPercentage < minExpandedSize) {
        reserve.resize(percent(minExpandedSize));
      }
      expandPanel(EXPLORER_GROUP_ID, panelId, panel, minExpandedSize);
    }
  };
  changeCollapsedRef.current = changeCollapsed;

  return (
    <div
      ref={stackRef}
      data-testid="explorer-stack"
      className={cn("h-full min-h-0", structureCollapsed && "pb-2.5")}
    >
      <Group
        groupRef={explorerGroupRef}
        orientation="vertical"
        defaultLayout={defaultLayout}
        onLayoutChange={onExplorerLayoutChange}
        onLayoutChanged={onLayoutChanged}
        resizeTargetMinimumSize={hitArea}
        className="h-full min-h-0"
      >
        <Panel
          panelRef={sourcePanelRef}
          id={SOURCE_PANEL}
          defaultSize={percent((100 - collapsedSize) / 2)}
          {...panelLimitProps(explorerLimits[SOURCE_PANEL])}
          style={PANEL_STYLE}
        >
          <SourceTree
            collapsed={sourceCollapsed}
            onCollapsedChange={onSourceCollapsedChange}
          />
        </Panel>
        <SidebarSectionHandle
          id="source-outline-resize"
          ariaLabel={resizeLabel(sourceTitle, outlineTitle)}
          onKeyDownCapture={onSeparatorKeyDown}
        />
        <Panel
          panelRef={outlinePanelRef}
          id={OUTLINE_PANEL}
          defaultSize={percent((100 - collapsedSize) / 2)}
          {...panelLimitProps(explorerLimits[OUTLINE_PANEL])}
          style={PANEL_STYLE}
        >
          <Suspense fallback={<SidebarPanelFallback />}>
            <DocumentOutline
              collapsed={outlineCollapsed}
              onCollapsedChange={onOutlineCollapsedChange}
            />
          </Suspense>
        </Panel>
        <SidebarSectionHandle
          id="outline-structure-resize"
          ariaLabel={resizeLabel(outlineTitle, structureTitle)}
          onKeyDownCapture={onSeparatorKeyDown}
        />
        <Panel
          panelRef={structurePanelRef}
          id={STRUCTURE_PANEL}
          defaultSize={percent(collapsedSize)}
          {...panelLimitProps(explorerLimits[STRUCTURE_PANEL])}
          style={PANEL_STYLE}
        >
          <Suspense fallback={<SidebarPanelFallback />}>
            <ProjectStructure
              collapsed={structureCollapsed}
              onCollapsedChange={onStructureCollapsedChange}
            />
          </Suspense>
        </Panel>
        <Separator
          id="explorer-filler-resize"
          disabled
          disableDoubleClick
          aria-hidden="true"
          className="invisible h-0 overflow-hidden"
        />
        <Panel
          panelRef={fillerPanelRef}
          id={FILLER_PANEL}
          defaultSize={percent(0)}
          {...panelLimitProps(explorerLimits[FILLER_PANEL])}
          aria-hidden="true"
          style={PANEL_STYLE}
          className="pointer-events-none"
        >
          <span />
        </Panel>
      </Group>
    </div>
  );
}

function SidebarSectionHandle({
  id,
  ariaLabel,
  onKeyDownCapture,
}: Readonly<{
  id: string;
  ariaLabel: string;
  onKeyDownCapture: KeyboardEventHandler<HTMLElement>;
}>) {
  // The 10px band's negative margins cancel its height, so it takes no layout
  // space: the next section's header sits right under the divider line and its
  // hover tint reaches that line. The band straddles the line, above both
  // panels, and keeps a real box so it stays visible and focusable.
  return (
    <Separator
      id={id}
      disableDoubleClick
      aria-label={ariaLabel}
      onKeyDownCapture={onKeyDownCapture}
      style={{ cursor: "row-resize" }}
      className="resize-handle-row group relative z-10 -my-[5px] flex h-2.5 select-none items-center justify-center"
    >
      <span className="h-0.5 w-8 rounded-full bg-transparent opacity-0 transition-[background-color,opacity] group-hover:bg-ring group-hover:opacity-100 group-focus-visible:bg-ring group-focus-visible:opacity-100 group-data-[separator=active]:bg-ring group-data-[separator=active]:opacity-100" />
    </Separator>
  );
}

function SidebarPanelFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner className="text-muted-foreground" />
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
