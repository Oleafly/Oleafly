import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export type RowRange = Readonly<{ start: number; end: number }>;

export type RowWindow = RowRange &
  Readonly<{
    paddingTop: number;
    paddingBottom: number;
    scrollToIndex: (index: number) => void;
  }>;

export const UNMEASURED_ROW_COUNT = 80;
const DEFAULT_OVERSCAN = 12;
const NO_SCROLLER_TARGET: { readonly element: HTMLElement | null } = { element: null };
export const ROW_WINDOW_ITEM = "data-row-window-item";

export function rowRange(
  count: number,
  rowHeight: number,
  viewportTop: number,
  viewportHeight: number,
  overscan: number,
  unmeasuredCount: number = UNMEASURED_ROW_COUNT,
): RowRange {
  if (count <= 0) return { start: 0, end: 0 };
  if (rowHeight <= 0 || viewportHeight <= 0) {
    return { start: 0, end: Math.min(count, unmeasuredCount) };
  }
  const top = Math.max(0, viewportTop);
  const first = Math.min(count, Math.floor(top / rowHeight));
  const last = Math.min(count, Math.ceil((top + viewportHeight) / rowHeight));
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count, Math.max(last, first + 1) + overscan),
  };
}

type Measured = Readonly<{ range: RowRange; rowHeight: number }>;

function sameMeasure(left: Measured, right: Measured): boolean {
  return (
    left.range.start === right.range.start &&
    left.range.end === right.range.end &&
    left.rowHeight === right.rowHeight
  );
}

function nearestScrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let parent = element?.parentElement ?? null; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === "auto" || overflow === "scroll") return parent;
  }
  return null;
}

export function useRowWindow({
  count,
  scrollRef,
  listRef,
  overscan = DEFAULT_OVERSCAN,
  unmeasuredCount = UNMEASURED_ROW_COUNT,
}: Readonly<{
  count: number;
  scrollRef?: RefObject<HTMLElement | null>;
  listRef: RefObject<HTMLElement | null>;
  overscan?: number;
  unmeasuredCount?: number;
}>): RowWindow {
  const [measured, setMeasured] = useState<Measured>(() => ({
    range: rowRange(count, 0, 0, 0, overscan, unmeasuredCount),
    rowHeight: 0,
  }));
  const rowHeightRef = useRef(0);
  const frame = useRef(0);
  const foundScroller = useRef<HTMLElement | null>(null);

  const subscribed = useRef<HTMLElement | null>(null);
  const [scrollerTarget, setScrollerTarget] = useState<{ readonly element: HTMLElement | null }>(NO_SCROLLER_TARGET);

  const resolveScroller = useCallback((): HTMLElement | null => {
    const explicit = scrollRef?.current;
    if (explicit) return explicit;
    const list = listRef.current;
    if (!foundScroller.current?.contains(list)) {
      foundScroller.current = nearestScrollParent(list);
    }
    return foundScroller.current;
  }, [listRef, scrollRef]);

  const geometry = useCallback(() => {
    const scroller = resolveScroller();
    const list = listRef.current;
    if (!scroller || !list) return null;
    const sample = list.querySelector<HTMLElement>(`[${ROW_WINDOW_ITEM}]`);
    const sampled = sample?.getBoundingClientRect().height ?? 0;
    if (sampled > 0) rowHeightRef.current = sampled;
    const listTop =
      list.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    return {
      scroller,
      listTop,
      rowHeight: rowHeightRef.current,
    };
  }, [listRef, resolveScroller]);

  const latest = useRef(measured);

  const nextMeasure = useCallback((): Measured | null => {
    const current = geometry();
    if (!current) return null;
    return {
      range: rowRange(
        count,
        current.rowHeight,
        current.scroller.scrollTop - current.listTop,
        current.scroller.clientHeight,
        overscan,
        unmeasuredCount,
      ),
      rowHeight: current.rowHeight,
    };
  }, [count, geometry, overscan, unmeasuredCount]);

  const measure = useCallback(() => {
    const next = nextMeasure();
    if (!next) return;
    setMeasured((previous) => (sameMeasure(previous, next) ? previous : next));
  }, [nextMeasure]);

  const measureNow = useCallback(() => {
    const next = nextMeasure();
    if (!next || sameMeasure(latest.current, next)) return;
    latest.current = next;
    flushSync(() => setMeasured(next));
  }, [nextMeasure]);

  useLayoutEffect(() => {
    const scroller = scrollerTarget.element ?? resolveScroller();
    subscribed.current = scroller;
    const list = listRef.current;
    if (!scroller) return;
    const schedule = () => {
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        measure();
      });
    };
    scroller.addEventListener("scroll", measureNow, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(scroller);
    if (list) observer?.observe(list);
    return () => {
      subscribed.current = null;
      scroller.removeEventListener("scroll", measureNow);
      observer?.disconnect();
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [listRef, measure, measureNow, resolveScroller, scrollerTarget]);

  useLayoutEffect(() => {
    latest.current = measured;
    const scroller = resolveScroller();
    if (scroller !== subscribed.current) setScrollerTarget({ element: scroller });
    measure();
  });

  const scrollToIndex = useCallback(
    (index: number) => {
      const current = geometry();
      if (!current || current.rowHeight <= 0) return;
      const { scroller, listTop, rowHeight } = current;
      const top = listTop + index * rowHeight;
      const bottom = top + rowHeight;
      if (top < scroller.scrollTop) scroller.scrollTop = top;
      else if (bottom > scroller.scrollTop + scroller.clientHeight) {
        scroller.scrollTop = bottom - scroller.clientHeight;
      }
      measure();
    },
    [geometry, measure],
  );

  const rowHeight = measured.rowHeight;
  const range =
    rowHeight > 0 ? measured.range : rowRange(count, 0, 0, 0, overscan, unmeasuredCount);
  const start = Math.min(range.start, count);
  const end = Math.min(range.end, count);
  return {
    start,
    end,
    paddingTop: rowHeight > 0 ? start * rowHeight : 0,
    paddingBottom: rowHeight > 0 ? Math.max(0, count - end) * rowHeight : 0,
    scrollToIndex,
  };
}
