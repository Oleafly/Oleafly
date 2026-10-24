import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/tooltip";
import { COMPOSER_KEY_STEP } from "./composer-input";

/** Page Up and Page Down move five lines at a time. */
const COMPOSER_PAGE_STEP = COMPOSER_KEY_STEP * 5;

interface DragState {
  startY: number;
  startHeight: number;
  latest: number;
  frame: number | null;
}

/**
 * The bar on the composer's top edge: drag it, or use the slider keys, to
 * change the message box's resting height. Double-click resets it.
 */
export function ComposerResizeHandle({
  height,
  min,
  max,
  onPreview,
  onCommit,
  onReset,
}: Readonly<{
  height: number;
  min: number;
  max: number;
  onPreview: (height: number) => void;
  onCommit: (height: number) => void;
  onReset: () => void;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const drag = useRef<DragState | null>(null);
  const clamp = (value: number) => Math.round(Math.min(max, Math.max(min, value)));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Keeps the drag from selecting text in the transcript.
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { startY: event.clientY, startHeight: height, latest: height, frame: null };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    const next = clamp(state.startHeight + (state.startY - event.clientY));
    if (next === state.latest) return;
    state.latest = next;
    if (state.frame !== null) return;
    // At most one preview per frame: the first move shows at once, later
    // ones in the same frame land when it ends.
    onPreview(next);
    let shown = next;
    state.frame = requestAnimationFrame(() => {
      const current = drag.current;
      if (!current) return;
      current.frame = null;
      if (current.latest !== shown) {
        shown = current.latest;
        onPreview(shown);
      }
    });
  };

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    drag.current = null;
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onCommit(state.latest);
  };

  // The keys of a slider: the arrows move one line, Page Up and Page Down
  // five, Home and End go to the smallest and largest box.
  const keyTarget = (key: string): number | null => {
    switch (key) {
      case "ArrowUp":
      case "ArrowRight":
        return height + COMPOSER_KEY_STEP;
      case "ArrowDown":
      case "ArrowLeft":
        return height - COMPOSER_KEY_STEP;
      case "PageUp":
        return height + COMPOSER_PAGE_STEP;
      case "PageDown":
        return height - COMPOSER_PAGE_STEP;
      case "Home":
        return min;
      case "End":
        return max;
      default:
        return null;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = keyTarget(event.key);
    if (target === null) return;
    event.preventDefault();
    onCommit(clamp(target));
  };

  return (
    <Tooltip
      label={t(($) => $.ai.composer.resizeHint)}
      side="top"
      relative={false}
      className="absolute inset-x-6 -top-1 z-10 h-2"
    >
      <div
        role="slider"
        aria-orientation="vertical"
        aria-label={t(($) => $.ai.composer.resizeHandle)}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={height}
        tabIndex={0}
        data-testid="ai-composer-resize"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onDoubleClick={onReset}
        onKeyDown={onKeyDown}
        className="group flex h-full w-full cursor-ns-resize touch-none items-center justify-center"
      >
        <span className="h-1 w-8 rounded-full bg-transparent transition-colors group-hover:bg-border group-focus-visible:bg-primary/50 group-active:bg-primary/50" />
      </div>
    </Tooltip>
  );
}
