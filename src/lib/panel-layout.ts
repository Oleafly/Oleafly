import {
  useCallback,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import {
  useDefaultLayout,
  type GroupImperativeHandle,
  type Layout,
  type LayoutChangedMeta,
  type LayoutStorage,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import { useSettingsStore } from "@/store/settings";

const LAYOUT_PREFIX = "react-resizable-panels:";
const EXPAND_SIZES_PREFIX = "oleafly.panel-expand-sizes.";
const KEYBOARD_STEP = 10;
const KEYBOARD_JUMP = 100;
const SIZE_TOLERANCE = 0.01;
const LAYOUT_TOTAL_TOLERANCE = 0.1;
const FINE_HIT_MARGIN_PX = 5;
const COARSE_HIT_MARGIN_PX = 15;
const BASE_FONT_SIZE_PX = 16;

export const PANEL_STYLE: CSSProperties = { overflow: "hidden" };

export function percent(size: number): string {
  return `${size}%`;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStorage(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function readLayout(key: string): string | null {
  const serialized = readStorage(key);
  if (serialized === null) return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return Object.values(parsed).every(isFiniteSize) ? serialized : null;
  } catch {
    return null;
  }
}

const layoutStorage: LayoutStorage = {
  getItem: readLayout,
  setItem: (key, value) => {
    writeStorage(key, value);
  },
};

const unsavedStorage: LayoutStorage = {
  getItem: () => null,
  setItem: () => undefined,
};

export function panelLayoutKey(groupId: string, panelIds: readonly string[]): string {
  return `${LAYOUT_PREFIX}${[groupId, ...panelIds].join(":")}`;
}

export function panelExpandSizesKey(groupId: string): string {
  return `${EXPAND_SIZES_PREFIX}${groupId}`;
}

export function hasStoredPanelLayout(groupId: string): boolean {
  const legacyKey = `${LAYOUT_PREFIX}${groupId}`;
  const layoutKeyPrefix = `${legacyKey}:`;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === legacyKey || key?.startsWith(layoutKeyPrefix)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

type LegacyGroupEntry = {
  expandToSizes?: Record<string, unknown>;
  layout: unknown[];
};

function isLegacyGroupEntry(value: unknown): value is LegacyGroupEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { layout?: unknown }).layout)
  );
}

function isFiniteSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readExpandSizes(groupId: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(readStorage(panelExpandSizesKey(groupId)) ?? "{}");
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] =>
        isFiniteSize(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function writeExpandSizes(groupId: string, sizes: Record<string, number>): void {
  writeStorage(panelExpandSizesKey(groupId), JSON.stringify(sizes));
}

const migratedGroups = new Set<string>();

export function migrateLegacyPanelLayout(groupId: string, panelOrder: readonly string[]): void {
  if (migratedGroups.has(groupId)) return;
  migratedGroups.add(groupId);
  const legacyKey = `${LAYOUT_PREFIX}${groupId}`;
  const serialized = readStorage(legacyKey);
  if (serialized === null) return;
  let state: unknown;
  try {
    state = JSON.parse(serialized);
  } catch {
    return;
  }
  if (typeof state !== "object" || state === null) return;
  const entries = Object.entries(state);
  if (!entries.every(([, entry]) => isLegacyGroupEntry(entry))) return;

  const expandSizes: Record<string, number> = {};
  for (const [sortedPanelIds, entry] of entries as [string, LegacyGroupEntry][]) {
    const present = new Set(sortedPanelIds.split(","));
    const panelIds = panelOrder.filter((id) => present.has(id));
    const sizes = entry.layout;
    if (panelIds.length !== present.size || panelIds.length !== sizes.length) continue;
    if (!sizes.every(isFiniteSize)) continue;
    const key = panelLayoutKey(groupId, panelIds);
    if (readStorage(key) === null) {
      writeStorage(
        key,
        JSON.stringify(Object.fromEntries(panelIds.map((id, index) => [id, sizes[index]]))),
      );
    }
    for (const [panelId, size] of Object.entries(entry.expandToSizes ?? {})) {
      if (panelOrder.includes(panelId) && isFiniteSize(size)) expandSizes[panelId] = size;
    }
  }
  if (
    Object.keys(expandSizes).length > 0 &&
    readStorage(panelExpandSizesKey(groupId)) === null
  ) {
    writeExpandSizes(groupId, expandSizes);
  }
  removeStorage(legacyKey);
}

export function usePersistentPanelLayout(
  groupId: string | undefined,
  panelOrder: readonly string[],
  panelIds: string[],
): {
  defaultLayout: Layout | undefined;
  onLayoutChanged: (layout: Layout, meta: LayoutChangedMeta) => void;
} {
  if (groupId) migrateLegacyPanelLayout(groupId, panelOrder);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: groupId ?? "",
    panelIds,
    storage: groupId ? layoutStorage : unsavedStorage,
  });
  return { defaultLayout: groupId ? defaultLayout : undefined, onLayoutChanged };
}

export function collapsePanel(
  groupId: string,
  panelId: string,
  panel: PanelImperativeHandle | null,
): void {
  if (!panel || panel.isCollapsed()) return;
  writeExpandSizes(groupId, {
    ...readExpandSizes(groupId),
    [panelId]: panel.getSize().asPercentage,
  });
  panel.collapse();
}

export function expandPanel(
  groupId: string,
  panelId: string,
  panel: PanelImperativeHandle | null,
  minSize: number,
): void {
  if (!panel?.isCollapsed()) return;
  const previous = readExpandSizes(groupId)[panelId];
  panel.resize(percent(previous !== undefined && previous >= minSize ? previous : minSize));
}

export type CollapseWatch = Readonly<{
  collapsedSize: number;
  onCollapse?: () => void;
  onExpand?: () => void;
}>;

export function useCollapseTransitions(): (
  layout: Layout,
  watches: Readonly<Record<string, CollapseWatch>>,
) => void {
  const collapsedById = useRef(new Map<string, boolean>());
  return useCallback((layout, watches) => {
    const known = collapsedById.current;
    for (const id of Array.from(known.keys())) {
      if (layout[id] === undefined) known.delete(id);
    }
    for (const [id, watch] of Object.entries(watches)) {
      const size = layout[id];
      if (size === undefined) continue;
      const collapsed = Math.abs(size - watch.collapsedSize) < SIZE_TOLERANCE;
      if (known.get(id) === collapsed) continue;
      known.set(id, collapsed);
      if (collapsed) watch.onCollapse?.();
      else watch.onExpand?.();
    }
  }, []);
}

export function useSeparatorHitArea(thicknessRem: number): { coarse: number; fine: number } {
  const fontSize = useSettingsStore((state) => state.appFontSize);
  const rootFontSize = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : BASE_FONT_SIZE_PX;
  const thickness = thicknessRem * rootFontSize;
  return {
    coarse: thickness + 2 * COARSE_HIT_MARGIN_PX,
    fine: thickness + 2 * FINE_HIT_MARGIN_PX,
  };
}

export type PanelLimits = Readonly<{
  minSize?: number;
  maxSize?: number;
  collapsible?: boolean;
  collapsedSize?: number;
}>;

export function panelLimitProps(limits: PanelLimits): {
  collapsedSize: string;
  collapsible: boolean;
  maxSize: string;
  minSize: string;
} {
  return {
    collapsedSize: percent(limits.collapsedSize ?? 0),
    collapsible: limits.collapsible === true,
    maxSize: percent(limits.maxSize ?? 100),
    minSize: percent(limits.minSize ?? 0),
  };
}

type ResolvedLimits = Readonly<{
  collapsedSize: number;
  collapsible: boolean;
  maxSize: number;
  minSize: number;
}>;

const NO_LIMITS: ResolvedLimits = { collapsedSize: 0, collapsible: false, maxSize: 100, minSize: 0 };

function roundedSize(size: number): number {
  return Number.parseFloat(size.toFixed(3));
}

function compareSizes(a: number, b: number): number {
  const left = roundedSize(a);
  const right = roundedSize(b);
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function sameSize(a: number, b: number): boolean {
  return compareSizes(a, b) === 0;
}

function resolveLimits(limits: PanelLimits | undefined): ResolvedLimits {
  return {
    collapsedSize: roundedSize(limits?.collapsedSize ?? 0),
    collapsible: limits?.collapsible === true,
    maxSize: roundedSize(limits?.maxSize ?? 100),
    minSize: roundedSize(limits?.minSize ?? 0),
  };
}

function constrainSize(limits: ResolvedLimits, size: number): number {
  let next = size;
  if (compareSizes(next, limits.minSize) < 0) {
    if (limits.collapsible) {
      const halfway = (limits.collapsedSize + limits.minSize) / 2;
      next =
        compareSizes(next, limits.collapsedSize) <= 0 || compareSizes(next, halfway) < 0
          ? limits.collapsedSize
          : limits.minSize;
    } else {
      next = limits.minSize;
    }
  }
  return roundedSize(Math.min(limits.maxSize, next));
}

function reachedDelta(applied: number, delta: number): boolean {
  return (
    applied.toFixed(3).localeCompare(Math.abs(delta).toFixed(3), undefined, { numeric: true }) >= 0
  );
}

function snapKeyboardDelta(
  layout: readonly number[],
  limits: readonly ResolvedLimits[],
  [before, after]: readonly [number, number],
  requested: number,
): number {
  let delta = requested;
  const opening = delta < 0 ? after : before;
  const openingLimits = limits[opening];
  if (openingLimits?.collapsible && sameSize(layout[opening] ?? 0, openingLimits.collapsedSize)) {
    const distance = openingLimits.minSize - (layout[opening] ?? 0);
    if (compareSizes(distance, Math.abs(delta)) > 0) delta = delta < 0 ? -distance : distance;
  }
  const closing = delta < 0 ? before : after;
  const closingLimits = limits[closing];
  if (closingLimits?.collapsible && sameSize(layout[closing] ?? 0, closingLimits.minSize)) {
    const distance = (layout[closing] ?? 0) - closingLimits.collapsedSize;
    if (compareSizes(distance, Math.abs(delta)) > 0) delta = delta < 0 ? -distance : distance;
  }
  return delta;
}

function clampToAvailable(
  layout: readonly number[],
  limits: readonly ResolvedLimits[],
  [before, after]: readonly [number, number],
  delta: number,
): number {
  let available = 0;
  const outward = delta < 0 ? 1 : -1;
  for (let index = delta < 0 ? after : before; index >= 0 && index < layout.length; index += outward) {
    const size = layout[index] ?? 0;
    available += constrainSize(limits[index] ?? NO_LIMITS, 100) - size;
  }
  const magnitude = Math.min(Math.abs(delta), Math.abs(available));
  return delta < 0 ? -magnitude : magnitude;
}

export function keyboardResizeLayout(
  layout: readonly number[],
  limits: readonly PanelLimits[],
  pivot: readonly [number, number],
  requested: number,
): readonly number[] {
  if (sameSize(requested, 0)) return layout;
  const resolved = layout.map((_, index) => resolveLimits(limits[index]));
  const snapped = snapKeyboardDelta(layout, resolved, pivot, requested);
  return shiftLayout(layout, resolved, pivot, clampToAvailable(layout, resolved, pivot, snapped));
}

function resizeSizes(
  layout: readonly number[],
  limits: readonly ResolvedLimits[],
  index: number,
  size: number,
): readonly number[] {
  if (layout.length < 2) return layout;
  const last = index === layout.length - 1;
  const pivot: readonly [number, number] = last ? [index - 1, index] : [index, index + 1];
  const current = layout[index] ?? 0;
  const requested = last ? current - size : size - current;
  if (sameSize(requested, 0)) return layout;
  return shiftLayout(layout, limits, pivot, clampToAvailable(layout, limits, pivot, requested));
}

function shiftLayout(
  layout: readonly number[],
  resolved: readonly ResolvedLimits[],
  [before, after]: readonly [number, number],
  delta: number,
): readonly number[] {
  const next = [...layout];
  let applied = 0;
  const shrinkStep = delta < 0 ? -1 : 1;
  for (let index = delta < 0 ? before : after; index >= 0 && index < layout.length; index += shrinkStep) {
    const size = layout[index] ?? 0;
    const remaining = Math.abs(delta) - Math.abs(applied);
    const shrunk = constrainSize(resolved[index] ?? NO_LIMITS, size - remaining);
    if (!sameSize(size, shrunk)) {
      applied += size - shrunk;
      next[index] = shrunk;
      if (reachedDelta(applied, delta)) break;
    }
  }
  if (next.every((size, index) => size === layout[index])) return layout;
  const growing = delta < 0 ? after : before;
  const target = (layout[growing] ?? 0) + applied;
  const grown = constrainSize(resolved[growing] ?? NO_LIMITS, target);
  next[growing] = grown;
  if (!sameSize(grown, target)) {
    let remaining = target - grown;
    const spillStep = delta > 0 ? -1 : 1;
    for (let index = growing; index >= 0 && index < next.length; index += spillStep) {
      const size = next[index] ?? 0;
      const spilled = constrainSize(resolved[index] ?? NO_LIMITS, size + remaining);
      if (!sameSize(size, spilled)) {
        remaining -= spilled - size;
        next[index] = spilled;
      }
      if (sameSize(remaining, 0)) break;
    }
  }
  const total = next.reduce((sum, size) => sum + size, 0);
  return Math.abs(roundedSize(total) - 100) <= LAYOUT_TOTAL_TOLERANCE ? next : layout;
}

function samePanels(layout: Layout, panelIds: readonly string[]): boolean {
  return (
    Object.keys(layout).length === panelIds.length &&
    panelIds.every((id) => layout[id] !== undefined)
  );
}

function sameLayout(a: Layout, b: Layout): boolean {
  const ids = Object.keys(b);
  return samePanels(a, ids) && ids.every((id) => sameSize(a[id] ?? 0, b[id] ?? 0));
}

function isCollapsedIn(layout: Layout, panelId: string, collapsedSize: number): boolean {
  const size = layout[panelId];
  return size !== undefined && sameSize(size, collapsedSize);
}

function layoutFromSizes(panelIds: readonly string[], sizes: readonly number[]): Layout {
  return Object.fromEntries(panelIds.map((id, index) => [id, sizes[index] ?? 0]));
}

export function reevaluateLayout(
  layout: Layout,
  previousLimits: Readonly<Record<string, PanelLimits>>,
  limits: Readonly<Record<string, PanelLimits>>,
): Layout {
  const ids = Object.keys(layout);
  const constraints = ids.map((id) => resolveLimits(previousLimits[id]));
  let sizes: readonly number[] = ids.map((id) => layout[id] ?? 0);
  ids.forEach((id, index) => {
    const previous = constraints[index] ?? NO_LIMITS;
    const next = resolveLimits(limits[id]);
    constraints[index] = next;
    const size = sizes[index] ?? 0;
    let target: number | undefined;
    if (previous.collapsible && next.collapsible && sameSize(size, previous.collapsedSize)) {
      if (!sameSize(previous.collapsedSize, next.collapsedSize)) target = next.collapsedSize;
    } else if (compareSizes(size, next.minSize) < 0) {
      target = next.minSize;
    } else if (compareSizes(size, next.maxSize) > 0) {
      target = next.maxSize;
    }
    if (target !== undefined) sizes = resizeSizes(sizes, constraints, index, target);
  });
  return layoutFromSizes(ids, sizes);
}

function useLayoutReevaluation(
  groupRef: RefObject<GroupImperativeHandle | null>,
  panelIds: readonly string[],
  limits: Readonly<Record<string, PanelLimits>>,
): void {
  const appliedLimits = useRef(limits);
  useLayoutEffect(() => {
    const previous = appliedLimits.current;
    appliedLimits.current = limits;
    const group = groupRef.current;
    if (previous === limits || !group) return;
    const layout = group.getLayout();
    if (!samePanels(layout, panelIds)) return;
    const next = reevaluateLayout(layout, previous, limits);
    if (!sameLayout(layout, next)) group.setLayout(next);
  }, [groupRef, limits, panelIds]);
}

function readStoredLayout(groupId: string, panelIds: readonly string[]): Layout | undefined {
  const serialized = readLayout(panelLayoutKey(groupId, panelIds));
  if (serialized === null) return undefined;
  const stored = JSON.parse(serialized) as Layout;
  return samePanels(stored, panelIds)
    ? layoutFromSizes(panelIds, panelIds.map((id) => stored[id] ?? 0))
    : undefined;
}

function reopenedLayout(
  layout: Layout,
  groupId: string | undefined,
  limits: Readonly<Record<string, PanelLimits>>,
  panelId: string,
  defaultSize: number,
): Layout {
  const ids = Object.keys(layout);
  const collapsedSize = resolveLimits(limits[panelId]).collapsedSize;
  const stored = groupId ? readStoredLayout(groupId, ids) : undefined;
  if (stored) {
    const restored = reevaluateLayout(stored, limits, limits);
    if (!isCollapsedIn(restored, panelId, collapsedSize)) return restored;
  }
  const sizes = resizeSizes(
    ids.map((id) => layout[id] ?? 0),
    ids.map((id) => resolveLimits(limits[id])),
    ids.indexOf(panelId),
    defaultSize,
  );
  return layoutFromSizes(ids, sizes);
}

export type DismissiblePanel = Readonly<{
  id: string;
  defaultSize: number;
  onDismiss: () => void;
}>;

export function useDismissiblePanelLayout(
  groupRef: RefObject<GroupImperativeHandle | null>,
  groupId: string | undefined,
  panelOrder: readonly string[],
  panelIds: string[],
  limits: Readonly<Record<string, PanelLimits>>,
  { id: dismissibleId, defaultSize, onDismiss }: DismissiblePanel,
): {
  defaultLayout: Layout | undefined;
  onLayoutChange: (layout: Layout) => void;
  onLayoutChanged: (layout: Layout, meta: LayoutChangedMeta) => void;
} {
  const { defaultLayout, onLayoutChanged: persist } = usePersistentPanelLayout(
    groupId,
    panelOrder,
    panelIds,
  );
  useLayoutReevaluation(groupRef, panelIds, limits);
  const track = useCollapseTransitions();
  const lastLayout = useRef<Readonly<{ groupId: string | undefined; layout: Layout }> | null>(null);
  const collapsedSize = resolveLimits(limits[dismissibleId]).collapsedSize;

  const onLayoutChanged = useCallback(
    (layout: Layout, meta: LayoutChangedMeta) => {
      if (!isCollapsedIn(layout, dismissibleId, collapsedSize)) persist(layout, meta);
    },
    [collapsedSize, dismissibleId, persist],
  );

  const onLayoutChange = useCallback(
    (layout: Layout) => {
      const last = lastLayout.current;
      const reappeared =
        last === null || last.groupId !== groupId || !samePanels(last.layout, Object.keys(layout));
      if (reappeared && isCollapsedIn(layout, dismissibleId, collapsedSize)) {
        const target = reopenedLayout(layout, groupId, limits, dismissibleId, defaultSize);
        queueMicrotask(() => {
          const group = groupRef.current;
          if (!group) return;
          const current = group.getLayout();
          if (
            samePanels(current, Object.keys(target)) &&
            isCollapsedIn(current, dismissibleId, collapsedSize)
          ) {
            group.setLayout(target);
          }
        });
        return;
      }
      lastLayout.current = { groupId, layout };
      track(layout, { [dismissibleId]: { collapsedSize, onCollapse: onDismiss } });
    },
    [collapsedSize, defaultSize, dismissibleId, groupId, groupRef, limits, onDismiss, track],
  );

  return { defaultLayout, onLayoutChange, onLayoutChanged };
}

function adjacentPanelId(separator: Element, forward: boolean): string | undefined {
  let sibling = forward ? separator.nextElementSibling : separator.previousElementSibling;
  while (sibling && !sibling.hasAttribute("data-panel")) {
    sibling = forward ? sibling.nextElementSibling : sibling.previousElementSibling;
  }
  return sibling?.id || undefined;
}

export function useSeparatorKeyboard(
  groupRef: RefObject<GroupImperativeHandle | null>,
  limits: Readonly<Record<string, PanelLimits>>,
): (event: ReactKeyboardEvent<HTMLElement>) => void {
  return useCallback(
    (event) => {
      if (event.defaultPrevented) return;
      const separator = event.currentTarget;
      if (separator.getAttribute("aria-disabled") === "true") return;
      const resizesWidth = separator.getAttribute("aria-orientation") !== "horizontal";
      const forward = resizesWidth ? "ArrowRight" : "ArrowDown";
      const backward = resizesWidth ? "ArrowLeft" : "ArrowUp";
      const arrow = ["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"].includes(event.key);
      if (!arrow && event.key !== "Enter") return;
      const group = groupRef.current;
      if (!group) return;
      const layout = group.getLayout();
      const ids = Object.keys(layout);
      const before = ids.indexOf(adjacentPanelId(separator, false) ?? "");
      const after = ids.indexOf(adjacentPanelId(separator, true) ?? "");
      if (before < 0 || after !== before + 1) return;
      event.preventDefault();
      const sizes = ids.map((id) => layout[id] ?? 0);
      const panelLimits = ids.map((id) => limits[id] ?? {});
      let delta = 0;
      if (event.key === "Enter") {
        const toggled = resolveLimits(panelLimits[before]);
        if (!toggled.collapsible) return;
        const size = sizes[before] ?? 0;
        delta = sameSize(size, toggled.collapsedSize)
          ? toggled.minSize - toggled.collapsedSize
          : toggled.collapsedSize - size;
      } else if (event.key === forward || event.key === backward) {
        const step = event.shiftKey ? KEYBOARD_JUMP : KEYBOARD_STEP;
        delta = event.key === forward ? step : -step;
      }
      const next = keyboardResizeLayout(sizes, panelLimits, [before, after], delta);
      if (next === sizes) return;
      group.setLayout(Object.fromEntries(ids.map((id, index) => [id, next[index] ?? 0])));
    },
    [groupRef, limits],
  );
}
