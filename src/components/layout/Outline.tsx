import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Info, ListTree } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  IntelligenceFilter,
  IntelligenceTree,
  PanelState,
  type IntelligenceTreeNode,
} from "@/components/layout/IntelligenceTree";
import { buildProjectStructureNodes } from "@/components/layout/project-intelligence-view";
import { cn } from "@/lib/utils";
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
  const toggleCollapsed = () => {
    setUncontrolledCollapsed(!collapsed);
    onCollapsedChange?.(!collapsed);
  };
  const [filter, setFilter] = useState("");

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

  const navigate = useCallback((node: IntelligenceTreeNode) => {
    if (!node.target) return;
    void navigateToProjectRange({
      path: node.target.path,
      range: { from: node.target.from, to: node.target.to },
      source: "outline",
    });
  }, []);

  return (
    <section
      aria-label={t(($) => $.workspace.structure.ariaLabel)}
      aria-busy={intelligenceState.status === "running"}
      className={cn(
        "flex min-h-0 flex-col border-t border-sidebar-border",
        collapsed ? "shrink-0" : "flex-1",
      )}
    >
      <div className="flex h-8 shrink-0 items-center border-b border-sidebar-border/65">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls="project-structure-content"
          onClick={toggleCollapsed}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/75 hover:bg-sidebar-accent"
        >
          {collapsed ? (
            <ChevronRight aria-hidden className="size-3" />
          ) : (
            <ChevronDown aria-hidden className="size-3" />
          )}
          <ListTree aria-hidden className="size-3.5" />
          <span className="truncate">{t(($) => $.workspace.structure.title)}</span>
          {notice ? (
            <span
              title={notice}
              className="flex shrink-0 items-center text-amber-600 dark:text-amber-400"
            >
              <Info aria-hidden className="size-3.5" />
            </span>
          ) : null}
          {snapshot ? (
            <output
              aria-label={t(($) => $.workspace.structure.itemCount, { count: nodeCount })}
              className="ml-auto shrink-0 rounded-sm bg-muted px-1 font-mono text-[9px] text-muted-foreground"
            >
              {nodeCount}
            </output>
          ) : null}
        </button>
      </div>

      {!collapsed ? (
        <div
          id="project-structure-content"
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="shrink-0 border-b border-sidebar-border/65 px-2 py-1.5">
            <IntelligenceFilter
              value={filter}
              onChange={setFilter}
              label={t(($) => $.workspace.structure.filterLabel)}
              placeholder={t(($) => $.workspace.structure.filterPlaceholder)}
            />
          </div>

          {notice ? (
            <output className="sr-only">{notice}</output>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto px-1 [scrollbar-width:thin]">
            {snapshot ? (
              <IntelligenceTree
                label={t(($) => $.workspace.structure.treeLabel)}
                nodes={nodes}
                query={filter}
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
        </div>
      ) : null}
    </section>
  );
}
