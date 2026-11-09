import { trackPointerDrag, type DragPoint } from "@oleafly/workspace/drag";

export { DRAG_THRESHOLD_PX, swallowNextClick } from "@oleafly/workspace/drag";

export type ReorderAxis = "x" | "y";

export interface ReorderGesture<T> {
  readonly axis: ReorderAxis;
  locate(position: number): T;
  show(drop: T | null): void;
  land(drop: T): void;
}

export function trackReorderDrag<T>(press: DragPoint, gesture: ReorderGesture<T>): () => void {
  let latest: { drop: T } | null = null;
  return trackPointerDrag(press, {
    axis: gesture.axis,
    move(point) {
      latest = { drop: gesture.locate(gesture.axis === "x" ? point.clientX : point.clientY) };
      gesture.show(latest.drop);
    },
    end(dropped) {
      const landed = latest;
      gesture.show(null);
      if (dropped && landed) gesture.land(landed.drop);
    },
  });
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
