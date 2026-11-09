import { createContext, useCallback, useContext, useMemo, useRef, type KeyboardEventHandler, type RefObject } from "react";
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type Layout,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import { KeptAliveSlot } from "@/components/layout/KeptAliveSlot";
import { FILE_SIDEBAR_MIN_WIDTH } from "@/lib/assistant-layout";
import {
  PANEL_STYLE,
  panelLimitProps,
  percent,
  useCollapseTransitions,
  useDismissiblePanelLayout,
  useSeparatorKeyboard,
  type PanelLimits,
} from "@/lib/panel-layout";
import { cn } from "@/lib/utils";
import { workspacePanelId } from "@/lib/workspace-layout";
import {
  groupDomIdOf,
  groupNameOf,
  isLeaf,
  legacyGroupOf,
  panelIdOf,
  nodeShown,
  panesOf,
  renderedChildren,
  separatorIdOf,
  storageOrderOf,
  type PaneId,
  type PaneNode,
  type PaneShown,
  type PaneSplit,
  type SplitDirection,
} from "@/store/pane-layout";

export interface PaneTreeConfig {
  readonly projectId: string | null;
  readonly shown: PaneShown;
  readonly terminalOpen: boolean;
  readonly workspaceHidden: boolean;
  readonly showTree: boolean;
  readonly documentDefaultSize: number;
  readonly sidebarDefaultSize: number;
  readonly sidebarMinSize: number;
  readonly assistantMinSize: number;
  readonly assistantDefaultSize: number;
  readonly hosts: Readonly<Record<PaneId, HTMLElement>>;
  readonly panelRefs: Readonly<Record<PaneId, RefObject<PanelImperativeHandle | null>>>;
  readonly separatorHitArea: { coarse: number; fine: number };
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly onAssistantDismiss: () => void;
  readonly onTerminalCollapse: () => void;
  readonly onTerminalExpand: () => void;
}

const PaneTreeContext = createContext<PaneTreeConfig | null>(null);

export const PaneTreeProvider = PaneTreeContext.Provider;

function usePaneTree(): PaneTreeConfig {
  const config = useContext(PaneTreeContext);
  if (!config) throw new Error("PaneTreeGroup needs a PaneTreeProvider");
  return config;
}

function VHandle({
  id,
  collapsed,
  onKeyDownCapture,
}: Readonly<{
  id: string;
  collapsed?: boolean;
  onKeyDownCapture: KeyboardEventHandler<HTMLElement>;
}>) {
  return (
    <Separator
      id={id}
      {...(collapsed === undefined ? {} : { disabled: collapsed })}
      disableDoubleClick
      onKeyDownCapture={onKeyDownCapture}
      style={{ cursor: "col-resize" }}
      className={cn(
        "resize-handle-col group relative flex w-1.5 shrink-0 select-none bg-background",
        collapsed && "invisible w-0 overflow-hidden",
      )}
    >
      <span className={cn("absolute inset-0 flex items-center justify-center", "transition-colors hover:bg-accent/40")}>
        <span
          className={cn(
            "pointer-events-none h-10 w-1 rounded-full bg-border opacity-0 transition-[opacity,background-color]",
            "group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[separator=active]:opacity-100",
            "group-hover:bg-ring group-data-[separator=active]:bg-ring",
          )}
        />
      </span>
    </Separator>
  );
}

function HHandle({
  id,
  collapsed,
  onKeyDownCapture,
}: Readonly<{
  id: string;
  collapsed?: boolean;
  onKeyDownCapture: KeyboardEventHandler<HTMLElement>;
}>) {
  return (
    <Separator
      id={id}
      {...(collapsed === undefined ? {} : { disabled: collapsed })}
      disableDoubleClick
      onKeyDownCapture={onKeyDownCapture}
      style={{ cursor: "row-resize" }}
      className={cn(
        "resize-handle-row group relative z-10 h-px select-none border-t bg-background",
        "before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
        collapsed && "invisible h-0 overflow-hidden border-t-0",
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 opacity-0 transition-opacity",
          "bg-[color-mix(in_srgb,var(--ring)_40%,var(--background))]",
          "group-hover:opacity-100 group-data-[separator=hover]:opacity-100 group-data-[separator=active]:opacity-100",
        )}
      />
    </Separator>
  );
}

function limitsFor(node: PaneNode, direction: SplitDirection, config: PaneTreeConfig): PanelLimits {
  if (!isLeaf(node)) {
    const id = panelIdOf(node);
    if (id === "content-band") return { minSize: 25 };
    return id === "editorpdf" ? {} : { minSize: 10 };
  }
  switch (node.pane) {
    case "sidebar":
      return direction === "row" ? { minSize: config.sidebarMinSize, maxSize: 65 } : { minSize: 10 };
    case "assistant":
      return {
        minSize: direction === "row" ? config.assistantMinSize : 15,
        maxSize: config.workspaceHidden ? 100 : direction === "row" ? 55 : 85,
        collapsible: true,
        collapsedSize: 0,
      };
    case "terminal":
      return { minSize: 10, collapsible: true, collapsedSize: 0 };
    default:
      return { minSize: 15 };
  }
}

function legacyDefaultSize(id: string, config: PaneTreeConfig): number | undefined {
  switch (id) {
    case "content-band":
      return 72;
    case "terminal":
      return 28;
    case "sidebar":
      return config.sidebarDefaultSize;
    case "editorpdf":
      return config.showTree ? 85 : 100;
    case "assistant":
      return config.assistantDefaultSize;
    case "editor":
    case "pdf":
      return config.documentDefaultSize;
    default:
      return undefined;
  }
}

function sharedSizes(node: PaneSplit, rendered: readonly PaneNode[], terminalOpen: boolean): Layout {
  const weights = rendered.map((child) => {
    if (isLeaf(child) && child.pane === "terminal" && !terminalOpen) return 0;
    const size = node.sizes[node.children.indexOf(child)];
    return size !== undefined && size > 0 ? size : 1;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return Object.fromEntries(rendered.map((child, index) => [panelIdOf(child), ((weights[index] ?? 0) / total) * 100]));
}

function borderClass(direction: SplitDirection, index: number, count: number): string {
  if (direction === "column") {
    if (index === count - 1) return "border-t";
    return index === 0 ? "border-b" : "border-y";
  }
  if (index === count - 1) return "border-l";
  return index === 0 ? "border-r" : "border-x";
}

function holdsSidebarWidth(node: PaneNode): boolean {
  if (isLeaf(node)) return node.pane === "sidebar";
  return node.direction === "column" && panesOf(node).includes("sidebar");
}

export function PaneTreeGroup({ node, root = false }: Readonly<{ node: PaneSplit; root?: boolean }>) {
  const config = usePaneTree();
  const legacy = legacyGroupOf(node);
  const name = groupNameOf(node);
  const groupId = config.projectId ? workspacePanelId(config.projectId, name) : undefined;
  const childIds = node.children.map(panelIdOf);
  const rendered = renderedChildren(node, config.shown);
  const renderedIds = rendered.map(panelIdOf);
  const order = storageOrderOf(node);
  const visibleOrder = order.filter((id) => renderedIds.includes(id));
  const groupRef = useRef<GroupImperativeHandle>(null);
  const shownCount = rendered.filter((child) => nodeShown(child, config.shown)).length;
  const limitsKey = JSON.stringify(
    Object.fromEntries(
      node.children.map((child, index) => {
        const limits = limitsFor(child, node.direction, config);
        const alone = shownCount === 1 && nodeShown(child, config.shown);
        return [childIds[index], alone && limits.maxSize !== undefined ? { ...limits, maxSize: 100 } : limits];
      }),
    ),
  );
  const limits = useMemo(() => JSON.parse(limitsKey) as Record<string, PanelLimits>, [limitsKey]);
  const hasTerminal = childIds.includes("terminal");
  const assistantDefault = node.direction === "row" ? config.assistantDefaultSize : 30;
  const { onAssistantDismiss, onTerminalCollapse, onTerminalExpand } = config;
  const dismissible = useMemo(
    () => ({ id: "assistant", defaultSize: assistantDefault, onDismiss: onAssistantDismiss }),
    [assistantDefault, onAssistantDismiss],
  );
  const layout = useDismissiblePanelLayout(groupRef, groupId, order, visibleOrder, limits, dismissible);
  const trackTerminal = useCollapseTransitions();
  const onKeyDown = useSeparatorKeyboard(groupRef, limits);
  const { onLayoutChange: trackAssistant } = layout;
  const onLayoutChange = useCallback(
    (next: Layout) => {
      trackAssistant(next);
      if (!hasTerminal) return;
      trackTerminal(next, {
        terminal: { collapsedSize: 0, onCollapse: onTerminalCollapse, onExpand: onTerminalExpand },
      });
    },
    [hasTerminal, onTerminalCollapse, onTerminalExpand, trackAssistant, trackTerminal],
  );
  const computed = legacy ? undefined : sharedSizes(node, rendered, config.terminalOpen);
  const fallbackLayout =
    legacy === "vertical"
      ? { "content-band": config.terminalOpen ? 72 : 100, terminal: config.terminalOpen ? 28 : 0 }
      : computed;

  const panelFor = (child: PaneNode, index: number) => {
    const id = panelIdOf(child);
    const defaultSize = legacy ? legacyDefaultSize(id, config) : computed?.[id];
    const row = node.direction === "row";
    const pane = isLeaf(child) ? child.pane : null;
    return (
      <Panel
        key={id}
        panelRef={pane ? config.panelRefs[pane] : undefined}
        id={id}
        defaultSize={defaultSize === undefined ? undefined : percent(defaultSize)}
        {...panelLimitProps(limits[id] ?? {})}
        {...(pane === "sidebar" && row ? { minSize: `${FILE_SIDEBAR_MIN_WIDTH}px` } : {})}
        {...(row && holdsSidebarWidth(child) ? { groupResizeBehavior: "preserve-pixel-size" as const } : {})}
        style={PANEL_STYLE}
        className={cn(
          pane === "sidebar" ? "bg-sidebar" : "min-h-0 min-w-0",
          pane === "assistant" && borderClass(node.direction, index, rendered.length),
        )}
      >
        {pane ? (
          <KeptAliveSlot host={config.hosts[pane]} className="h-full min-h-0 min-w-0" />
        ) : (
          <PaneTreeGroup key={groupNameOf(child as PaneSplit)} node={child as PaneSplit} />
        )}
      </Panel>
    );
  };

  const Handle = node.direction === "row" ? VHandle : HHandle;

  return (
    <Group
      id={groupDomIdOf(node)}
      groupRef={groupRef}
      elementRef={root ? config.rootRef : undefined}
      orientation={node.direction === "row" ? "horizontal" : "vertical"}
      defaultLayout={layout.defaultLayout ?? fallbackLayout}
      onLayoutChange={onLayoutChange}
      onLayoutChanged={layout.onLayoutChanged}
      resizeTargetMinimumSize={config.separatorHitArea}
      className={root ? "min-h-0 min-w-0 flex-1" : "h-full min-h-0 min-w-0"}
    >
      {rendered.flatMap((child, index) => {
        const panel = panelFor(child, index);
        const previous = rendered[index - 1];
        if (!previous) return [panel];
        const left = panelIdOf(previous);
        const right = renderedIds[index] ?? "";
        const id = separatorIdOf(node, renderedIds, left, right);
        const touchesTerminal = left === "terminal" || right === "terminal";
        return [
          <Handle
            key={id}
            id={id}
            collapsed={touchesTerminal ? !config.terminalOpen : undefined}
            onKeyDownCapture={onKeyDown}
          />,
          panel,
        ];
      })}
    </Group>
  );
}
