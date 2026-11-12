import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type RefObject,
} from "react";
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type Layout,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import { KeptAliveSlot } from "@/components/layout/KeptAliveSlot";
import {
  FILE_SIDEBAR_MIN_WIDTH,
  assistantMinimumWidth,
  sidebarMinimumPercent,
  sidebarPanelGroupWidth,
} from "@/lib/assistant-layout";
import {
  PANEL_STYLE,
  expandedSize,
  hasStoredPanelLayout,
  panelLimitProps,
  percent,
  useDismissiblePanelLayout,
  useSeparatorKeyboard,
  useSteadyPanelWidth,
  type DismissiblePanel,
  type PanelLimits,
} from "@/lib/panel-layout";
import { cn } from "@/lib/utils";
import { workspacePanelId } from "@/lib/workspace-layout";
import {
  isLeaf,
  panelIdOf,
  panesOf,
  renderedChildren,
  reportSplitSizes,
  separatorIdAfter,
  storageOrder,
  type PaneId,
  type PaneNode,
  type PaneShown,
  type PaneSplit,
  type SplitDirection,
} from "@/store/pane-layout";

export interface PaneTreeConfig {
  readonly projectId: string | null;
  readonly shown: PaneShown;
  readonly workspaceHidden: boolean;
  readonly appFontSize: number;
  readonly hosts: Readonly<Record<PaneId, HTMLElement>>;
  readonly separatorHitArea: { coarse: number; fine: number };
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly onAssistantDismiss: () => void;
  readonly onTerminalDismiss: () => void;
}

const PaneTreeContext = createContext<PaneTreeConfig | null>(null);

export const PaneTreeProvider = PaneTreeContext.Provider;

const SIDEBAR_DEFAULT_PX = 340;
const TERMINAL_MIN_SIZE = 10;
const SPLIT_LIMITS: Readonly<Record<string, PanelLimits>> = { horizontal: { minSize: 25 }, document: {} };

function usePaneTree(): PaneTreeConfig {
  const config = useContext(PaneTreeContext);
  if (!config) throw new Error("PaneTreeGroup needs a PaneTreeProvider");
  return config;
}

function VHandle({ id, onKeyDownCapture }: Readonly<{ id: string; onKeyDownCapture: KeyboardEventHandler<HTMLElement> }>) {
  return (
    <Separator
      id={id}
      disableDoubleClick
      onKeyDownCapture={onKeyDownCapture}
      style={{ cursor: "col-resize" }}
      className="resize-handle-col group relative flex w-1.5 shrink-0 select-none bg-background"
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

function HHandle({ id, onKeyDownCapture }: Readonly<{ id: string; onKeyDownCapture: KeyboardEventHandler<HTMLElement> }>) {
  return (
    <Separator
      id={id}
      disableDoubleClick
      onKeyDownCapture={onKeyDownCapture}
      style={{ cursor: "row-resize" }}
      className={cn(
        "resize-handle-row group relative z-10 h-px select-none border-t bg-background",
        "before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
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

function share(px: number, groupPx: number, fallback: number, cap: number): number {
  return groupPx > 0 ? Math.min(cap, (px / groupPx) * 100) : fallback;
}

function assistantMaxSize(workspaceHidden: boolean, row: boolean): number {
  if (workspaceHidden) return 100;
  return row ? 55 : 85;
}

function limitsFor(node: PaneNode, row: boolean, groupPx: number, config: PaneTreeConfig): PanelLimits {
  if (!isLeaf(node)) return SPLIT_LIMITS[node.id] ?? { minSize: 10 };
  switch (node.pane) {
    case "sidebar":
      return row ? { minSize: sidebarMinimumPercent(groupPx, false, config.appFontSize), maxSize: 65 } : { minSize: 10 };
    case "assistant":
      return {
        minSize: row ? share(assistantMinimumWidth(config.appFontSize), groupPx, 22, 55) : 15,
        maxSize: assistantMaxSize(config.workspaceHidden, row),
        collapsible: true,
        collapsedSize: 0,
      };
    case "terminal":
      return { minSize: TERMINAL_MIN_SIZE, collapsible: true, collapsedSize: 0 };
    default:
      return { minSize: 15 };
  }
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

function useMeasuredSize(row: boolean, appFontSize: number): [(element: HTMLDivElement | null) => void, number] {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const measured = row ? rect.width : rect.height;
      if (measured) setSize(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, row]);
  return [setElement, row ? sidebarPanelGroupWidth(size, appFontSize) : size];
}

export function PaneTreeGroup({ node, root = false }: Readonly<{ node: PaneSplit; root?: boolean }>) {
  const config = usePaneTree();
  const row = node.direction === "row";
  const groupId = config.projectId ? workspacePanelId(config.projectId, node.id) : undefined;
  const rendered = renderedChildren(node, config.shown);
  const order = useMemo(() => storageOrder(node.children.map(panelIdOf)), [node]);
  const visibleKey = storageOrder(rendered.map(panelIdOf)).join(",");
  const visibleOrder = useMemo(() => (visibleKey ? visibleKey.split(",") : []), [visibleKey]);
  const groupRef = useRef<GroupImperativeHandle>(null);
  const sidebarRef = useRef<PanelImperativeHandle>(null);
  const [measure, groupPx] = useMeasuredSize(row, config.appFontSize);
  const elementRef = useCallback(
    (element: HTMLDivElement | null) => {
      measure(element);
      if (root) config.rootRef.current = element;
    },
    [config.rootRef, measure, root],
  );
  const limitsKey = JSON.stringify(
    Object.fromEntries(
      rendered.map((child) => {
        const limits = limitsFor(child, row, groupPx, config);
        const alone = rendered.length === 1;
        return [panelIdOf(child), alone && limits.maxSize !== undefined ? { ...limits, maxSize: 100 } : limits];
      }),
    ),
  );
  const limits = useMemo(() => JSON.parse(limitsKey) as Record<string, PanelLimits>, [limitsKey]);
  const shareOf = (child: PaneNode) => node.sizes[node.children.indexOf(child)] ?? 0;
  const terminalSize = groupId ? expandedSize(groupId, "terminal") : undefined;
  const dismissSize = (pane: PaneId, size: number) => {
    if (pane !== "terminal") return Math.max(size, limits[pane]?.minSize ?? 0);
    return terminalSize !== undefined && terminalSize >= TERMINAL_MIN_SIZE ? terminalSize : size;
  };
  const dismissKey = JSON.stringify(
    rendered.flatMap((child) =>
      isLeaf(child) && (child.pane === "assistant" || child.pane === "terminal")
        ? [[child.pane, dismissSize(child.pane, shareOf(child))] as const]
        : [],
    ),
  );
  const { onAssistantDismiss, onTerminalDismiss } = config;
  const dismissibles = useMemo<DismissiblePanel[]>(
    () =>
      (JSON.parse(dismissKey) as [PaneId, number][]).map(([id, defaultSize]) => ({
        id,
        defaultSize,
        onDismiss: id === "terminal" ? onTerminalDismiss : onAssistantDismiss,
      })),
    [dismissKey, onAssistantDismiss, onTerminalDismiss],
  );
  const layout = useDismissiblePanelLayout(groupRef, groupId, order, visibleOrder, limits, dismissibles);
  const onKeyDown = useSeparatorKeyboard(groupRef, limits);
  const { onLayoutChange: trackDismissed } = layout;
  const onLayoutChange = useCallback(
    (next: Layout) => {
      reportSplitSizes(node.id, next);
      trackDismissed(next);
    },
    [node.id, trackDismissed],
  );
  useEffect(() => () => reportSplitSizes(node.id, null), [node.id]);
  const holdsSidebar = row && rendered.some((child) => isLeaf(child) && child.pane === "sidebar");
  const sidebarDefault = share(SIDEBAR_DEFAULT_PX, groupPx, 15, 65);
  const storedAtMount = useMemo(() => (groupId ? hasStoredPanelLayout(groupId) : false), [groupId]);
  useSteadyPanelWidth({
    panelRef: sidebarRef,
    active: holdsSidebar,
    groupWidth: groupPx,
    defaultSize: sidebarDefault,
    applyDefault: !storedAtMount,
  });
  const fill = rendered.reduce<PaneNode | undefined>(
    (best, child) => (best === undefined || shareOf(child) > shareOf(best) ? child : best),
    undefined,
  );

  const defaultSizeOf = (child: PaneNode): number | undefined => {
    if (child === fill) return undefined;
    if (!isLeaf(child)) return shareOf(child);
    if (child.pane === "sidebar" && row) return sidebarDefault;
    return child.pane === "assistant" || child.pane === "terminal" ? dismissSize(child.pane, shareOf(child)) : shareOf(child);
  };

  const panelFor = (child: PaneNode, index: number) => {
    const id = panelIdOf(child);
    const defaultSize = defaultSizeOf(child);
    const pane = isLeaf(child) ? child.pane : null;
    return (
      <Panel
        key={id}
        panelRef={pane === "sidebar" ? sidebarRef : undefined}
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
          <PaneTreeGroup key={(child as PaneSplit).id} node={child as PaneSplit} />
        )}
      </Panel>
    );
  };

  const Handle = row ? VHandle : HHandle;

  return (
    <Group
      groupRef={groupRef}
      elementRef={elementRef}
      orientation={row ? "horizontal" : "vertical"}
      defaultLayout={layout.defaultLayout}
      onLayoutChange={onLayoutChange}
      onLayoutChanged={layout.onLayoutChanged}
      resizeTargetMinimumSize={config.separatorHitArea}
      className={root ? "min-h-0 min-w-0 flex-1" : "h-full min-h-0 min-w-0"}
    >
      {rendered.flatMap((child, index) => {
        const panel = panelFor(child, index);
        const previous = rendered[index - 1];
        if (!previous) return [panel];
        const id = separatorIdAfter(node, previous);
        return [<Handle key={id} id={id} onKeyDownCapture={onKeyDown} />, panel];
      })}
    </Group>
  );
}
