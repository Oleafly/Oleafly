import { type RefObject, useLayoutEffect, useRef, useState } from "react";

export const HOT_ROW_ATTRIBUTE = "data-hot-row";

function rowKey(container: HTMLElement, node: EventTarget | null): string | null {
  if (!(node instanceof Element)) return null;
  const row = node.closest<HTMLElement>(`[${HOT_ROW_ATTRIBUTE}]`);
  return row && container.contains(row) ? row.getAttribute(HOT_ROW_ATTRIBUTE) : null;
}

export function useHotRow(listRef: RefObject<HTMLElement | null>): string | null {
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const attached = useRef<HTMLElement | null>(null);
  const detach = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === attached.current) return;
    detach.current?.();
    detach.current = null;
    attached.current = list;
    if (!list) return;
    const onOver = (event: PointerEvent) => setHovered(rowKey(list, event.target));
    const onLeave = () => setHovered(null);
    const onFocusIn = (event: FocusEvent) => setFocused(rowKey(list, event.target));
    const onFocusOut = (event: FocusEvent) => {
      if (!rowKey(list, event.relatedTarget)) setFocused(null);
    };
    list.addEventListener("pointerover", onOver);
    list.addEventListener("pointerleave", onLeave);
    list.addEventListener("focusin", onFocusIn);
    list.addEventListener("focusout", onFocusOut);
    detach.current = () => {
      list.removeEventListener("pointerover", onOver);
      list.removeEventListener("pointerleave", onLeave);
      list.removeEventListener("focusin", onFocusIn);
      list.removeEventListener("focusout", onFocusOut);
    };
  });

  useLayoutEffect(
    () => () => {
      detach.current?.();
      detach.current = null;
      attached.current = null;
    },
    [],
  );

  return hovered ?? focused;
}
