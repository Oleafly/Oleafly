import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
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
  onResizing: (active: boolean) => void;
}

export function Splitter({ vertical, label, value, className, attributes, size, onShift, onEven, onResizing }: Readonly<SplitterProps>) {
  const stopResize = useRef<(() => void) | null>(null);
  useEffect(() => () => stopResize.current?.(), []);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const extent = size(event.currentTarget);
    if (extent <= 0) return;
    onResizing(true);
    let last = vertical ? event.clientX : event.clientY;
    let frame = 0;
    let pending = 0;
    const move = (moveEvent: PointerEvent) => {
      const position = vertical ? moveEvent.clientX : moveEvent.clientY;
      pending += (position - last) / extent;
      last = position;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const delta = pending;
        pending = 0;
        onShift(delta, extent);
      });
    };
    const up = () => {
      stopResize.current = null;
      cancelAnimationFrame(frame);
      if (pending !== 0) onShift(pending, extent);
      onResizing(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", up);
    stopResize.current = up;
  };

  return (
    <div
      {...attributes}
      role="separator"
      aria-label={label}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={startResize}
      onDoubleClick={onEven}
      onKeyDown={(event) => {
        const back = vertical ? "ArrowLeft" : "ArrowUp";
        const forward = vertical ? "ArrowRight" : "ArrowDown";
        if (event.key !== back && event.key !== forward) return;
        event.preventDefault();
        const step = event.shiftKey ? BIG_KEY_STEP : KEY_STEP;
        onShift(event.key === forward ? step : -step, size(event.currentTarget));
      }}
      className={className}
    />
  );
}
