import { type RefObject, useEffect } from "react";
import { isSelectionModifier, useLibrarySelectionStore } from "@/store/library-selection";

export const LIBRARY_ITEM = "data-library-item";
export const LIBRARY_ITEM_LOCKED = "data-library-locked";

const ITEM_SELECTOR = `[${LIBRARY_ITEM}]`;
const IGNORED = `button, a, input, textarea, select, label, [role="menu"], [role="dialog"], ${ITEM_SELECTOR}`;
const START_DISTANCE = 4;
const EDGE = 48;
const MAX_SCROLL_STEP = 22;
const BOX_CLASS = "pointer-events-none absolute left-0 top-0 z-30 rounded-md border border-primary/60 bg-primary/10";

export type Box = Readonly<{ left: number; top: number; right: number; bottom: number }>;

export function boxBetween(ax: number, ay: number, bx: number, by: number): Box {
  return { left: Math.min(ax, bx), top: Math.min(ay, by), right: Math.max(ax, bx), bottom: Math.max(ay, by) };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

export function edgeScrollStep(pointer: number, start: number, end: number): number {
  if (pointer < start + EDGE) return -Math.ceil(MAX_SCROLL_STEP * Math.min(1, (start + EDGE - pointer) / EDGE));
  if (pointer > end - EDGE) return Math.ceil(MAX_SCROLL_STEP * Math.min(1, (pointer - end + EDGE) / EDGE));
  return 0;
}

type Drag = {
  pointerId: number;
  originX: number;
  originY: number;
  clientX: number;
  clientY: number;
  before: ReadonlySet<string>;
  base: ReadonlySet<string>;
  inside: Map<string, boolean>;
  additive: boolean;
  active: boolean;
  frame: number;
  box: HTMLDivElement | null;
};

export function useMarqueeSelection(scrollRef: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!enabled || !scroller) return;
    let drag: Drag | null = null;
    let userSelect = "";

    const toContent = (clientX: number, clientY: number, bounds: DOMRect) => ({
      x: clientX - bounds.left + scroller.scrollLeft,
      y: clientY - bounds.top + scroller.scrollTop,
    });

    const update = () => {
      const current = drag;
      if (!current) return;
      current.frame = 0;
      const outer = scroller.getBoundingClientRect();
      const step = edgeScrollStep(current.clientY, outer.top, outer.bottom);
      if (step !== 0) scroller.scrollTop += step;
      const bounds = scroller.getBoundingClientRect();
      const point = toContent(current.clientX, current.clientY, bounds);
      const area = boxBetween(current.originX, current.originY, point.x, point.y);
      for (const element of scroller.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) {
        const id = element.getAttribute(LIBRARY_ITEM);
        if (!id || element.hasAttribute(LIBRARY_ITEM_LOCKED)) continue;
        const rect = element.getBoundingClientRect();
        const topLeft = toContent(rect.left, rect.top, bounds);
        const item = { left: topLeft.x, top: topLeft.y, right: topLeft.x + rect.width, bottom: topLeft.y + rect.height };
        current.inside.set(id, boxesOverlap(area, item));
      }
      const next = new Set(current.base);
      for (const [id, covered] of current.inside) if (covered) next.add(id);
      useLibrarySelectionStore.getState().replace(next);
      const box = current.box;
      if (box) {
        box.style.transform = `translate(${area.left}px, ${area.top}px)`;
        box.style.width = `${area.right - area.left}px`;
        box.style.height = `${area.bottom - area.top}px`;
      }
      if (step !== 0) current.frame = requestAnimationFrame(update);
    };

    const schedule = () => {
      if (drag?.active && !drag.frame) drag.frame = requestAnimationFrame(update);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || drag) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest(IGNORED)) return;
      const bounds = scroller.getBoundingClientRect();
      if (event.clientX - bounds.left >= scroller.clientWidth || event.clientY - bounds.top >= scroller.clientHeight) return;
      const origin = toContent(event.clientX, event.clientY, bounds);
      const additive = event.shiftKey || isSelectionModifier(event);
      const before = useLibrarySelectionStore.getState().ids;
      drag = {
        pointerId: event.pointerId,
        originX: origin.x,
        originY: origin.y,
        clientX: event.clientX,
        clientY: event.clientY,
        before,
        base: additive ? before : new Set(),
        inside: new Map(),
        additive,
        active: false,
        frame: 0,
        box: null,
      };
      scroller.setPointerCapture?.(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      const current = drag;
      if (current?.pointerId !== event.pointerId) return;
      if (event.buttons === 0) {
        drag = null;
        stop(current);
        return;
      }
      current.clientX = event.clientX;
      current.clientY = event.clientY;
      if (!current.active) {
        const point = toContent(event.clientX, event.clientY, scroller.getBoundingClientRect());
        if (Math.hypot(point.x - current.originX, point.y - current.originY) < START_DISTANCE) return;
        current.active = true;
        userSelect = scroller.style.userSelect;
        scroller.style.userSelect = "none";
        globalThis.getSelection?.()?.removeAllRanges();
        const box = document.createElement("div");
        box.className = BOX_CLASS;
        box.dataset.testid = "library-marquee";
        scroller.append(box);
        current.box = box;
      }
      schedule();
    };

    const stop = (current: Drag) => {
      if (current.frame) cancelAnimationFrame(current.frame);
      current.box?.remove();
      if (current.active) scroller.style.userSelect = userSelect;
    };

    const onLostCapture = (event: PointerEvent) => {
      const current = drag;
      if (current?.pointerId !== event.pointerId) return;
      drag = null;
      stop(current);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const current = drag;
      if (event.key !== "Escape" || !current?.active) return;
      event.preventDefault();
      drag = null;
      stop(current);
      useLibrarySelectionStore.getState().replace(new Set(current.before));
    };

    const onPointerEnd = (event: PointerEvent) => {
      const current = drag;
      if (current?.pointerId !== event.pointerId) return;
      drag = null;
      stop(current);
      if (scroller.hasPointerCapture?.(event.pointerId)) scroller.releasePointerCapture(event.pointerId);
      if (event.type === "pointerup" && !current.active && !current.additive) {
        useLibrarySelectionStore.getState().clear();
      }
    };

    scroller.addEventListener("pointerdown", onPointerDown);
    scroller.addEventListener("pointermove", onPointerMove);
    scroller.addEventListener("pointerup", onPointerEnd);
    scroller.addEventListener("pointercancel", onPointerEnd);
    scroller.addEventListener("lostpointercapture", onLostCapture);
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      scroller.removeEventListener("pointerdown", onPointerDown);
      scroller.removeEventListener("pointermove", onPointerMove);
      scroller.removeEventListener("pointerup", onPointerEnd);
      scroller.removeEventListener("pointercancel", onPointerEnd);
      scroller.removeEventListener("lostpointercapture", onLostCapture);
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("keydown", onKeyDown, true);
      if (drag) stop(drag);
      drag = null;
    };
  }, [scrollRef, enabled]);
}
