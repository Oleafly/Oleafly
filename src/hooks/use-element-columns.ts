import { type RefObject, useCallback, useLayoutEffect, useState } from "react";

function rootFontSize(): number {
  if (typeof document === "undefined") return 16;
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
}

export function columnsFor(width: number, minRem: number, gapRem: number, rem: number): number {
  const min = minRem * rem;
  const gap = gapRem * rem;
  return Math.max(1, Math.floor((width + gap) / (min + gap)));
}

export function gridTrackCount(value: string): number {
  if (value.includes("(")) return 0;
  return value.split(/\s+/u).filter((track) => track.endsWith("px")).length;
}

function useObservedCount(ref: RefObject<HTMLElement | null>, fallback: number, read: (element: HTMLElement) => number): number {
  const [count, setCount] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const next = read(element);
      if (next > 0) setCount(next);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, read]);
  return count;
}

export function useElementColumns(
  ref: RefObject<HTMLElement | null>,
  minRem: number,
  gapRem: number,
  fallback: number,
): number {
  const read = useCallback(
    (element: HTMLElement) => {
      const width = element.clientWidth;
      return width > 0 ? columnsFor(width, minRem, gapRem, rootFontSize()) : 0;
    },
    [minRem, gapRem],
  );
  return useObservedCount(ref, fallback, read);
}

function readGridTracks(element: HTMLElement): number {
  return gridTrackCount(getComputedStyle(element).gridTemplateColumns);
}

export function useGridTracks(ref: RefObject<HTMLElement | null>, fallback: number): number {
  return useObservedCount(ref, fallback, readGridTracks);
}
