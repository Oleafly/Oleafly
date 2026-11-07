import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  activate,
  closeGroup,
  closeView,
  evenPair,
  findNode,
  groupsOf,
  MIN_WEIGHT,
  moveView,
  resizeSplit,
  sameLayout,
  toggleMaximize,
  type DropTarget,
  type DropZone,
  type GroupNode,
  type LayoutNode,
  type SplitNode,
  type ViewState,
  type WorkspaceLayout,
} from "./layout";

export interface ViewInfo {
  title: string;
  icon?: ReactNode;
  closable?: boolean;
}

export interface WorkspaceLabels {
  closeTab: (title: string) => string;
  closePanel: string;
  newTab: string;
  maximize: string;
  restore: string;
  resize: string;
}

export interface WorkspaceProps {
  layout: WorkspaceLayout;
  onLayoutChange: (layout: WorkspaceLayout) => void;
  renderView: (id: string, view: ViewState) => ReactNode;
  describeView: (id: string, view: ViewState) => ViewInfo;
  labels: WorkspaceLabels;
  groupActions?: (group: GroupNode) => ReactNode;
  empty?: ReactNode | ((group: GroupNode) => ReactNode);
  onFocusView?: (id: string) => void;
  onNewTab?: (groupId: string) => void;
  stageCandidate?: (group: GroupNode) => boolean;
  canDrop?: (id: string, target: DropTarget) => boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  chromeAttributes?: Readonly<Record<string, string>>;
  className?: string;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DragState {
  id: string;
  title: string;
  x: number;
  y: number;
  target: DropTarget | null;
  indicator: Rect | null;
}

function cornerGroup(node: LayoutNode, side: "left" | "right"): string {
  if (node.kind === "group") return node.id;
  const pick = node.direction === "row" && side === "right" ? node.children.at(-1) : node.children[0];
  return pick ? cornerGroup(pick, side) : node.id;
}

function topRow(node: LayoutNode): string[] {
  if (node.kind === "group") return [node.id];
  if (node.direction === "row") return node.children.flatMap(topRow);
  return node.children[0] ? topRow(node.children[0]) : [];
}

const DRAG_START_PX = 6;
const EDGE = 0.25;
const KEY_STEP = 0.02;
const BIG_KEY_STEP = 0.1;
const MIN_ROW_PX = 160;
const MIN_COLUMN_PX = 120;

function relativeRect(element: Element, origin: DOMRect): Rect {
  const box = element.getBoundingClientRect();
  return { left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height };
}

function sameRects(left: Record<string, Rect>, right: Record<string, Rect>): boolean {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => {
    const a = left[key];
    const b = right[key];
    return b !== undefined && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
  });
}

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;
}

export function zoneAt(rect: Rect, x: number, y: number): DropZone {
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const edges: [DropZone, number][] = [
    ["left", fx],
    ["right", 1 - fx],
    ["top", fy],
    ["bottom", 1 - fy],
  ];
  const [zone, distance] = edges.reduce((best, edge) => (edge[1] < best[1] ? edge : best));
  return distance < EDGE ? zone : "center";
}

export function zoneRect(rect: Rect, zone: DropZone): Rect {
  if (zone === "left") return { ...rect, width: rect.width / 2 };
  if (zone === "right") return { ...rect, left: rect.left + rect.width / 2, width: rect.width / 2 };
  if (zone === "top") return { ...rect, height: rect.height / 2 };
  if (zone === "bottom") return { ...rect, top: rect.top + rect.height / 2, height: rect.height / 2 };
  return rect;
}

function CloseIcon({ className = "size-3" }: Readonly<{ className?: string }>) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 3v10M3 8h10" strokeLinecap="round" />
    </svg>
  );
}

const BAR_BUTTON =
  "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent";

function MaximizeIcon({ restore }: Readonly<{ restore: boolean }>) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      {restore ? (
        <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

interface ViewHostProps {
  id: string;
  view: ViewState;
  rect: Rect | undefined;
  visible: boolean;
  interactive: boolean;
  panelId: string;
  tabId: string;
  render: (id: string, view: ViewState) => ReactNode;
  onFocus?: (id: string) => void;
}

const ViewHost = memo(function ViewHost({
  id,
  view,
  rect,
  visible,
  interactive,
  panelId,
  tabId,
  render,
  onFocus,
}: Readonly<ViewHostProps>) {
  const content = useMemo(() => render(id, view), [render, id, view]);
  const placed = rect !== undefined;
  const shown = visible && placed;
  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      aria-hidden={shown ? undefined : true}
      data-view={id}
      data-shown={shown}
      hidden={!placed}
      inert={!shown}
      onPointerDownCapture={onFocus ? () => onFocus(id) : undefined}
      onFocusCapture={onFocus ? () => onFocus(id) : undefined}
      className={[
        "absolute z-10 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-b-md bg-background",
        shown ? "" : "invisible",
        interactive ? "" : "pointer-events-none select-none",
      ].join(" ")}
      style={rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined}
    >
      {content}
    </div>
  );
});

export function Workspace({
  layout,
  onLayoutChange,
  renderView,
  describeView,
  labels,
  groupActions,
  empty,
  onFocusView,
  onNewTab,
  stageCandidate,
  canDrop,
  leading,
  trailing,
  chromeAttributes,
  className,
}: Readonly<WorkspaceProps>) {
  const prefix = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const slots = useRef(new Map<string, HTMLElement>());
  const strips = useRef(new Map<string, HTMLElement>());
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  const [resizing, setResizing] = useState(false);
  const known = useRef<Record<string, Rect>>({});
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const changeRef = useRef(onLayoutChange);
  changeRef.current = onLayoutChange;
  const suppressClick = useRef(false);
  const stopGesture = useRef<(() => void) | null>(null);

  useEffect(() => () => stopGesture.current?.(), []);

  const tabId = useCallback((id: string) => `${prefix}-tab-${id}`, [prefix]);
  const panelId = useCallback((id: string) => `${prefix}-panel-${id}`, [prefix]);

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    const next: Record<string, Rect> = {};
    for (const [id, element] of slots.current) {
      if (element.isConnected) next[id] = relativeRect(element, origin);
    }
    known.current = { ...known.current, ...next };
    setRects((current) => (sameRects(current, next) ? current : next));
  }, []);

  useLayoutEffect(measure);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(root);
    for (const element of slots.current.values()) observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  });

  const slotRef = useCallback(
    (groupId: string) => (element: HTMLElement | null) => {
      if (element) slots.current.set(groupId, element);
      else slots.current.delete(groupId);
    },
    [],
  );
  const stripRef = useCallback(
    (groupId: string) => (element: HTMLElement | null) => {
      if (element) strips.current.set(groupId, element);
      else strips.current.delete(groupId);
    },
    [],
  );

  const change = useCallback((next: WorkspaceLayout) => {
    if (!sameLayout(next, layoutRef.current)) changeRef.current(next);
  }, []);

  const select = useCallback(
    (id: string) => {
      change(activate(layoutRef.current, id));
      onFocusView?.(id);
    },
    [change, onFocusView],
  );

  const close = useCallback((id: string) => change(closeView(layoutRef.current, id)), [change]);

  const targetAt = useCallback(
    (id: string, x: number, y: number): { target: DropTarget; indicator: Rect } | null => {
      const root = rootRef.current;
      if (!root) return null;
      const origin = root.getBoundingClientRect();
      const px = x - origin.left;
      const py = y - origin.top;
      for (const [groupId, strip] of strips.current) {
        const rect = relativeRect(strip, origin);
        if (!contains(rect, px, py)) continue;
        const tabs = [...strip.querySelectorAll<HTMLElement>("[data-tab-view]")];
        const index = tabs.findIndex((tab) => {
          const box = relativeRect(tab, origin);
          return px < box.left + box.width / 2;
        });
        return { target: { groupId, zone: "center", index: index < 0 ? tabs.length : index }, indicator: rect };
      }
      for (const [groupId, rect] of Object.entries(rects)) {
        if (!contains(rect, px, py)) continue;
        const zone = zoneAt(rect, px, py);
        const owner = groupsOf(layoutRef.current.root).find((group) => group.views.includes(id));
        if (owner?.id === groupId && zone !== "center" && owner.views.length === 1) return null;
        return { target: { groupId, zone }, indicator: zoneRect(rect, zone) };
      }
      return null;
    },
    [rects],
  );

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string, title: string) => {
      if (event.button !== 0) return;
      suppressClick.current = false;
      stopGesture.current?.();
      const startX = event.clientX;
      const startY = event.clientY;
      let active = false;
      const move = (moveEvent: PointerEvent) => {
        if (!active && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_START_PX) return;
        active = true;
        const found = targetAt(id, moveEvent.clientX, moveEvent.clientY);
        const allowed = found && (!canDrop || canDrop(id, found.target)) ? found : null;
        setDrag({
          id,
          title,
          x: moveEvent.clientX,
          y: moveEvent.clientY,
          target: allowed?.target ?? null,
          indicator: allowed?.indicator ?? null,
        });
      };
      const finish = (commit: boolean) => {
        stopGesture.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", escape, true);
        window.removeEventListener("blur", cancel);
        setDrag((current) => {
          if (commit && current?.target) {
            const next = moveView(layoutRef.current, id, current.target);
            queueMicrotask(() => change(next));
          }
          return null;
        });
        if (active) {
          suppressClick.current = true;
          setTimeout(() => {
            suppressClick.current = false;
          }, 0);
        }
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const escape = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key !== "Escape") return;
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        finish(false);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", escape, true);
      window.addEventListener("blur", cancel);
      stopGesture.current = cancel;
    },
    [canDrop, change, targetAt],
  );

  const tabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, group: GroupNode, id: string, closable: boolean) => {
      const index = group.views.indexOf(id);
      let next: string | undefined;
      if (event.key === "ArrowRight") next = group.views[(index + 1) % group.views.length];
      else if (event.key === "ArrowLeft") next = group.views[(index - 1 + group.views.length) % group.views.length];
      else if (event.key === "Home") next = group.views[0];
      else if (event.key === "End") next = group.views.at(-1);
      else if (event.key === "Delete" && closable) {
        event.preventDefault();
        const neighbour = group.views[index + 1] ?? group.views[index - 1];
        close(id);
        if (neighbour) {
          requestAnimationFrame(() => {
            select(neighbour);
            document.getElementById(tabId(neighbour))?.focus();
          });
        }
        return;
      }
      if (next === undefined) return;
      event.preventDefault();
      select(next);
      document.getElementById(tabId(next))?.focus();
    },
    [close, select, tabId],
  );

  const shownRoot = (layout.maximized ? findNode(layout.root, layout.maximized) : null) ?? layout.root;
  const leadingGroup = cornerGroup(shownRoot, "left");
  const trailingGroup = cornerGroup(shownRoot, "right");
  const chromeGroups = new Set(topRow(shownRoot));
  const groupCount = groupsOf(layout.root).length;

  const renderGroup = (group: GroupNode): ReactNode => {
    const maximized = layout.maximized === group.id;
    const chrome = chromeGroups.has(group.id) ? chromeAttributes : undefined;
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-lg border bg-background" data-group={group.id}>
        <div
          {...chrome}
          className="relative flex h-9 shrink-0 items-end bg-muted/50 px-1 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border"
        >
          {group.id === leadingGroup && leading !== undefined && (
            <div className="relative z-10 flex h-full shrink-0 items-center gap-0.5 pr-1">{leading}</div>
          )}
          <div
            {...chrome}
            ref={stripRef(group.id)}
            data-strip={group.id}
            className="relative z-10 flex h-full min-w-0 flex-1 items-end"
            onDoubleClick={(event) => {
              if ((event.target as Element).closest("button, [data-tab-view]") || groupsOf(layoutRef.current.root).length < 2) return;
              change(toggleMaximize(layoutRef.current, group.id));
            }}
          >
            <div
              {...chrome}
              role="tablist"
              aria-orientation="horizontal"
              className="flex h-full min-w-0 items-end gap-0.5 overflow-x-auto pt-1 [scrollbar-width:none]"
            >
              {group.views.map((id) => {
                const view = layout.views[id];
                const info = describeView(id, view);
                const selected = group.active === id;
                const closable = info.closable !== false;
                return (
                  <div
                    key={id}
                    data-tab-view={id}
                    className={[
                      "group/tab relative flex h-full max-w-[14rem] shrink-0 items-center overflow-hidden rounded-t-md border border-b-0 text-sm transition-colors",
                      selected
                        ? "border-border bg-background text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                      drag?.id === id ? "opacity-50" : "",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      role="tab"
                      id={tabId(id)}
                      aria-selected={selected}
                      aria-controls={panelId(id)}
                      tabIndex={selected ? 0 : -1}
                      className="flex h-full min-w-0 items-center gap-1.5 pl-3 pr-1 focus-visible:bg-accent"
                      onPointerDown={(event) => startDrag(event, id, info.title)}
                      onClick={() => {
                        if (suppressClick.current) {
                          suppressClick.current = false;
                          return;
                        }
                        select(id);
                      }}
                      onAuxClick={(event) => {
                        if (event.button === 1 && closable) close(id);
                      }}
                      onKeyDown={(event) => tabKeyDown(event, group, id, closable)}
                    >
                      {info.icon}
                      <span className="truncate">{info.title}</span>
                    </button>
                    {closable ? (
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={labels.closeTab(info.title)}
                        className={[
                          "mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent",
                          selected ? "" : "opacity-0 group-hover/tab:opacity-100",
                        ].join(" ")}
                        onClick={() => close(id)}
                      >
                        <CloseIcon />
                      </button>
                    ) : (
                      <span className="w-2" />
                    )}
                  </div>
                );
              })}
            </div>
            {onNewTab && (
              <div {...chrome} className="flex h-full shrink-0 items-center pl-0.5 pt-1">
                <button type="button" aria-label={labels.newTab} className={BAR_BUTTON} onClick={() => onNewTab(group.id)}>
                  <PlusIcon />
                </button>
              </div>
            )}
          </div>
          <div className="flex h-full shrink-0 items-center gap-0.5 pl-1">
            {groupActions?.(group)}
            {groupCount > 1 && (
              <button
                type="button"
                aria-label={maximized ? labels.restore : labels.maximize}
                aria-pressed={maximized}
                title={maximized ? labels.restore : labels.maximize}
                className={BAR_BUTTON}
                onClick={() => change(toggleMaximize(layoutRef.current, group.id))}
              >
                <MaximizeIcon restore={maximized} />
              </button>
            )}
            {groupCount > 1 && group.views.length === 0 && (
              <button
                type="button"
                aria-label={labels.closePanel}
                className={BAR_BUTTON}
                onClick={() => change(closeGroup(layoutRef.current, group.id, stageCandidate))}
              >
                <CloseIcon className="size-3.5" />
              </button>
            )}
            {group.id === trailingGroup && trailing}
          </div>
        </div>
        <div ref={slotRef(group.id)} className="relative min-h-0 flex-1" data-slot={group.id}>
          {group.views.length === 0 && (typeof empty === "function" ? empty(group) : empty)}
        </div>
      </div>
    );
  };

  const renderSplit = (node: SplitNode): ReactNode => {
    const row = node.direction === "row";
    return (
      <div className={`flex h-full w-full min-h-0 min-w-0 gap-1 ${row ? "flex-row" : "flex-col"}`} data-split={node.id}>
        {node.children.map((child, index) => (
          <SplitChild
            key={child.id}
            node={node}
            index={index}
            row={row}
            label={labels.resize}
            layoutRef={layoutRef}
            onChange={change}
            onResizing={setResizing}
          >
            {renderNode(child)}
          </SplitChild>
        ))}
      </div>
    );
  };

  const renderNode = (node: LayoutNode): ReactNode => (node.kind === "group" ? renderGroup(node) : renderSplit(node));

  const visibleGroups = new Set(groupsOf(shownRoot).map((group) => group.id));
  const interactive = drag === null && !resizing;

  const cyclePanels = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "F6") return;
    const groups = groupsOf(shownRoot);
    if (groups.length === 0) return;
    const active = document.activeElement;
    const view = active instanceof Element ? active.closest("[data-view]")?.getAttribute("data-view") : null;
    const tab = active instanceof Element ? active.closest("[data-tab-view]")?.getAttribute("data-tab-view") : null;
    const current = groups.findIndex((group) => group.views.some((id) => id === view || id === tab));
    const step = event.shiftKey ? -1 : 1;
    const next = groups[(current + step + groups.length) % groups.length];
    const target = next.active ?? next.views[0];
    if (!target) return;
    event.preventDefault();
    document.getElementById(tabId(target))?.focus();
  };
  const owners = new Map<string, GroupNode>();
  for (const group of groupsOf(layout.root)) for (const id of group.views) owners.set(id, group);

  return (
    <div
      {...chromeAttributes}
      ref={rootRef}
      onKeyDown={cyclePanels}
      className={`relative h-full w-full min-h-0 min-w-0 overflow-hidden bg-muted/30 p-1 ${className ?? ""}`}
    >
      {renderNode(shownRoot)}
      {Object.entries(layout.views).map(([id, view]) => {
        const owner = owners.get(id);
        const visible = owner !== undefined && owner.active === id && visibleGroups.has(owner.id);
        return (
          <ViewHost
            key={id}
            id={id}
            view={view}
            rect={owner ? (rects[owner.id] ?? known.current[owner.id]) : undefined}
            visible={visible}
            interactive={interactive}
            panelId={panelId(id)}
            tabId={tabId(id)}
            render={renderView}
            onFocus={onFocusView}
          />
        );
      })}
      {drag?.indicator && (
        <div
          aria-hidden
          data-drop-indicator={drag.target?.zone}
          className="pointer-events-none absolute z-20 rounded-md border border-primary/60 bg-primary/10 transition-[left,top,width,height] duration-100"
          style={drag.indicator}
        />
      )}
      {drag && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-30 max-w-[14rem] truncate rounded-md border bg-background px-2 py-1 text-sm shadow-md"
          style={{ left: drag.x + 12, top: drag.y + 8 }}
        >
          {drag.title}
        </div>
      )}
    </div>
  );
}

interface SplitChildProps {
  node: SplitNode;
  index: number;
  row: boolean;
  label: string;
  layoutRef: { current: WorkspaceLayout };
  onChange: (layout: WorkspaceLayout) => void;
  onResizing: (active: boolean) => void;
  children: ReactNode;
}

function containerSize(element: HTMLElement, row: boolean): number {
  const container = element.parentElement?.parentElement;
  if (!container) return 0;
  const box = container.getBoundingClientRect();
  return row ? box.width : box.height;
}

function SplitChild({ node, index, row, label, layoutRef, onChange, onResizing, children }: Readonly<SplitChildProps>) {
  const stopResize = useRef<(() => void) | null>(null);
  useEffect(() => () => stopResize.current?.(), []);
  const weight = node.weights[index] ?? 0;
  const last = index === node.children.length - 1;
  const pairShare = (weights: readonly number[]) => weights[index] / (weights[index] + weights[index + 1]);

  const shift = (delta: number, size: number) => {
    const current = findNode(layoutRef.current.root, node.id);
    if (!current || current.kind !== "split") return;
    const weights = [...current.weights];
    const total = weights[index] + weights[index + 1];
    const minimum = Math.max(MIN_WEIGHT, size > 0 ? (row ? MIN_ROW_PX : MIN_COLUMN_PX) / size : 0);
    if (total <= minimum * 2) return;
    const first = Math.min(total - minimum, Math.max(minimum, weights[index] + delta));
    weights[index] = first;
    weights[index + 1] = total - first;
    onChange(resizeSplit(layoutRef.current, node.id, weights));
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const size = containerSize(event.currentTarget, row);
    if (size <= 0) return;
    onResizing(true);
    let last = row ? event.clientX : event.clientY;
    let frame = 0;
    let pending = 0;
    const move = (moveEvent: PointerEvent) => {
      const position = row ? moveEvent.clientX : moveEvent.clientY;
      pending += (position - last) / size;
      last = position;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const delta = pending;
        pending = 0;
        shift(delta, size);
      });
    };
    const up = () => {
      stopResize.current = null;
      cancelAnimationFrame(frame);
      if (pending !== 0) shift(pending, size);
      onResizing(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", up);
    stopResize.current = up;
  };

  return (
    <div className="relative flex min-h-0 min-w-0" style={{ flex: `${weight} 1 0px` }}>
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
      {!last && (
        <div
          role="separator"
          aria-label={label}
          aria-orientation={row ? "vertical" : "horizontal"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pairShare(node.weights) * 100)}
          tabIndex={0}
          data-splitter={node.id}
          onPointerDown={startResize}
          onDoubleClick={() => onChange(evenPair(layoutRef.current, node.id, index))}
          onKeyDown={(event) => {
            const back = row ? "ArrowLeft" : "ArrowUp";
            const forward = row ? "ArrowRight" : "ArrowDown";
            if (event.key !== back && event.key !== forward) return;
            event.preventDefault();
            const step = event.shiftKey ? BIG_KEY_STEP : KEY_STEP;
            shift(event.key === forward ? step : -step, containerSize(event.currentTarget, row));
          }}
          className={[
            "absolute z-20 rounded-full transition-colors hover:bg-primary/40 focus-visible:bg-primary/50",
            row ? "-right-1 top-2 bottom-2 w-1 cursor-col-resize" : "-bottom-1 left-2 right-2 h-1 cursor-row-resize",
          ].join(" ")}
        />
      )}
    </div>
  );
}
