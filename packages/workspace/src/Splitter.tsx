import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { trackPointerDrag } from "./drag";
import { BIG_KEY_STEP, KEY_STEP } from "./geometry";

export interface SplitterProps {
  vertical: boolean;
  label: string;
  value: number;
  className: string;
  attributes: Readonly<Record<string, string>>;
  size: (element: HTMLElement) => number;
  onShift: (delta: number, size: number) => void;
  onEven: () => void;
  onResizing: (active: boolean, cancelled?: boolean) => void;
}

const FULL_RANGE = 1;
const PAGE_AND_END_KEYS: ReadonlyMap<string, number> = new Map([
  ["PageUp", BIG_KEY_STEP],
  ["PageDown", -BIG_KEY_STEP],
  ["Home", -FULL_RANGE],
  ["End", FULL_RANGE],
]);

function keyShift(key: string, vertical: boolean, big: boolean): number | null {
  const step = big ? BIG_KEY_STEP : KEY_STEP;
  if (key === (vertical ? "ArrowLeft" : "ArrowUp")) return -step;
  if (key === (vertical ? "ArrowRight" : "ArrowDown")) return step;
  return PAGE_AND_END_KEYS.get(key) ?? null;
}

function release(stop: RefObject<(() => void) | null>): void {
  const current = stop.current;
  stop.current = null;
  current?.();
}

export function Splitter({ vertical, label, value, className, attributes, size, onShift, onEven, onResizing }: Readonly<SplitterProps>) {
  const stopResize = useRef<(() => void) | null>(null);
  useEffect(() => () => release(stopResize), []);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const extent = size(event.currentTarget);
    if (extent <= 0) return;
    release(stopResize);
    let last = vertical ? event.clientX : event.clientY;
    stopResize.current = trackPointerDrag(event, {
      axis: vertical ? "x" : "y",
      perFrame: true,
      start: () => onResizing(true),
      move(point) {
        const position = vertical ? point.clientX : point.clientY;
        onShift((position - last) / extent, extent);
        last = position;
      },
      end(dropped) {
        const live = stopResize.current !== null;
        stopResize.current = null;
        onResizing(false, live && !dropped);
      },
    });
  };

  return (
    <div
      {...attributes}
      role="slider"
      aria-label={label}
      aria-orientation={vertical ? "horizontal" : "vertical"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={startResize}
      onDoubleClick={onEven}
      onKeyDown={(event) => {
        const delta = keyShift(event.key, vertical, event.shiftKey);
        if (delta === null) return;
        event.preventDefault();
        onShift(delta, size(event.currentTarget));
      }}
      className={className}
    />
  );
}
