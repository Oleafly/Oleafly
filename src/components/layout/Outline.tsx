import { useTranslation } from "react-i18next";
import { CopyMinus, CopyPlus, Info, ListTree } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScrollMemory } from "@/hooks/use-scroll-memory";
import { useSidebarViewMemory } from "@/hooks/use-sidebar-view-memory";
import { readSidebarView } from "@/store/sidebar-view-state";
import { Tooltip } from "@/components/ui/tooltip";
import {
  IntelligenceFilter,
  IntelligenceTree,
  PanelState,
  type IntelligenceTreeExpansionCommand,
  type IntelligenceTreeExpansionState,
  type IntelligenceTreeNode,
} from "@/components/layout/IntelligenceTree";
import { SidebarSection } from "@/components/layout/SidebarSection";
import { buildProjectStructureNodes } from "@/components/layout/project-intelligence-view";
import { acceptedProjectSnapshot } from "@/lib/project-intelligence/current";
import { navigateToProjectRange } from "@/lib/project-intelligence/navigation";
import {
  projectIntelligenceFailureText,
  projectIntelligenceReasonText,
} from "@/lib/project-intelligence/reason";
import type {
  ProjectIntelligenceSnapshot,
  ProjectIntelligenceState,
} from "@/lib/project-intelligence/types";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { useOverlayScrollbar } from "@/hooks/use-overlay-scrollbar";

function countNodes(nodes: readonly IntelligenceTreeNode[]): number {
  let count = 0;
  const pending = [...nodes];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    count += 1;
    if (node.children) pending.push(...node.children);
  }
  return count;
}

function StructureUnavailable({
  projectId,
}: Readonly<{
  projectId: string | null;
}>) {
  const { t } = useTranslation(["workspace"]);
  const activePath = useFilesStore((state) => state.activePath);
  const status = useIndexStore((state) => state.intelligenceState.status);
  const reasonText = useIndexStore((state) =>
    projectIntelligenceReasonText(state.intelligenceState.reason),
  );
  const failureText = useIndexStore((state) =>
    projectIntelligenceFailureText(state.intelligenceState),
  );
  if (!projectId) {
    return (
      <PanelState
        state="empty"
        title={t(($) => $.workspace.structure.unavailable.noProject.title)}
        detail={t(($) => $.workspace.structure.unavailable.noProject.detail)}
      />
    );
  }
  if (!activePath) {
    return (
      <PanelState
        state="empty"
        title={t(($) => $.workspace.structure.unavailable.noSource.title)}
        detail={t(($) => $.workspace.structure.unavailable.noSource.detail)}
      />
    );
  }

  switch (status) {
    case "running":
    case "not_run":
      return (
        <PanelState
          state="pending"
          title={t(($) => $.workspace.structure.unavailable.mapping.title)}
          detail={t(($) => $.workspace.structure.unavailable.mapping.detail)}
        />
      );
    case "unsupported":
      return (
        <PanelState
          state="unsupported"
          title={t(($) => $.workspace.structure.unavailable.unsupported.title)}
          detail={reasonText ?? t(($) => $.workspace.structure.unavailable.unsupported.detail)}
        />
      );
    case "unavailable":
      return (
        <PanelState
          state="error"
          title={t(($) => $.workspace.structure.unavailable.offline.title)}
          detail={reasonText ?? t(($) => $.workspace.structure.unavailable.offline.detail)}
        />
      );
    case "error":
      return (
        <PanelState
          state="error"
          title={t(($) => $.workspace.structure.unavailable.failed.title)}
          detail={failureText ?? t(($) => $.workspace.structure.unavailable.failed.detail)}
        />
      );
    default:
      return (
        <PanelState
          state="pending"
          title={t(($) => $.workspace.structure.unavailable.waiting.title)}
          detail={t(($) => $.workspace.structure.unavailable.waiting.detail)}
        />
      );
  }
}

function analysisPartial(state: ProjectIntelligenceState): boolean {
  return state.status === "partial" || state.data?.status === "partial";
}

function refreshingSnapshot(
  state: ProjectIntelligenceState,
  projectId: string | null,
): ProjectIntelligenceSnapshot | null {
  const refreshing = state.status === "running" ||
    state.status === "not_run" || (state.stale &&
    (state.status === "success" || state.status === "partial"));
  return refreshing && projectId &&
    state.identity?.projectId === projectId &&
    state.data?.identity.projectId === projectId
      ? state.data : null;
}

function useStatusNotice(): string | null {
  const { t } = useTranslation(["workspace"]);
  const partial = useIndexStore((state) => analysisPartial(state.intelligenceState));
  return partial ? t(($) => $.workspace.structure.notice.partial) : null;
}

export function Outline({
  // The layout owns this, not the component: the sidebar collapses Structure
  // because Outline sits above it and answers the more common question. Left
  // expanded by default so rendering it on its own shows its content.
  defaultCollapsed = false,
  collapsed: controlledCollapsed,
  onCollapsedChange,
}: Readonly<{
  readonly defaultCollapsed?: boolean;
  readonly collapsed?: boolean;
  readonly onCollapsedChange?: (next: boolean) => void;
}> = {}) {
  const { t } = useTranslation(["workspace"]);
  const projectId = useFilesStore((state) => state.projectId);
  const currentSnapshot = useIndexStore((state) =>
    acceptedProjectSnapshot(state.intelligenceState, projectId),
  );
  const retainedSnapshot = useIndexStore((state) =>
    refreshingSnapshot(state.intelligenceState, projectId),
  );
  const analysisRunning = useIndexStore(
    (state) => state.intelligenceState.status === "running",
  );
  const [uncontrolledCollapsed, setUncontrolledCollapsed] =
    useState(defaultCollapsed);
  const collapsed = controlledCollapsed ?? uncontrolledCollapsed;
  const setOpen = (open: boolean) => {
    const next = !open;
    setUncontrolledCollapsed(next);
    onCollapsedChange?.(next);
  };
  const [filter, setFilter] = useState(
    () => readSidebarView(projectId, "structure")?.filter ?? "",
  );
  useSidebarViewMemory(projectId, "structure", { filter });
  const [expansionCommand, setExpansionCommand] =
    useState<IntelligenceTreeExpansionCommand | null>(null);
  const [treeExpansionState, setTreeExpansionState] =
    useState<IntelligenceTreeExpansionState>("none");
  const previousProjectId = useRef(projectId);

  useEffect(() => {
    if (previousProjectId.current === projectId) return;
    previousProjectId.current = projectId;
    setFilter(readSidebarView(projectId, "structure")?.filter ?? "");
    setExpansionCommand(null);
    setTreeExpansionState("none");
  }, [projectId]);

  const snapshot = currentSnapshot ?? retainedSnapshot;

  const nodes = useMemo(
    () => (snapshot ? buildProjectStructureNodes(snapshot) : []),
    [snapshot],
  );
  const nodeCount = useMemo(() => countNodes(nodes), [nodes]);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  useOverlayScrollbar(treeScrollRef);
  const scrollMemory = useScrollMemory({
    scrollRef: treeScrollRef,
    projectId,
    slot: "structure",
    ready: currentSnapshot !== null || nodeCount > 0,
  });
  const statusNotice = useStatusNotice();
  const notice = currentSnapshot ? statusNotice : null;
  const modelKey = snapshot?.identity.projectId;
  const expansionCommandKey = snapshot
    ? [
        snapshot.identity.projectId,
        snapshot.identity.projectRevision,
        snapshot.identity.requestGeneration,
      ].join(":")
    : undefined;
  const filterActive = filter.trim().length > 0;
  const sendExpansionCommand = (action: IntelligenceTreeExpansionCommand["action"]) => {
    if (!expansionCommandKey || filterActive) return;
    setExpansionCommand((current) => ({
      id: (current?.id ?? 0) + 1,
      action,
      modelKey: expansionCommandKey,
    }));
  };

  const navigate = useCallback((node: IntelligenceTreeNode) => {
    if (!node.target) return;
    // Retained rows stay visible, but their old source offsets cannot navigate.
    const latest = acceptedProjectSnapshot(
      useIndexStore.getState().intelligenceState,
      useFilesStore.getState().projectId,
    );
    if (!latest || latest !== snapshot) return;
    void navigateToProjectRange({
      path: node.target.path,
      range: { from: node.target.from, to: node.target.to },
      source: "outline",
    });
  }, [snapshot]);

  return (
    <SidebarSection
      id="project-structure"
      title={t(($) => $.workspace.structure.title)}
      icon={<ListTree aria-hidden className="size-3.5" />}
      ariaLabel={t(($) => $.workspace.structure.ariaLabel)}
      ariaBusy={analysisRunning}
      count={snapshot ? nodeCount : undefined}
      countLabel={
        snapshot
          ? t(($) => $.workspace.structure.itemCount, { count: nodeCount })
          : undefined
      }
      titleAdornment={
        notice ? (
          <Tooltip label={notice} side="right" delay={200}>
            <span className="flex shrink-0 items-center text-muted-foreground">
              <Info aria-hidden className="size-3.5" />
            </span>
          </Tooltip>
        ) : null
      }
      open={!collapsed}
      onOpenChange={setOpen}
      className={collapsed ? "shrink-0" : "h-full flex-1"}
      contentClassName="flex min-h-0 flex-1 flex-col pb-0"
      actions={
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={t(
            treeExpansionState === "collapsed"
              ? ($) => $.workspace.structure.expandAll
              : ($) => $.workspace.structure.collapseAll,
          )}
          title={t(
            treeExpansionState === "collapsed"
              ? ($) => $.workspace.structure.expandAll
              : ($) => $.workspace.structure.collapseAll,
          )}
          disabled={
            !snapshot || filterActive || treeExpansionState === "none"
          }
          onClick={() =>
            sendExpansionCommand(
              treeExpansionState === "collapsed"
                ? "expand-all"
                : "collapse-all",
            )
          }
        >
          {treeExpansionState === "collapsed" ? (
            <CopyPlus aria-hidden className="size-3.5" />
          ) : (
            <CopyMinus aria-hidden className="size-3.5" />
          )}
        </Button>
      }
    >
      <div className="shrink-0 border-b border-sidebar-border/65 px-2 py-1.5">
            <IntelligenceFilter
              value={filter}
              onChange={setFilter}
              label={t(($) => $.workspace.structure.filterLabel)}
              placeholder={t(($) => $.workspace.structure.filterPlaceholder)}
            />
      </div>

      {notice ? <output className="sr-only">{notice}</output> : null}

      <div
        ref={treeScrollRef}
        className="isolate min-h-0 flex-1 overflow-auto px-1 [scrollbar-width:thin]"
      >
            {currentSnapshot || nodeCount > 0 ? (
              <IntelligenceTree
                memoryProjectId={projectId}
                memorySlot="structure"
                scrollMemory={scrollMemory}
                label={t(($) => $.workspace.structure.treeLabel)}
                nodes={nodes}
                query={filter}
                modelKey={modelKey}
                expansionCommandKey={expansionCommandKey}
                expansionCommand={expansionCommand}
                onExpansionStateChange={setTreeExpansionState}
                onActivate={navigate}
                emptyMessage={
                  filter
                    ? t(($) => $.workspace.structure.noMatch, { query: filter.trim() })
                    : t(($) => $.workspace.structure.empty)
                }
              />
            ) : (
              <StructureUnavailable projectId={projectId} />
            )}
      </div>
    </SidebarSection>
  );
}
