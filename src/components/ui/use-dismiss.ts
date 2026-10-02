import { useEffect, useRef, type RefObject } from "react";

export type DismissReason = "outside" | "escape";

export interface DismissOptions {
  readonly closeOnEscape?: boolean;
  readonly ignore?: string;
  readonly pointerEvent?: "pointerdown" | "mousedown";
}

function swallowedByStackedLayer(target: EventTarget | null): boolean {
  return (
    target === document.documentElement &&
    getComputedStyle(document.body).pointerEvents === "none"
  );
}

export function useDismiss(
  active: boolean,
  inside: readonly RefObject<Element | null>[],
  onDismiss: (reason: DismissReason) => void,
  { closeOnEscape = false, ignore, pointerEvent = "pointerdown" }: DismissOptions = {},
): void {
  const insideRef = useRef(inside);
  insideRef.current = inside;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!active) return;
    const onPointer = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && insideRef.current.some((ref) => ref.current?.contains(target))) {
        return;
      }
      if (ignore && target instanceof Element && target.closest(ignore)) return;
      if (swallowedByStackedLayer(target)) return;
      dismissRef.current("outside");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissRef.current("escape");
    };
    document.addEventListener(pointerEvent, onPointer, true);
    if (closeOnEscape) window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener(pointerEvent, onPointer, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [active, closeOnEscape, ignore, pointerEvent]);
}
