import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

interface PanelResizerProps {
  width: number;
  minWidth: number;
  maxWidth: number;
  onResize: (width: number) => void;
  onReset: () => void;
  label: string;
  /** Growing rightward (left sidebar) or leftward (right panel). */
  side?: "left" | "right";
  testId?: string;
}

// Vertical drag divider for side panels. Dragging is delta-based — the
// pointer's movement from where the drag started maps onto the width — so it
// works no matter what else borders the panel (window edge, icon rail, …).
// Drag to resize, double-click to reset, arrow keys for keyboard resizing.
export function PanelResizer({
  width,
  minWidth,
  maxWidth,
  onResize,
  onReset,
  label,
  side = "right",
  testId = "harness-panel-resizer",
}: PanelResizerProps) {
  const dragging = useRef(false);
  const origin = useRef<{ x: number; width: number } | null>(null);

  const clamp = useCallback(
    (next: number) => Math.min(maxWidth, Math.max(minWidth, next)),
    [minWidth, maxWidth],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragging.current = true;
    origin.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !origin.current) return;
    const delta =
      side === "right"
        ? origin.current.x - event.clientX
        : event.clientX - origin.current.x;
    onResize(clamp(origin.current.width + delta));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    origin.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    const grow = side === "right" ? event.key === "ArrowLeft" : event.key === "ArrowRight";
    const shrink = side === "right" ? event.key === "ArrowRight" : event.key === "ArrowLeft";
    if (grow) {
      event.preventDefault();
      onResize(clamp(width + step));
    } else if (shrink) {
      event.preventDefault();
      onResize(clamp(width - step));
    } else if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      onReset();
    }
  };

  return (
    <hr
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      aria-valuetext={`${Math.round(width)} pixels`}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      data-testid={testId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative m-0 w-1 shrink-0 cursor-col-resize rounded-full bg-transparent transition-all",
        // A wide pseudo-element makes the thin rule grabbable like a real
        // divider; the rule itself becomes visible on hover/focus.
        "after:absolute after:inset-y-0 after:-left-2 after:-right-2 after:content-['']",
        "hover:bg-primary/50 focus-visible:bg-primary/50 focus-visible:outline-none",
      )}
    />
  );
}
