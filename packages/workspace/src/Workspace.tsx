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
import { flushSync } from "react-dom";
import { trackPointerDrag } from "./drag";
import {
  BAR_PX,
  childrenWith,
  contains,
  GAP_BAND_PX,
  MIN_COLUMN_PX,
  MIN_ROW_PX,
  relativeRect,
  sameRects,
  shiftPair,
  slotAlong,
  zoneAt,
  zoneRect,
  type Rect,
} from "./geometry";
import { Maximize, Minimize, Plus, X } from "lucide-react";
import { keptViews, promoteShown } from "./retention";
import {
  activate,
  closeGroup,
  closeView,
  containerOf,
  evenPair,
  findNode,
  groupsOf,
  moveView,
  resizeSections,
  resizeSplit,
  sameLayout,
  stackOf,
  toggleMaximize,
  toggleSection,
  visibleViews,
  type GroupNode,
  type LayoutNode,
  type MoveTarget,
  type SplitNode,
  type StackState,
  type ViewState,
  type WorkspaceLayout,
} from "./layout";
import { Splitter } from "./Splitter";
import { StackBody } from "./Stack";
import { IconTab, Tab } from "./Tabs";
import type { RenderTooltip, ViewInfo, WorkspaceLabels } from "./types";

export { zoneAt, zoneRect } from "./geometry";
export type { Badge, RenderTooltip, TooltipOptions, TooltipSide, ViewInfo, WorkspaceLabels } from "./types";

export interface WorkspaceProps {
  layout: WorkspaceLayout;
  onLayoutChange: (layout: WorkspaceLayout) => void;
  renderView: (id: string, view: ViewState) => ReactNode;
  describeView: (id: string, view: ViewState) => ViewInfo;
  describeStack?: (id: string, stack: StackState) => ViewInfo | null | undefined;
  labels: WorkspaceLabels;
  renderTooltip?: RenderTooltip;
  onVisibleViewsChange?: (ids: string[]) => void;
  groupActions?: (group: GroupNode) => ReactNode;
  empty?: ReactNode | ((group: GroupNode) => ReactNode);
  onFocusView?: (id: string) => void;
  onNewTab?: (groupId: string) => void;
  stageCandidate?: (group: GroupNode) => boolean;
  canDrop?: (id: string, target: MoveTarget) => boolean;
  keepHidden?: number;
  canRelease?: (id: string) => boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  chromeAttributes?: Readonly<Record<string, string>>;
  className?: string;
}

interface Found {
  target: MoveTarget;
  indicator: Rect;
  bar: boolean;
}

interface DragState {
  id: string;
  title: string;
  x: number;
  y: number;
  found: Found | null;
}

interface Placement {
  slot: string;
  fallback: string;
  shown: boolean;
  role: "tabpanel" | "region";
  labelledBy: string;
}

const BAR_WIDTH_PX = 2;

type ElementRef = (element: HTMLElement | null) => void;

interface ElementRegistry {
  elements: Map<string, HTMLElement>;
  ref: (key: string) => ElementRef;
}

function elementRegistry(watch?: (previous: HTMLElement | undefined, next: HTMLElement | null) => void): ElementRegistry {
  const elements = new Map<string, HTMLElement>();
  const refs = new Map<string, ElementRef>();
  return {
    elements,
    ref(key) {
      let callback = refs.get(key);
      if (!callback) {
        callback = (element) => {
          const previous = elements.get(key);
          if (previous === (element ?? undefined)) return;
          watch?.(previous, element);
          if (element) elements.set(key, element);
          else elements.delete(key);
        };
        refs.set(key, callback);
      }
      return callback;
    },
  };
}

function cyclesPanels(event: KeyboardEvent): boolean {
  if (event.key === "F6") return true;
  return event.key === "Tab" && event.ctrlKey && !event.metaKey && !event.altKey;
}

const groupKey = (id: string) => `g:${id}`;
const sectionKey = (id: string) => `s:${id}`;

function nodeShown(node: LayoutNode): boolean {
  return node.kind === "group" ? node.hidden !== true : node.children.some(nodeShown);
}

function cornerGroup(node: LayoutNode, side: "left" | "right"): string | null {
  if (node.kind === "group") return node.hidden === true ? null : node.id;
  const shown = node.children.filter(nodeShown);
  const pick = node.direction === "row" && side === "right" ? shown.at(-1) : shown[0];
  return pick ? cornerGroup(pick, side) : null;
}

function topRow(node: LayoutNode): string[] {
  if (node.kind === "group") return node.hidden === true ? [] : [node.id];
  const shown = node.children.filter(nodeShown);
  if (node.direction === "row") return shown.flatMap(topRow);
  return shown[0] ? topRow(shown[0]) : [];
}

function nodeMinimum(layout: WorkspaceLayout, node: LayoutNode, row: boolean, infos: ReadonlyMap<string, ViewInfo>): number {
  if (node.kind === "split") {
    const parts = node.children.filter(nodeShown).map((child) => nodeMinimum(layout, child, row, infos));
    return (node.direction === "row") === row ? parts.reduce((sum, part) => sum + part, 0) : Math.max(0, ...parts);
  }
  let width = MIN_ROW_PX;
  let height = MIN_COLUMN_PX;
  for (const entry of node.views) {
    const holder = stackOf(layout, entry);
    const sections = holder ? holder.sections : [entry];
    let stacked = BAR_PX;
    for (const section of sections) {
      const info = infos.get(section);
      width = Math.max(width, info?.minWidth ?? 0);
      if (!holder || sections.length === 1 || !holder.collapsed.includes(section)) stacked += info?.minHeight ?? 0;
    }
    height = Math.max(height, stacked);
  }
  return row ? width : height;
}

function containerSize(element: HTMLElement, row: boolean): number {
  const container = element.parentElement?.parentElement;
  if (!container) return 0;
  const box = container.getBoundingClientRect();
  return row ? box.width : box.height;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

function dropKind(target: MoveTarget): string {
  return "stackId" in target ? "stack" : target.zone;
}

function layoutStructure(layout: WorkspaceLayout): string {
  const walk = (node: LayoutNode): unknown => {
    if (node.kind === "split") return [node.id, node.direction, node.children.map(walk)];
    const holder = node.active === null ? null : stackOf(layout, node.active);
    const sections = holder && holder.sections.length > 1 ? holder.sections.map((id) => [id, holder.collapsed.includes(id)]) : null;
    return [node.id, node.hidden === true, sections];
  };
  return JSON.stringify([layout.maximized, walk(layout.root)]);
}

function hiddenViewClass(): string {
  const supported = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("content-visibility", "hidden");
  return supported ? "flex invisible [content-visibility:hidden]" : "hidden";
}

interface SectionProbe {
  box: Rect;
  headers: Rect[];
}

interface StackProbe {
  stackId: string;
  count: number;
  box: Rect;
  sections: SectionProbe[] | null;
}

interface StripProbe {
  groupId: string;
  box: Rect;
  tabs: Rect[];
}

interface DropProbes {
  origin: DOMRect;
  stacks: StackProbe[];
  strips: StripProbe[];
  groups: { groupId: string; box: Rect }[];
}

function stackDrop(probe: StackProbe, px: number, py: number): Found | null {
  const { box, stackId, count } = probe;
  if (!contains(box, px, py)) return null;
  if (probe.sections === null) {
    const before = py - box.top <= GAP_BAND_PX;
    if (!before && box.top + box.height - py > GAP_BAND_PX) return null;
    const edge = before ? box.top : box.top + box.height;
    return {
      target: { stackId, index: before ? 0 : count },
      indicator: { left: box.left, top: clamp(edge - BAR_WIDTH_PX / 2, box.top, box.top + box.height - BAR_WIDTH_PX), width: box.width, height: BAR_WIDTH_PX },
      bar: true,
    };
  }
  const sections = probe.sections;
  const edges = [...sections.map((section) => section.box.top), Math.max(...sections.map((section) => section.box.top + section.box.height))];
  let gap: number | null = null;
  sections.forEach((section, index) => {
    for (const head of section.headers) {
      if (gap === null && contains(head, px, py)) gap = py < head.top + head.height / 2 ? index : index + 1;
    }
  });
  if (gap === null) {
    let best = GAP_BAND_PX;
    edges.forEach((edge, index) => {
      const distance = Math.abs(py - edge);
      if (distance <= best) {
        best = distance;
        gap = index;
      }
    });
  }
  if (gap === null) return null;
  return {
    target: { stackId, index: gap },
    indicator: { left: box.left, top: clamp(edges[gap] - BAR_WIDTH_PX / 2, box.top, box.top + box.height - BAR_WIDTH_PX), width: box.width, height: BAR_WIDTH_PX },
    bar: true,
  };
}

function tabInsertEdge(tabs: readonly Rect[], index: number, box: Rect): number {
  if (index < tabs.length) return tabs[index].left;
  const lastTab = tabs.at(-1);
  return lastTab ? lastTab.left + lastTab.width : box.left;
}

function findDrop(probes: DropProbes, x: number, y: number): Found | null {
  const px = x - probes.origin.left;
  const py = y - probes.origin.top;
  for (const probe of probes.stacks) {
    const found = stackDrop(probe, px, py);
    if (found) return found;
  }
  for (const { groupId, box, tabs } of probes.strips) {
    if (!contains(box, px, py)) continue;
    const index = slotAlong(tabs, px, "x");
    const at = tabInsertEdge(tabs, index, box);
    return {
      target: { groupId, zone: "center", index },
      indicator: { left: clamp(at - BAR_WIDTH_PX / 2, box.left, box.left + box.width - BAR_WIDTH_PX), top: box.top, width: BAR_WIDTH_PX, height: box.height },
      bar: true,
    };
  }
  for (const { groupId, box } of probes.groups) {
    if (!contains(box, px, py)) continue;
    const zone = zoneAt(box, px, py);
    return { target: { groupId, zone }, indicator: zoneRect(box, zone), bar: false };
  }
  return null;
}

interface PlacementIds {
  tabId: (id: string) => string;
  headerId: (id: string) => string;
}

function entryPlacements(holder: StackState | null, entry: string, slot: string, selected: boolean, ids: PlacementIds): [string, Placement][] {
  const tabPanel = (id: string): [string, Placement] => [id, { slot, fallback: slot, shown: selected, role: "tabpanel", labelledBy: ids.tabId(entry) }];
  if (!holder) return [tabPanel(entry)];
  if (holder.sections.length === 1) return holder.sections.map(tabPanel);
  return holder.sections.map((section) => [
    section,
    {
      slot: sectionKey(section),
      fallback: slot,
      shown: selected && !holder.collapsed.includes(section),
      role: "region",
      labelledBy: ids.headerId(section),
    },
  ]);
}

function viewPlacements(layout: WorkspaceLayout, visibleGroups: ReadonlySet<string>, ids: PlacementIds): Map<string, Placement> {
  const placements = new Map<string, Placement>();
  for (const owner of groupsOf(layout.root)) {
    const slot = groupKey(owner.id);
    const groupShown = visibleGroups.has(owner.id);
    for (const entry of owner.views) {
      const selected = groupShown && owner.active === entry;
      for (const [id, place] of entryPlacements(stackOf(layout, entry), entry, slot, selected, ids)) placements.set(id, place);
    }
  }
  return placements;
}

const BAR_BUTTON =
  "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent";

interface ViewHostProps {
  id: string;
  view: ViewState;
  rect: Rect | undefined;
  visible: boolean;
  mounted: boolean;
  interactive: boolean;
  panelId: string;
  role: "tabpanel" | "region";
  labelledBy: string;
  render: (id: string, view: ViewState) => ReactNode;
  onFocus?: (id: string) => void;
}

const ViewHost = memo(function ViewHost({
  id,
  view,
  rect,
  visible,
  mounted,
  interactive,
  panelId,
  role,
  labelledBy,
  render,
  onFocus,
}: Readonly<ViewHostProps>) {
  const placed = rect !== undefined;
  const shown = visible && placed;
  const content = useMemo(() => (mounted ? render(id, view) : null), [mounted, render, id, view]);
  return (
    <div
      role={role}
      id={panelId}
      aria-labelledby={labelledBy}
      aria-hidden={shown ? undefined : true}
      data-view={id}
      data-shown={shown}
      hidden={!placed}
      inert={!shown}
      onPointerDownCapture={onFocus ? () => onFocus(id) : undefined}
      onFocusCapture={onFocus ? () => onFocus(id) : undefined}
      className={[
        "absolute z-10 min-h-0 min-w-0 flex-col overflow-hidden rounded-b-md bg-background",
        shown ? "flex" : hiddenViewClass(),
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
  describeStack,
  labels,
  renderTooltip,
  onVisibleViewsChange,
  groupActions,
  empty,
  onFocusView,
  onNewTab,
  stageCandidate,
  canDrop,
  keepHidden = Number.POSITIVE_INFINITY,
  canRelease,
  leading,
  trailing,
  chromeAttributes,
  className,
}: Readonly<WorkspaceProps>) {
  const prefix = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [slots] = useState(() =>
    elementRegistry((previous, next) => {
      if (previous) observerRef.current?.unobserve(previous);
      if (next) observerRef.current?.observe(next);
    }),
  );
  const [strips] = useState(() => elementRegistry());
  const [stackElements] = useState(() => elementRegistry());
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  const [resizing, setResizing] = useState(false);
  const resizeStart = useRef<WorkspaceLayout | null>(null);
  const known = useRef<Record<string, Rect>>({});
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const changeRef = useRef(onLayoutChange);
  changeRef.current = onLayoutChange;
  const visibleRef = useRef(onVisibleViewsChange);
  visibleRef.current = onVisibleViewsChange;
  const reported = useRef<string[] | null>(null);
  const stopGesture = useRef<(() => void) | null>(null);
  const cyclePanelsRef = useRef<((event: KeyboardEvent) => void) | null>(null);
  const [recent, setRecent] = useState<readonly string[]>([]);

  useEffect(() => () => stopGesture.current?.(), []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const page = root.ownerDocument;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Node && root.contains(event.target)) cyclePanelsRef.current?.(event);
    };
    page.addEventListener("keydown", onKeyDown);
    return () => page.removeEventListener("keydown", onKeyDown);
  }, []);

  const tabId = useCallback((id: string) => `${prefix}-tab-${id}`, [prefix]);
  const panelId = useCallback((id: string) => `${prefix}-panel-${id}`, [prefix]);
  const headerId = useCallback((id: string) => `${prefix}-section-${id}`, [prefix]);

  const infos = useMemo(
    () => new Map(Object.entries(layout.views).map(([id, view]) => [id, describeView(id, view)] as const)),
    [layout.views, describeView],
  );
  const infosRef = useRef(infos);
  infosRef.current = infos;

  const stackInfos = useMemo(() => {
    const described = new Map<string, ViewInfo>();
    for (const [id, holder] of Object.entries(layout.stacks ?? {})) {
      const own = describeStack?.(id, holder);
      const first = infos.get(holder.sections[0]);
      if (own) described.set(id, { ...own, closable: own.closable === true });
      else if (holder.sections.length === 1 && first) described.set(id, { ...first, closable: first.closable !== false });
      else described.set(id, { title: holder.title ?? first?.title ?? id, icon: first?.icon, closable: false });
    }
    return described;
  }, [layout.stacks, describeStack, infos]);

  const entryInfo = (id: string): ViewInfo => stackInfos.get(id) ?? infos.get(id) ?? { title: id };

  useEffect(() => {
    const ids = visibleViews(layout);
    const last = reported.current;
    if (last?.length === ids.length && last.every((id, index) => id === ids[index])) return;
    reported.current = ids;
    visibleRef.current?.(ids);
  }, [layout]);

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    const next: Record<string, Rect> = {};
    for (const [key, element] of slots.elements) {
      if (element.isConnected) next[key] = relativeRect(element, origin);
    }
    const { root: tree, views: placed } = layoutRef.current;
    const live = new Set([...groupsOf(tree).map((owner) => groupKey(owner.id)), ...Object.keys(placed).map(sectionKey)]);
    known.current = Object.fromEntries(Object.entries({ ...known.current, ...next }).filter(([key]) => live.has(key)));
    setRects((current) => (sameRects(current, next) ? current : next));
  }, [slots]);

  const structure = useMemo(() => layoutStructure(layout), [layout]);
  const measuredFor = useRef<unknown>(null);
  useLayoutEffect(() => {
    const trigger = typeof ResizeObserver === "undefined" ? layout : structure;
    if (measuredFor.current === trigger) return;
    measuredFor.current = trigger;
    measure();
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => flushSync(measure));
    observer.observe(root);
    for (const element of slots.elements.values()) observer.observe(element);
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [measure, slots]);

  const change = useCallback((next: WorkspaceLayout) => {
    if (!sameLayout(next, layoutRef.current)) changeRef.current(next);
  }, []);

  const select = useCallback(
    (id: string) => {
      const current = layoutRef.current;
      change(activate(current, id));
      const holder = stackOf(current, id);
      const focus = holder ? (holder.sections.find((section) => holder.sections.length === 1 || !holder.collapsed.includes(section)) ?? holder.sections[0]) : id;
      onFocusView?.(focus);
    },
    [change, onFocusView],
  );

  const resizingChange = useCallback(
    (active: boolean, cancelled = false) => {
      setResizing(active);
      const start = resizeStart.current;
      resizeStart.current = active ? layoutRef.current : null;
      if (cancelled && start?.views === layoutRef.current.views) change(start);
    },
    [change],
  );

  const holdsFocus = useCallback(
    (id: string): boolean => {
      const active = document.activeElement;
      if (!active || active === document.body) return true;
      if (active.closest<HTMLElement>("[data-tab-view]")?.dataset.tabView === id) return true;
      const sections = stackOf(layoutRef.current, id)?.sections ?? [id];
      return sections.some((view) => document.getElementById(panelId(view))?.contains(active));
    },
    [panelId],
  );

  const closeTab = useCallback(
    (group: GroupNode, id: string, refocus: boolean) => {
      const index = group.views.indexOf(id);
      const next = group.active === id ? (group.views[index + 1] ?? group.views[index - 1]) : group.active;
      change(closeView(layoutRef.current, id));
      if (!refocus || !next) return;
      requestAnimationFrame(() => {
        if (group.active === id) select(next);
        document.getElementById(tabId(next))?.focus();
      });
    },
    [change, select, tabId],
  );

  const captureProbes = useCallback((): DropProbes | null => {
    const root = rootRef.current;
    if (!root) return null;
    const origin = root.getBoundingClientRect();
    const current = layoutRef.current;
    const stacks: StackProbe[] = [];
    for (const owner of groupsOf(current.root)) {
      if (owner.hidden === true || owner.active === null) continue;
      const stackId = owner.active;
      const holder = stackOf(current, stackId);
      if (!holder) continue;
      const element = stackElements.elements.get(stackId);
      if (holder.sections.length === 1 || !element) {
        const slot = slots.elements.get(groupKey(owner.id));
        if (slot?.isConnected) stacks.push({ stackId, count: holder.sections.length, box: relativeRect(slot, origin), sections: null });
        continue;
      }
      stacks.push({
        stackId,
        count: holder.sections.length,
        box: relativeRect(element, origin),
        sections: childrenWith(element, "data-section").map((section) => ({
          box: relativeRect(section, origin),
          headers: childrenWith(section, "data-section-header").map((head) => relativeRect(head, origin)),
        })),
      });
    }
    const stripProbes = [...strips.elements].map(([groupId, strip]) => ({
      groupId,
      box: relativeRect(strip, origin),
      tabs: [...strip.querySelectorAll<HTMLElement>("[data-tab-view]")].map((tab) => relativeRect(tab, origin)),
    }));
    const groups: DropProbes["groups"] = [];
    for (const [key, element] of slots.elements) {
      if (key.startsWith("g:") && element.isConnected) groups.push({ groupId: key.slice(2), box: relativeRect(element, origin) });
    }
    return { origin, stacks, strips: stripProbes, groups };
  }, [slots, stackElements, strips]);

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string, title: string) => {
      if (event.button !== 0) return;
      stopGesture.current?.();
      let probes: DropProbes | null = null;
      let landing: Found | null = null;
      stopGesture.current = trackPointerDrag(event, {
        perFrame: true,
        start() {
          probes = captureProbes();
        },
        move(point) {
          const found = probes ? findDrop(probes, point.clientX, point.clientY) : null;
          const current = layoutRef.current;
          landing = found && (!canDrop || canDrop(id, found.target)) && moveView(current, id, found.target) !== current ? found : null;
          setDrag({ id, title, x: point.clientX, y: point.clientY, found: landing });
        },
        end(dropped) {
          stopGesture.current = null;
          setDrag(null);
          if (dropped && landing) change(moveView(layoutRef.current, id, landing.target));
        },
      });
    },
    [canDrop, captureProbes, change],
  );

  const tabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, group: GroupNode, id: string, closable: boolean) => {
      const index = group.views.indexOf(id);
      let next: string | undefined;
      if (event.key === "ArrowRight") next = group.views[(index + 1) % group.views.length];
      else if (event.key === "ArrowLeft") next = group.views[(index - 1 + group.views.length) % group.views.length];
      else if (event.key === "Home") next = group.views[0];
      else if (event.key === "End") next = group.views.at(-1);
      else if ((event.key === "Delete" || event.key === "Backspace") && closable) {
        event.preventDefault();
        closeTab(group, id, true);
        return;
      }
      if (next === undefined) return;
      event.preventDefault();
      select(next);
      document.getElementById(tabId(next))?.focus();
    },
    [closeTab, select, tabId],
  );

  const headerHeight = useCallback(
    (stackId: string, viewId: string): number => {
      const element = stackElements.elements.get(stackId);
      const section = element ? childrenWith(element, "data-section").find((candidate) => candidate.dataset.section === viewId) : undefined;
      const header = section ? childrenWith(section, "data-section-header")[0] : undefined;
      return header ? header.getBoundingClientRect().height : 0;
    },
    [stackElements],
  );

  const shiftSections = useCallback(
    (stackId: string, firstId: string, secondId: string, delta: number, size: number) => {
      const holder = stackOf(layoutRef.current, stackId);
      if (!holder) return;
      const first = holder.sections.indexOf(firstId);
      const second = holder.sections.indexOf(secondId);
      if (first < 0 || second < 0) return;
      const total = holder.sections.reduce((sum, id, index) => (holder.collapsed.includes(id) ? sum : sum + holder.weights[index]), 0);
      const floor = (id: string) => Math.max(MIN_COLUMN_PX, headerHeight(stackId, id) + (infosRef.current.get(id)?.minHeight ?? 0));
      const next = shiftPair({ weights: holder.weights, first, second, delta, size, total, minFirst: floor(firstId), minSecond: floor(secondId) });
      if (next) change(resizeSections(layoutRef.current, stackId, next));
    },
    [change, headerHeight],
  );

  const evenSections = useCallback(
    (stackId: string, firstId: string, secondId: string) => {
      const holder = stackOf(layoutRef.current, stackId);
      if (!holder) return;
      const first = holder.sections.indexOf(firstId);
      const second = holder.sections.indexOf(secondId);
      if (first < 0 || second < 0 || holder.weights[first] === holder.weights[second]) return;
      const weights = [...holder.weights];
      const share = (weights[first] + weights[second]) / 2;
      weights[first] = share;
      weights[second] = share;
      change(resizeSections(layoutRef.current, stackId, weights));
    },
    [change],
  );

  const moveSection = useCallback(
    (stackId: string, viewId: string, step: -1 | 1) => {
      const current = layoutRef.current;
      const holder = stackOf(current, stackId);
      const index = holder?.sections.indexOf(viewId) ?? -1;
      const to = step < 0 ? index - 1 : index + 2;
      if (!holder || index < 0 || to < 0 || to > holder.sections.length) return;
      change(moveView(current, viewId, { stackId, index: to }));
      requestAnimationFrame(() => document.getElementById(headerId(viewId))?.focus());
    },
    [change, headerId],
  );

  const shiftSplit = useCallback(
    (splitId: string, index: number, other: number, delta: number, size: number) => {
      const current = findNode(layoutRef.current.root, splitId);
      if (current?.kind !== "split" || other >= current.children.length) return;
      const row = current.direction === "row";
      const total = current.children.reduce((sum, child, at) => (nodeShown(child) ? sum + current.weights[at] : sum), 0);
      const minFirst = nodeMinimum(layoutRef.current, current.children[index], row, infosRef.current);
      const minSecond = nodeMinimum(layoutRef.current, current.children[other], row, infosRef.current);
      const next = shiftPair({ weights: current.weights, first: index, second: other, delta, size, total, minFirst, minSecond });
      if (next) change(resizeSplit(layoutRef.current, splitId, next));
    },
    [change],
  );

  const { shownRoot, leadingGroup, trailingGroup, chromeGroups, groupCount, shownGroups, visibleGroups } = useMemo(() => {
    const top = (layout.maximized ? findNode(layout.root, layout.maximized) : null) ?? layout.root;
    const showing = groupsOf(top).filter((candidate) => candidate.hidden !== true);
    return {
      shownRoot: top,
      leadingGroup: cornerGroup(top, "left"),
      trailingGroup: cornerGroup(top, "right"),
      chromeGroups: new Set(topRow(top)),
      groupCount: groupsOf(layout.root).filter((candidate) => candidate.hidden !== true).length,
      shownGroups: showing,
      visibleGroups: new Set(showing.map((candidate) => candidate.id)),
    };
  }, [layout.root, layout.maximized]);

  const renderTab = (group: GroupNode, id: string, icons: boolean): ReactNode => {
    const info = entryInfo(id);
    const holder = stackOf(layout, id);
    const closable = holder ? info.closable === true : info.closable !== false;
    const props = {
      id,
      info,
      selected: group.active === id,
      closable,
      dragging: drag?.id === id,
      tabId: tabId(id),
      controls: holder?.sections.length === 1 ? panelId(holder.sections[0]) : panelId(id),
      describedBy: `${prefix}-badge-${id}`,
      closeLabel: labels.closeTab(info.title),
      renderTooltip,
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => startDrag(event, id, info.title),
      onClick: () => select(id),
      onClose: () => closeTab(group, id, holdsFocus(id)),
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => tabKeyDown(event, group, id, closable),
    };
    return icons ? <IconTab key={id} {...props} /> : <Tab key={id} {...props} />;
  };

  const hint = (label: string, button: ReactNode): ReactNode => (renderTooltip ? renderTooltip(label, button, { side: "bottom" }) : button);

  const maximizeButton = (group: GroupNode): ReactNode => {
    const maximized = layout.maximized === group.id;
    const label = maximized ? labels.restore : labels.maximize;
    return hint(
      label,
      <button
        type="button"
        aria-label={label}
        aria-pressed={maximized}
        className={BAR_BUTTON}
        onClick={() => change(toggleMaximize(layoutRef.current, group.id))}
      >
        {maximized ? <Minimize className="size-3.5" /> : <Maximize className="size-3.5" />}
      </button>,
    );
  };

  const renderGroup = (group: GroupNode): ReactNode => {
    const chrome = chromeGroups.has(group.id) ? chromeAttributes : undefined;
    const icons = group.presentation === "icons";
    const activeStack = group.active === null ? null : stackOf(layout, group.active);
    const activeInfo = group.active === null ? undefined : entryInfo(group.active);
    const barActions = activeInfo?.actions;
    return (
      <div
        className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-lg border bg-background"
        data-group={group.id}
        data-presentation={icons ? "icons" : undefined}
      >
        <div
          {...chrome}
          className="relative flex h-9 shrink-0 items-end bg-muted/50 px-1 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border"
        >
          {group.id === leadingGroup && leading !== undefined && (
            <div className="relative z-10 flex h-full shrink-0 items-center gap-0.5 pr-1">{leading}</div>
          )}
          <div
            {...chrome}
            ref={strips.ref(group.id)}
            data-strip={group.id}
            className={`relative z-10 flex h-full min-w-0 flex-1 ${icons ? "items-center" : "items-end"}`}
            onDoubleClick={(event) => {
              if (chrome !== undefined || (event.target as Element).closest("button, [data-tab-view]")) return;
              if (groupsOf(layoutRef.current.root).filter((candidate) => candidate.hidden !== true).length < 2) return;
              change(toggleMaximize(layoutRef.current, group.id));
            }}
          >
            <div
              {...chrome}
              role="tablist"
              aria-orientation="horizontal"
              className={
                icons
                  ? "flex h-full min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  : "flex h-full min-w-0 items-end gap-0.5 overflow-x-auto pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              }
            >
              {group.views.map((id) => renderTab(group, id, icons))}
            </div>
            {onNewTab && (
              <div {...chrome} className={`flex h-full shrink-0 items-center pl-0.5 ${icons ? "" : "pt-1"}`}>
                {hint(
                  labels.newTab,
                  <button type="button" aria-label={labels.newTab} className={BAR_BUTTON} onClick={() => onNewTab(group.id)}>
                    <Plus className="size-3.5" />
                  </button>,
                )}
              </div>
            )}
          </div>
          <div {...chrome} className="flex h-full min-w-0 items-center gap-0.5 pl-1">
            <div {...chrome} data-group-actions={group.id} className="flex h-full min-w-0 items-center gap-0.5 overflow-hidden">
              {barActions !== undefined && (
                <div data-view-actions={group.active ?? undefined} className="flex shrink-0 items-center gap-0.5">
                  {barActions}
                </div>
              )}
              {groupActions?.(group)}
              {groupCount > 1 && maximizeButton(group)}
              {groupCount > 1 &&
                group.views.length === 0 &&
                hint(
                  labels.closePanel,
                  <button
                    type="button"
                    aria-label={labels.closePanel}
                    className={BAR_BUTTON}
                    onClick={() => change(closeGroup(layoutRef.current, group.id, stageCandidate))}
                  >
                    <X className="size-3.5" />
                  </button>,
                )}
            </div>
            {group.id === trailingGroup && trailing !== undefined && trailing !== null && (
              <div {...chrome} data-trailing className="flex h-full shrink-0 items-center gap-0.5">
                {trailing}
              </div>
            )}
          </div>
        </div>
        <div ref={slots.ref(groupKey(group.id))} className="relative min-h-0 flex-1" data-slot={group.id}>
          {group.views.length === 0 && (typeof empty === "function" ? empty(group) : empty)}
          {activeStack && activeStack.sections.length > 1 && group.active !== null && (
            <StackBody
              stackId={group.active}
              stack={activeStack}
              infos={infos}
              labels={labels}
              renderTooltip={renderTooltip}
              draggingId={drag?.id ?? null}
              headerId={headerId}
              panelId={panelId}
              tabId={tabId}
              stackRef={stackElements.ref(group.active)}
              slotRef={(viewId) => slots.ref(sectionKey(viewId))}
              onToggle={(viewId) => change(toggleSection(layoutRef.current, group.active ?? "", viewId))}
              onMove={(viewId, step) => moveSection(group.active ?? "", viewId, step)}
              onStartDrag={startDrag}
              onResize={(first, second, delta, size) => shiftSections(group.active ?? "", first, second, delta, size)}
              onEven={(first, second) => evenSections(group.active ?? "", first, second)}
              onResizing={resizingChange}
            />
          )}
        </div>
      </div>
    );
  };

  const renderSplit = (node: SplitNode): ReactNode => {
    const row = node.direction === "row";
    const shown = node.children.flatMap((child, index) => (nodeShown(child) ? [index] : []));
    const total = shown.reduce((sum, index) => sum + (node.weights[index] ?? 0), 0);
    const grow = (index: number) => (total > 0 ? (node.weights[index] ?? 0) / total : 1 / shown.length);
    return (
      <div className={`flex h-full w-full min-h-0 min-w-0 gap-1 ${row ? "flex-row" : "flex-col"}`} data-split={node.id}>
        {shown.map((index, at) => {
          const child = node.children[index];
          const other = shown[at + 1];
          const weight = node.weights[index] ?? 0;
          return (
            <div key={child.id} className="relative flex min-h-0 min-w-0" style={{ flex: `${grow(index)} 1 0px` }}>
              <div className="min-h-0 min-w-0 flex-1">{renderNode(child)}</div>
              {other !== undefined && (
                <Splitter
                  vertical={row}
                  label={labels.resize}
                  value={Math.round((weight / (weight + (node.weights[other] ?? 0))) * 100)}
                  attributes={{ "data-splitter": node.id }}
                  size={(element) => containerSize(element, row)}
                  onShift={(delta, size) => shiftSplit(node.id, index, other, delta, size)}
                  onEven={() => change(evenPair(layoutRef.current, node.id, index, other))}
                  onResizing={resizingChange}
                  className={[
                    "absolute z-20 rounded-full transition-colors hover:bg-primary/40 focus-visible:bg-primary/50",
                    row ? "-right-1 top-2 bottom-2 w-1 cursor-col-resize" : "-bottom-1 left-2 right-2 h-1 cursor-row-resize",
                  ].join(" ")}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderNode = (node: LayoutNode): ReactNode => (node.kind === "group" ? renderGroup(node) : renderSplit(node));

  const interactive = drag === null && !resizing;

  const cyclePanels = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !cyclesPanels(event) || shownGroups.length === 0) return;
    const active = document.activeElement;
    const marker = active instanceof Element ? active.closest<HTMLElement>("[data-view], [data-tab-view], [data-section-header]") : null;
    const id = marker?.dataset.view ?? marker?.dataset.tabView ?? marker?.dataset.sectionHeader ?? null;
    const owner = id === null ? null : (containerOf(layout, id)?.groupId ?? null);
    const current = shownGroups.findIndex((candidate) => candidate.id === owner);
    const step = event.shiftKey ? -1 : 1;
    const next = shownGroups[(current + step + shownGroups.length) % shownGroups.length];
    const target = next.active ?? next.views[0];
    if (!target) return;
    event.preventDefault();
    document.getElementById(tabId(target))?.focus();
  };
  cyclePanelsRef.current = cyclePanels;

  const placements = viewPlacements(layout, visibleGroups, { tabId, headerId });

  const hosts = Object.entries(layout.views).map(([id, view]) => {
    const place = placements.get(id);
    const rect = place ? (rects[place.slot] ?? known.current[place.slot] ?? rects[place.fallback] ?? known.current[place.fallback]) : undefined;
    return { id, view, place, rect, shown: place?.shown === true && rect !== undefined };
  });
  const shownIds = hosts.flatMap((host) => (host.shown ? [host.id] : []));
  const promoted = promoteShown(recent, shownIds, layout.views);
  if (promoted !== recent) setRecent(promoted);
  const mounted = keptViews(promoted, new Set(shownIds), keepHidden, canRelease);

  return (
    <div
      {...chromeAttributes}
      ref={rootRef}
      className={`relative h-full w-full min-h-0 min-w-0 overflow-hidden bg-muted/30 p-1 ${className ?? ""}`}
    >
      {nodeShown(shownRoot) && renderNode(shownRoot)}
      {hosts.map(({ id, view, place, rect }) => (
        <ViewHost
          key={id}
          id={id}
          view={view}
          rect={rect}
          visible={place?.shown === true}
          mounted={mounted.has(id)}
          interactive={interactive}
          panelId={panelId(id)}
          role={place?.role ?? "tabpanel"}
          labelledBy={place?.labelledBy ?? tabId(id)}
          render={renderView}
          onFocus={onFocusView}
        />
      ))}
      {drag?.found && (
        <div
          aria-hidden
          data-drop-indicator={dropKind(drag.found.target)}
          className={
            drag.found.bar
              ? "pointer-events-none absolute z-20 rounded-full bg-primary"
              : "pointer-events-none absolute z-20 rounded-md border border-primary/60 bg-primary/10 transition-[left,top,width,height] duration-100 motion-reduce:transition-none"
          }
          style={drag.found.indicator}
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
