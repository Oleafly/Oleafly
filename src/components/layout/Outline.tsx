import { useTranslation } from "react-i18next";
import { CopyMinus, CopyPlus, Info, ListTree } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
import type { ProjectIntelligenceState } from "@/lib/project-intelligence/types";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

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
  state,
  projectId,
  activePath,
}: Readonly<{
  state: ProjectIntelligenceState;
  projectId: string | null;
  activePath: string | null;
}>) {
  const { t } = useTranslation(["workspace"]);
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

  switch (state.status) {
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
          detail={
            projectIntelligenceReasonText(state.reason) ??
            t(($) => $.workspace.structure.unavailable.unsupported.detail)
          }
        />
      );
    case "unavailable":
      return (
        <PanelState
          state="error"
          title={t(($) => $.workspace.structure.unavailable.offline.title)}
          detail={
            projectIntelligenceReasonText(state.reason) ??
            t(($) => $.workspace.structure.unavailable.offline.detail)
          }
        />
      );
    case "error":
      return (
        <PanelState
          state="error"
          title={t(($) => $.workspace.structure.unavailable.failed.title)}
          detail={
            projectIntelligenceFailureText(state) ??
            t(($) => $.workspace.structure.unavailable.failed.detail)
          }
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

function useStatusNotice(state: ProjectIntelligenceState): string | null {
  const { t } = useTranslation(["workspace"]);
  if (state.stale) {
    return t(($) => $.workspace.structure.notice.stale);
  }
  if (state.status === "partial" || state.data?.status === "partial") {
    return t(($) => $.workspace.structure.notice.partial);
  }
  return null;
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
  const intelligenceState = useIndexStore((state) => state.intelligenceState);
  const activePath = useFilesStore((state) => state.activePath);
  const projectId = useFilesStore((state) => state.projectId);
  const [uncontrolledCollapsed, setUncontrolledCollapsed] =
    useState(defaultCollapsed);
  const collapsed = controlledCollapsed ?? uncontrolledCollapsed;
  const setOpen = (open: boolean) => {
    const next = !open;
    setUncontrolledCollapsed(next);
    onCollapsedChange?.(next);
  };
  const [filter, setFilter] = useState("");
  const [expansionCommand, setExpansionCommand] =
    useState<IntelligenceTreeExpansionCommand | null>(null);
  const [treeExpansionState, setTreeExpansionState] =
    useState<IntelligenceTreeExpansionState>("none");
  const previousProjectId = useRef(projectId);

  useEffect(() => {
    if (previousProjectId.current === projectId) return;
    previousProjectId.current = projectId;
    setFilter("");
    setExpansionCommand(null);
    setTreeExpansionState("none");
  }, [projectId]);

  const snapshot = acceptedProjectSnapshot(
    intelligenceState,
    projectId,
  );

  const nodes = useMemo(
    () => (snapshot ? buildProjectStructureNodes(snapshot) : []),
    [snapshot],
  );
  const nodeCount = useMemo(() => countNodes(nodes), [nodes]);
  const notice = useStatusNotice(intelligenceState);
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
    void navigateToProjectRange({
      path: node.target.path,
      range: { from: node.target.from, to: node.target.to },
      source: "outline",
    });
  }, []);

  return (
    <SidebarSection
      id="project-structure"
      title={t(($) => $.workspace.structure.title)}
      icon={<ListTree aria-hidden className="size-3.5" />}
      ariaLabel={t(($) => $.workspace.structure.ariaLabel)}
      ariaBusy={intelligenceState.status === "running"}
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

      <div className="min-h-0 flex-1 overflow-auto px-1 [scrollbar-width:thin]">
            {snapshot ? (
              <IntelligenceTree
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
              <StructureUnavailable
                state={intelligenceState}
                projectId={projectId}
                activePath={activePath}
              />
            )}
      </div>
    </SidebarSection>
  );
}
