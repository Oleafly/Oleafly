import { useLayoutEffect, useRef, useState } from "react";

const KEPT_SCROLLERS = "[data-pdf-scroll-root], .cm-scroller";

type ScrollOffsets = Array<{ element: HTMLElement; top: number; left: number }>;

const keptScroll = new WeakMap<HTMLElement, ScrollOffsets>();

function rememberScroll(host: HTMLElement) {
  const offsets: ScrollOffsets = [];
  for (const element of host.querySelectorAll<HTMLElement>(KEPT_SCROLLERS)) {
    if (element.scrollTop || element.scrollLeft) {
      offsets.push({ element, top: element.scrollTop, left: element.scrollLeft });
    }
  }
  keptScroll.set(host, offsets);
}

function restoreScroll(host: HTMLElement) {
  const offsets = keptScroll.get(host);
  if (!offsets) return;
  keptScroll.delete(host);
  for (const { element, top, left } of offsets) {
    if (!host.contains(element)) continue;
    element.scrollTop = top;
    element.scrollLeft = left;
  }
}

export function useKeptAliveHost(className: string): HTMLDivElement {
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = className;
    return element;
  });
  return host;
}

export function KeptAliveSlot({
  host,
  className,
}: Readonly<{
  host: HTMLElement;
  className?: string;
}>) {
  const slotRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    slot.appendChild(host);
    restoreScroll(host);
    return () => {
      rememberScroll(host);
      host.remove();
    };
  }, [host]);
  return <div ref={slotRef} className={className} />;
}
