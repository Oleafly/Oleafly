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
}: {
  state: ProjectIntelligenceState;
  projectId: string | null;
  activePath: string | null;
}) {
  if (!projectId) {
    return (
      <PanelState
        state="empty"
        title="No project open"
        detail="Open a document project to browse its local and project structure."
      />
    );
  }
  if (!activePath) {
    return (
      <PanelState
        state="empty"
        title="No active source"
        detail="Open a supported source or bibliography file to see its structure."
      />
    );
  }

  switch (state.status) {
    case "running":
    case "not_run":
      return (
        <PanelState
          state="pending"
          title="Mapping project structure"
          detail="Oleafly is indexing headings, linked files, symbols, and bibliography entries."
        />
      );
    case "unsupported":
      return (
        <PanelState
          state="unsupported"
          title="Structure is unavailable"
          detail={
            state.reason ??
            "This file type does not have a project-structure provider."
          }
        />
      );
    case "unavailable":
      return (
        <PanelState
          state="error"
          title="Structure service unavailable"
          detail={
            state.reason ??
            "Project analysis is not available for this workspace right now."
          }
        />
      );
    case "error":
      return (
        <PanelState
          state="error"
          title="Structure could not be built"
          detail={
            state.failure?.message ??
            state.reason ??
            "The project could not be analyzed. Your source files were not changed."
          }
        />
      );
    default:
      return (
        <PanelState
          state="pending"
          title="Waiting for project structure"
          detail="The latest project revision has not been indexed yet."
        />
      );
  }
}

function statusNotice(state: ProjectIntelligenceState): string | null {
  if (state.stale) {
    return "Updating. Previous-revision structure is hidden until current source ranges are ready.";
  }
  if (state.status === "partial" || state.data?.status === "partial") {
    return "Partial map. Unreadable or malformed files remain visible where possible.";
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
}: {
  readonly defaultCollapsed?: boolean;
  readonly collapsed?: boolean;
  readonly onCollapsedChange?: (next: boolean) => void;
} = {}) {
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
  const notice = statusNotice(intelligenceState);

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
      aria-label="Document structure"
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
          <span className="truncate">Structure</span>
          {notice ? (
            <span
              title={notice}
              className="flex shrink-0 items-center text-amber-600 dark:text-amber-400"
            >
              <Info aria-hidden className="size-3.5" />
            </span>
          ) : null}
          {snapshot ? (
            <span
              role="status"
              aria-label={`${nodeCount} structure items`}
              className="ml-auto shrink-0 rounded-sm bg-muted px-1 font-mono text-[9px] text-muted-foreground"
            >
              {nodeCount}
            </span>
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
              label="Filter project structure"
              placeholder="Filter project map…"
            />
          </div>

          {notice ? (
            <div role="status" className="sr-only">
              {notice}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto px-1 [scrollbar-width:thin]">
            {snapshot ? (
              <IntelligenceTree
                label="Project structure"
                nodes={nodes}
                query={filter}
                onActivate={navigate}
                emptyMessage={
                  filter
                    ? `No structure matches “${filter.trim()}”.`
                    : "No supported files are present in the project map."
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
