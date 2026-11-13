import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { slotAlong } from "@oleafly/workspace/geometry";
import { placeAmong, trackReorderDrag } from "./reorder-drag";

const ITEM = "data-reorder-item";
const STRIP = "data-reorder-strip";
const TEXT_ENTRY = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

interface StripDrop {
  id: string;
  slot: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface StripItemProps {
  "data-reorder-item": string;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export interface StripReorder {
  readonly dragging: string | null;
  readonly strip: { ref: RefObject<HTMLDivElement | null>; "data-reorder-strip": "" };
  item(id: string): StripItemProps;
  readonly indicator: ReactNode;
}

export function isReorderItem(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${ITEM}]`) !== null;
}

function idOf(item: Element): string {
  return item.getAttribute(ITEM) ?? "";
}

function itemsOf(strip: HTMLElement, order: readonly string[]): HTMLElement[] {
  return [...strip.querySelectorAll<HTMLElement>(`[${ITEM}]`)].filter(
    (item) => item.closest(`[${STRIP}]`) === strip && order.includes(idOf(item)),
  );
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function ownItem(strip: HTMLElement | null, target: HTMLElement, order: readonly string[]): HTMLElement | null {
  const own = target.closest<HTMLElement>(`[${ITEM}]`);
  return strip && own?.closest(`[${STRIP}]`) === strip && order.includes(idOf(own)) ? own : null;
}

function dropAt(strip: HTMLElement, own: HTMLElement, order: readonly string[], x: number): StripDrop {
  const others = itemsOf(strip, order)
    .filter((item) => item !== own)
    .map((item) => item.getBoundingClientRect());
  const slot = slotAlong(others, x, "x");
  const box = own.getBoundingClientRect();
  const area = strip.getBoundingClientRect();
  const before = others[slot - 1];
  const after = others[slot];
  let gap = box.left + box.width / 2;
  if (before && after) gap = (before.right + after.left) / 2;
  else if (after) gap = after.left;
  else if (before) gap = before.right;
  const span = Math.max(strip.scrollWidth, area.width);
  const left = Math.max(0, Math.min(gap - area.left + strip.scrollLeft - box.width / 2, span - box.width));
  return { id: idOf(own), slot, left, top: box.top - area.top + strip.scrollTop, width: box.width, height: box.height };
}

export function useStripReorder(order: readonly string[], onReorder: (next: string[]) => void): StripReorder {
  const stripRef = useRef<HTMLDivElement>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const cleanup = useRef<(() => void) | null>(null);
  const refocus = useRef<HTMLElement | null>(null);
  const [drop, setDrop] = useState<StripDrop | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  useEffect(() => {
    const element = refocus.current;
    refocus.current = null;
    if (element?.isConnected && element !== document.activeElement) element.focus();
  });

  const begin = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const strip = stripRef.current;
    if (event.button !== 0 || !strip) return;
    if (event.target instanceof Element && event.target.closest(TEXT_ENTRY)) return;
    const own = ownItem(strip, event.currentTarget, orderRef.current);
    if (!own) return;
    const id = idOf(own);
    cleanup.current?.();
    cleanup.current = trackReorderDrag<StripDrop>(event, {
      axis: "x",
      locate: (x) => dropAt(strip, own, orderRef.current, x),
      show: setDrop,
      land: (landed) => {
        const current = orderRef.current;
        const visible = itemsOf(strip, current).map(idOf);
        const next = placeAmong(current, visible, id, landed.slot);
        if (!sameOrder(next, current)) onReorderRef.current(next);
      },
    });
  }, []);

  const step = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    if (event.target instanceof Element && event.target.closest(TEXT_ENTRY)) return;
    const strip = stripRef.current;
    const own = ownItem(strip, event.currentTarget, orderRef.current);
    if (!strip || !own) return;
    event.preventDefault();
    const id = idOf(own);
    const current = orderRef.current;
    const visible = itemsOf(strip, current).map(idOf);
    const slot = visible.indexOf(id) + (event.key === "ArrowLeft" ? -1 : 1);
    if (slot < 0 || slot >= visible.length) return;
    const focused = document.activeElement;
    refocus.current = focused instanceof HTMLElement && own.contains(focused) ? focused : null;
    onReorderRef.current(placeAmong(current, visible, id, slot));
  }, []);

  const item = useCallback(
    (id: string): StripItemProps => ({ "data-reorder-item": id, onPointerDown: begin, onKeyDown: step }),
    [begin, step],
  );

  return useMemo<StripReorder>(
    () => ({
      dragging: drop?.id ?? null,
      strip: { ref: stripRef, "data-reorder-strip": "" },
      item,
      indicator: drop ? (
        <div
          aria-hidden
          data-reorder-drop={drop.slot}
          className="pointer-events-none absolute z-30 rounded-md border border-primary/60 bg-primary/10 transition-[left] duration-100 motion-reduce:transition-none"
          style={{ left: drop.left, top: drop.top, width: drop.width, height: drop.height }}
        />
      ) : null,
    }),
    [item, drop],
  );
}
