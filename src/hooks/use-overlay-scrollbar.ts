import { type RefObject, useLayoutEffect, useRef } from "react";
import {
  attachOverlayScrollbar,
  type OverlayScrollbarHandle,
  type ScrollAxis,
} from "@oleafly/editor/overlay-scrollbar";

interface Attached {
  scroller: HTMLElement;
  handle: OverlayScrollbarHandle;
  observed: WeakSet<Element>;
}

export function useOverlayScrollbar(
  scrollRef: RefObject<HTMLElement | null>,
  axes: readonly ScrollAxis[] = ["y"],
): void {
  const attached = useRef<Attached | null>(null);
  const axesKey = axes.join(",");

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    let current = attached.current;
    if (current && current.scroller !== scroller) {
      current.handle.destroy();
      current = null;
      attached.current = null;
    }
    const host = scroller?.parentElement;
    if (!scroller || !host) return;
    if (!current) {
      current = {
        scroller,
        handle: attachOverlayScrollbar({
          scroller,
          host,
          axes: axesKey.split(",") as ScrollAxis[],
        }),
        observed: new WeakSet(),
      };
      attached.current = current;
    }
    for (const child of scroller.children) {
      if (!(child instanceof HTMLElement) || current.observed.has(child)) continue;
      current.observed.add(child);
      current.handle.observe(child);
    }
  });

  useLayoutEffect(
    () => () => {
      attached.current?.handle.destroy();
      attached.current = null;
    },
    [],
  );
}
