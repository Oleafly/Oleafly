import { useCallback, useRef, useState, type ReactNode } from "react";

/**
 * Width-measured toolbar overflow.
 *
 * A toolbar declares each control's width up front, measures the space it
 * actually has, and moves the controls that do not fit into a "more" menu.
 * Declared widths are used rather than measured ones so the decision is made in
 * one pass, without a layout thrash per control on every resize.
 */
export interface ToolbarControl {
  id: string;
  width: number;
  render: () => ReactNode;
  /** The same control as menu rows, or null for separators. */
  renderMenu: () => ReactNode;
}

export const ICON_BUTTON_WIDTH = 28;
export const DROPDOWN_TRIGGER_WIDTH = 44;
export const DIVIDER_WIDTH = 9;
export const MORE_BUTTON_WIDTH = 32;
export const CONTROL_GAP = 2;

export function useAvailableWidth() {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [availableWidth, setAvailableWidth] = useState(
    Number.POSITIVE_INFINITY,
  );

  const containerRef = useCallback((container: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!container) return;

    const recompute = () => setAvailableWidth(container.clientWidth);
    recompute();
    // Non-browser runtimes (jsdom under test) have no ResizeObserver. The
    // measurement above still ran, so the toolbar lays out rather than throwing.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    observerRef.current = observer;
  }, []);

  return { containerRef, availableWidth };
}

/**
 * How many leading controls fit.
 *
 * The whole bar is measured first: room for the "more" button is only reserved
 * once something genuinely overflows, otherwise a bar that fits exactly would
 * hide its last controls behind a button it never needed.
 */
export function fitCount(
  controls: ToolbarControl[],
  availableWidth: number,
): number {
  const total = controls.reduce(
    (sum, control, index) =>
      sum + control.width + (index > 0 ? CONTROL_GAP : 0),
    0,
  );
  if (total <= availableWidth) return controls.length;

  let used = 0;
  for (let index = 0; index < controls.length; index++) {
    used += controls[index].width + (index > 0 ? CONTROL_GAP : 0);
    if (used + CONTROL_GAP + MORE_BUTTON_WIDTH > availableWidth) return index;
  }
  return controls.length;
}
