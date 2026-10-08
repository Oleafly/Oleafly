import { type RefObject, useCallback, useLayoutEffect, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";

export const MEASURED_WINDOW_ITEM = "data-window-index";
export const UNMEASURED_ITEM_COUNT = 40;
const DEFAULT_OVERSCAN = 480;

export type MeasuredRange = Readonly<{ start: number; end: number }>;

export type MeasuredWindow = MeasuredRange &
  Readonly<{
    paddingTop: number;
    paddingBottom: number;
  }>;

export function measuredSizes(
  keys: readonly string[],
  heights: ReadonlyMap<string, number>,
  estimate: (index: number) => number,
): Float64Array {
  const sizes = new Float64Array(keys.length);
  for (let index = 0; index < keys.length; index++) {
    sizes[index] = heights.get(keys[index]) ?? estimate(index);
  }
  return sizes;
}

export function prefixSums(sizes: Float64Array, into?: Float64Array): Float64Array {
  const offsets = into?.length === sizes.length + 1 ? into : new Float64Array(sizes.length + 1);
  for (let index = 0; index < sizes.length; index++) offsets[index + 1] = offsets[index] + sizes[index];
  return offsets;
}

function firstEndingAfter(offsets: Float64Array, position: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle + 1] > position) high = middle;
    else low = middle + 1;
  }
  return low;
}

export function measuredRange(offsets: Float64Array, top: number, bottom: number): MeasuredRange {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0 };
  const start = Math.min(count - 1, firstEndingAfter(offsets, top));
  let end = start + 1;
  while (end < count && offsets[end] < bottom) end++;
  return { start, end };
}

function sameRange(left: MeasuredRange, right: MeasuredRange): boolean {
  return left.start === right.start && left.end === right.end;
}

function fits(
  offsets: Float64Array,
  range: MeasuredRange,
  top: number,
  bottom: number,
  slack: number,
): boolean {
  const count = offsets.length - 1;
  if (count <= 0 || range.end <= range.start || range.end > count) return false;
  const first = offsets[range.start];
  const last = offsets[range.end];
  const above = (range.start === 0 || first <= top) && first >= top - slack;
  const below = (range.end === count || last >= bottom) && last <= bottom + slack;
  return above && below;
}

function nearestScrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let parent = element?.parentElement ?? null; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === "auto" || overflow === "scroll") return parent;
  }
  return null;
}

function measureChildren(
  list: HTMLElement,
  keys: readonly string[],
  current: Model,
  heights: Map<string, number>,
  anchor: number,
): number {
  let shift = 0;
  for (const child of list.children) {
    const attribute = child.getAttribute(MEASURED_WINDOW_ITEM);
    if (attribute === null) continue;
    const index = Number(attribute);
    const key = keys[index];
    if (key === undefined) continue;
    const measured = child.getBoundingClientRect().height;
    if (measured <= 0) continue;
    const used = current.sizes[index];
    if (Math.abs(measured - used) < 0.5) continue;
    current.sizes[index] = measured;
    current.dirty = true;
    heights.set(key, measured);
    if (index < anchor) shift += measured - used;
  }
  return shift;
}

interface Geometry {
  scroller: HTMLElement;
  list: HTMLElement;
  viewTop: number;
  viewHeight: number;
}

interface Model {
  keys: readonly string[];
  estimate: (index: number) => number;
  sizes: Float64Array;
  offsets: Float64Array;
  dirty: boolean;
}

export function useMeasuredWindow({
  keys,
  estimate,
  scrollRef,
  listRef,
  overscan = DEFAULT_OVERSCAN,
}: Readonly<{
  keys: readonly string[];
  estimate: (index: number) => number;
  scrollRef: RefObject<HTMLElement | null>;
  listRef: RefObject<HTMLElement | null>;
  overscan?: number;
}>): MeasuredWindow {
  const heights = useRef(new Map<string, number>());
  const model = useRef<Model | null>(null);
  if (model.current?.keys !== keys || model.current.estimate !== estimate) {
    const sizes = measuredSizes(keys, heights.current, estimate);
    model.current = { keys, estimate, sizes, offsets: prefixSums(sizes), dirty: false };
    if (heights.current.size > keys.length * 2 + 64) {
      const live = new Set(keys);
      for (const key of heights.current.keys()) if (!live.has(key)) heights.current.delete(key);
    }
  }
  const [, bumpVersion] = useReducer((value: number) => value + 1, 0);
  const count = keys.length;
  const [range, setRange] = useState<MeasuredRange>(() => ({
    start: 0,
    end: Math.min(count, UNMEASURED_ITEM_COUNT),
  }));
  const shownRange = useRef(range);
  const found = useRef<HTMLElement | null>(null);
  const subscribed = useRef<{ scroller: HTMLElement; detach: () => void } | null>(null);

  const offsetsNow = useCallback((): Float64Array => {
    const current = model.current as Model;
    if (current.dirty) {
      prefixSums(current.sizes, current.offsets);
      current.dirty = false;
    }
    return current.offsets;
  }, []);

  const resolveScroller = useCallback((): HTMLElement | null => {
    const explicit = scrollRef.current;
    if (explicit) return explicit;
    const list = listRef.current;
    if (!found.current?.contains(list)) found.current = nearestScrollParent(list);
    return found.current;
  }, [listRef, scrollRef]);

  const geometry = useCallback((): Geometry | null => {
    const scroller = resolveScroller();
    const list = listRef.current;
    if (!scroller || !list || scroller.clientHeight <= 0) return null;
    const viewTop = scroller.getBoundingClientRect().top - list.getBoundingClientRect().top;
    return { scroller, list, viewTop, viewHeight: scroller.clientHeight };
  }, [listRef, resolveScroller]);

  const update = useRef<(sync: boolean) => void>(() => {});
  update.current = (sync: boolean) => {
    const box = geometry();
    const offsets = offsetsNow();
    const current = shownRange.current;
    let next: MeasuredRange;
    if (box) {
      const margin = overscan / 2;
      const top = box.viewTop - margin;
      const bottom = box.viewTop + box.viewHeight + margin;
      if (fits(offsets, current, top, bottom, overscan * 1.5)) return;
      next = measuredRange(offsets, box.viewTop - overscan, box.viewTop + box.viewHeight + overscan);
    } else {
      next = { start: 0, end: Math.min(offsets.length - 1, UNMEASURED_ITEM_COUNT) };
    }
    if (sameRange(next, current)) return;
    shownRange.current = next;
    if (sync) flushSync(() => setRange(next));
    else setRange(next);
  };

  useLayoutEffect(() => {
    const scroller = resolveScroller();
    if (subscribed.current?.scroller === scroller) return;
    subscribed.current?.detach();
    subscribed.current = null;
    if (!scroller) return;
    const onScroll = () => update.current(true);
    const onResize = () => bumpVersion();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    observer?.observe(scroller);
    for (const child of scroller.children) observer?.observe(child);
    subscribed.current = {
      scroller,
      detach: () => {
        scroller.removeEventListener("scroll", onScroll);
        observer?.disconnect();
      },
    };
  });

  useLayoutEffect(
    () => () => {
      subscribed.current?.detach();
      subscribed.current = null;
    },
    [],
  );

  useLayoutEffect(() => {
    shownRange.current = range;
    const box = geometry();
    const current = model.current as Model;
    if (box) {
      const anchor = firstEndingAfter(offsetsNow(), box.viewTop);
      const shift = measureChildren(box.list, keys, current, heights.current, anchor);
      if (shift !== 0) box.scroller.scrollTop += shift;
    }
    update.current(false);
  });

  const offsets = offsetsNow();
  const start = Math.min(range.start, count);
  const end = Math.min(Math.max(range.end, start), count);
  return {
    start,
    end,
    paddingTop: offsets[start] ?? 0,
    paddingBottom: Math.max(0, (offsets[count] ?? 0) - (offsets[end] ?? 0)),
  };
}
