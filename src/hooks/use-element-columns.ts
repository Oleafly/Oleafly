import { type RefObject, useLayoutEffect, useState } from "react";

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

export function useElementColumns(
  ref: RefObject<HTMLElement | null>,
  minRem: number,
  gapRem: number,
  fallback: number,
): number {
  const [columns, setColumns] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const width = element.clientWidth;
      if (width > 0) setColumns(columnsFor(width, minRem, gapRem, rootFontSize()));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, minRem, gapRem]);
  return columns;
}
