import { type RefObject, useEffect } from "react";

const DRAG_REGION = "[data-tauri-drag-region]";
const CLICKABLE = 'button, a, input, textarea, select, [role="button"]';

export function startsWindowDrag(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const region = target.closest(DRAG_REGION);
  if (!(region instanceof HTMLElement) || region.dataset.tauriDragRegion === "false") return false;
  return target.closest(CLICKABLE) === null;
}

export function useWindowDragHoverGuard(scrollRef: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!enabled || !scroller) return;
    let guarded = false;

    const release = () => {
      if (!guarded) return;
      guarded = false;
      scroller.style.removeProperty("pointer-events");
    };
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || !startsWindowDrag(event.target)) return;
      guarded = true;
      scroller.style.pointerEvents = "none";
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons === 0) release();
    };

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("mouseup", release, true);
    window.addEventListener("wheel", release, { capture: true, passive: true });
    window.addEventListener("keydown", release, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("mouseup", release, true);
      window.removeEventListener("wheel", release, true);
      window.removeEventListener("keydown", release, true);
      window.removeEventListener("blur", release);
      release();
    };
  }, [scrollRef, enabled]);
}
