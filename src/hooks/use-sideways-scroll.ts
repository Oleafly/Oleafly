import { useEffect } from "react";

export interface SidewaysScrollActive {
  /** Selects the item to keep in view. */
  selector: string;
  /** The attribute that changes when another item becomes active. */
  attribute: string;
}

const EDGE_MASK =
  "[mask-image:linear-gradient(to_right,transparent,#000_var(--fade-start,0px),#000_calc(100%_-_var(--fade-end,0px)),transparent)]";

export const SIDEWAYS_FADE = `scroll-px-6 data-[overflow-start]:[--fade-start:1.5rem] data-[overflow-end]:[--fade-end:1.5rem] data-[overflow-start]:${EDGE_MASK} data-[overflow-end]:${EDGE_MASK}`;

function markEdges(strip: HTMLElement) {
  const hidden = strip.scrollWidth - strip.clientWidth;
  strip.toggleAttribute("data-overflow-start", hidden > 1 && strip.scrollLeft > 1);
  strip.toggleAttribute("data-overflow-end", hidden > 1 && strip.scrollLeft < hidden - 1);
}

export function useScrollEdges(strip: HTMLElement | null, enabled = true) {
  useEffect(() => {
    if (!enabled || !strip) return;
    const mark = () => markEdges(strip);
    const resizes = new ResizeObserver(mark);
    const watch = () => {
      resizes.disconnect();
      resizes.observe(strip);
      for (const child of strip.children) resizes.observe(child);
    };
    const changes = new MutationObserver(() => {
      watch();
      mark();
    });
    mark();
    watch();
    changes.observe(strip, { subtree: true, childList: true, characterData: true });
    strip.addEventListener("scroll", mark, { passive: true });
    return () => {
      changes.disconnect();
      resizes.disconnect();
      strip.removeEventListener("scroll", mark);
      strip.removeAttribute("data-overflow-start");
      strip.removeAttribute("data-overflow-end");
    };
  }, [strip, enabled]);
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
  useScrollEdges(strip, enabled);
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
    const addsActive = (record: MutationRecord) =>
      [...record.addedNodes].some(
        (node) => node instanceof Element && (node.matches(selector) || node.querySelector(selector) !== null),
      );
    revealActive();
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.type === "attributes" || addsActive(record))) revealActive();
    });
    observer.observe(strip, { subtree: true, childList: true, attributeFilter: [attribute] });
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      strip.removeEventListener("wheel", onWheel);
    };
  }, [strip, enabled, selector, attribute]);
}
