import { type RefObject, useLayoutEffect, useRef, useState } from "react";

export interface SelectionAnchor {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
}

export interface PlacementBounds {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface BoxSize {
  readonly width: number;
  readonly height: number;
}

export function placeAboveSelection(
  anchor: SelectionAnchor,
  bounds: PlacementBounds,
  box: BoxSize,
  gap = 8,
): { top: number; left: number } {
  const above = anchor.top - gap - box.height;
  const preferred = above >= bounds.top ? above : anchor.bottom + gap;
  return {
    top: Math.max(bounds.top, Math.min(preferred, bounds.bottom - box.height)),
    left: Math.max(bounds.left, Math.min(anchor.left, bounds.right - box.width)),
  };
}

export function useMeasuredBox<T extends HTMLElement>(): [RefObject<T | null>, BoxSize | null] {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<BoxSize | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    setBox((current) => (current?.width === width && current.height === height ? current : { width, height }));
  });
  return [ref, box];
}
