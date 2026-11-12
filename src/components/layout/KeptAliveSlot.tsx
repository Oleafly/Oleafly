import { useLayoutEffect, useRef, useState } from "react";

const KEPT_SCROLLERS = "[data-keep-scroll], [data-pdf-scroll-root], .cm-scroller, .xterm-viewport";

type KeptState = {
  offsets: Array<{ element: HTMLElement; top: number; left: number }>;
  focused: HTMLElement | null;
};

const keptState = new WeakMap<HTMLElement, KeptState>();

function remember(host: HTMLElement) {
  const offsets: KeptState["offsets"] = [];
  for (const element of host.querySelectorAll<HTMLElement>(KEPT_SCROLLERS)) {
    if (element.scrollTop || element.scrollLeft) {
      offsets.push({ element, top: element.scrollTop, left: element.scrollLeft });
    }
  }
  const active = host.ownerDocument.activeElement;
  keptState.set(host, { offsets, focused: active instanceof HTMLElement && host.contains(active) ? active : null });
}

function restore(host: HTMLElement) {
  const kept = keptState.get(host);
  if (!kept) return;
  keptState.delete(host);
  for (const { element, top, left } of kept.offsets) {
    if (!host.contains(element)) continue;
    element.scrollTop = top;
    element.scrollLeft = left;
  }
  if (kept.focused && host.contains(kept.focused)) kept.focused.focus({ preventScroll: true });
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
    restore(host);
    return () => {
      remember(host);
      host.remove();
    };
  }, [host]);
  return <div ref={slotRef} className={className} />;
}
