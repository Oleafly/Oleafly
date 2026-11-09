export const DRAG_THRESHOLD_PX = 6;

export type ReorderAxis = "x" | "y";

export interface ReorderGesture<T> {
  readonly axis: ReorderAxis;
  locate(position: number): T;
  show(drop: T | null): void;
  land(drop: T): void;
}

interface Point {
  readonly clientX: number;
  readonly clientY: number;
}

function along(point: Point, axis: ReorderAxis): number {
  return axis === "x" ? point.clientX : point.clientY;
}

export function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}

export function trackReorderDrag<T>(press: Point, gesture: ReorderGesture<T>): () => void {
  const origin = along(press, gesture.axis);
  let latest: T | null = null;
  let stopped = false;
  const move = (next: PointerEvent) => {
    const position = along(next, gesture.axis);
    if (latest === null && Math.abs(position - origin) < DRAG_THRESHOLD_PX) return;
    latest = gesture.locate(position);
    gesture.show(latest);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", cancel);
    window.removeEventListener("keydown", onEscape, true);
    gesture.show(null);
  };
  const finish = () => {
    const landed = latest;
    stop();
    if (landed === null) return;
    swallowNextClick();
    gesture.land(landed);
  };
  const cancel = () => {
    if (latest !== null) swallowNextClick();
    stop();
  };
  const onEscape = (key: KeyboardEvent) => {
    if (key.key !== "Escape" || latest === null) return;
    key.preventDefault();
    key.stopPropagation();
    cancel();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", cancel);
  window.addEventListener("keydown", onEscape, true);
  return stop;
}

export function slotAlong(rects: readonly DOMRect[], position: number, axis: ReorderAxis): number {
  return rects.filter((rect) =>
    axis === "x" ? position > rect.left + rect.width / 2 : position > rect.top + rect.height / 2,
  ).length;
}

export function placeAmong(order: readonly string[], visible: readonly string[], id: string, slot: number): string[] {
  const rest = order.filter((item) => item !== id);
  const others = visible.filter((item) => item !== id && rest.includes(item));
  if (!order.includes(id) || others.length === 0) return [...order];
  const at = Math.max(0, slot);
  const index = at < others.length ? rest.indexOf(others[at] as string) : rest.indexOf(others.at(-1) as string) + 1;
  rest.splice(index, 0, id);
  return rest;
}
