export const DRAG_THRESHOLD_PX = 6;

export interface DragPoint {
  readonly clientX: number;
  readonly clientY: number;
}

export interface PointerDrag {
  readonly axis?: "x" | "y";
  readonly perFrame?: boolean;
  start?(point: DragPoint): void;
  move(point: DragPoint): void;
  end(dropped: boolean): void;
}

function travel(from: DragPoint, to: DragPoint, axis: PointerDrag["axis"]): number {
  if (axis === "x") return Math.abs(to.clientX - from.clientX);
  if (axis === "y") return Math.abs(to.clientY - from.clientY);
  return Math.hypot(to.clientX - from.clientX, to.clientY - from.clientY);
}

export function swallowNextClick(): void {
  const disarm = () => {
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("pointerdown", disarm, true);
  };
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    disarm();
  };
  window.addEventListener("click", swallow, true);
  window.addEventListener("pointerdown", disarm, true);
  window.setTimeout(disarm, 0);
}

export function trackPointerDrag(press: DragPoint, drag: PointerDrag): () => void {
  const origin = { clientX: press.clientX, clientY: press.clientY };
  let started = false;
  let stopped = false;
  let frame = 0;
  let pending: DragPoint | null = null;

  const flush = () => {
    frame = 0;
    const point = pending;
    pending = null;
    if (point) drag.move(point);
  };

  const move = (event: PointerEvent) => {
    if (!started) {
      if (travel(origin, event, drag.axis) < DRAG_THRESHOLD_PX) return;
      started = true;
      drag.start?.(origin);
    }
    if (!drag.perFrame) {
      drag.move(event);
      return;
    }
    pending = { clientX: event.clientX, clientY: event.clientY };
    if (frame === 0) frame = requestAnimationFrame(flush);
  };

  const stop = (dropped: boolean, swallow: boolean) => {
    if (stopped) return;
    stopped = true;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", cancel);
    window.removeEventListener("keydown", escape, true);
    if (frame !== 0) cancelAnimationFrame(frame);
    if (dropped) flush();
    frame = 0;
    pending = null;
    if (!started) return;
    if (swallow) swallowNextClick();
    drag.end(dropped);
  };

  const up = () => stop(true, true);
  const cancel = () => stop(false, true);
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !started) return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", cancel);
  window.addEventListener("keydown", escape, true);
  return () => stop(false, false);
}
