import { useEffect } from "react";

export interface SidewaysScrollActive {
  /** Selects the item to keep in view. */
  selector: string;
  /** The attribute that changes when another item becomes active. */
  attribute: string;
}

/**
 * A one-line strip that scrolls sideways with its scrollbar hidden can only be
 * scrolled with a trackpad. This turns a vertical mouse wheel into a sideways
 * scroll of the strip and keeps its active item in view.
 */
export function useSidewaysScroll(
  strip: HTMLElement | null,
  active: SidewaysScrollActive,
  enabled = true,
) {
  const { selector, attribute } = active;
  useEffect(() => {
    if (!enabled || !strip) return;
    const onWheel = (event: WheelEvent) => {
      if (strip.scrollWidth <= strip.clientWidth) return;
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    };
    const revealActive = () => {
      strip
        .querySelector<HTMLElement>(selector)
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    };
    revealActive();
    const observer = new MutationObserver(revealActive);
    observer.observe(strip, { subtree: true, attributeFilter: [attribute] });
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      strip.removeEventListener("wheel", onWheel);
    };
  }, [strip, enabled, selector, attribute]);
}
