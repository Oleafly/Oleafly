import { act } from "@testing-library/react";
import { vi } from "vitest";

export interface ScrollGeometry {
  scrollTo: (scroller: HTMLElement, top: number) => void;
  flushFrames: () => void;
  pendingFrames: () => number;
  restore: () => void;
}

export interface ScrollGeometryOptions {
  isScroller: (element: Element) => boolean;
  contentHeight: (scroller: Element) => number;
  viewportHeight: number;
  rowHeight?: number;
}

export function paddedListHeight(list: Element | null | undefined, rowHeight: number): number {
  if (!(list instanceof HTMLElement)) return 0;
  return (
    (Number.parseFloat(list.style.paddingTop) || 0) +
    (Number.parseFloat(list.style.paddingBottom) || 0) +
    list.children.length * rowHeight
  );
}

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 100,
    width: 100,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

export function installScrollGeometry({
  isScroller,
  contentHeight,
  viewportHeight,
  rowHeight = 0,
}: ScrollGeometryOptions): ScrollGeometry {
  const style = document.createElement("style");
  style.textContent = ".overflow-auto, .overflow-y-auto { overflow-y: auto; }";
  document.head.appendChild(style);
  const tops = new WeakMap<Element, number>();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const maxTop = (element: Element) => Math.max(0, contentHeight(element) - viewportHeight);
  const closestScroller = (element: Element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (isScroller(node)) return node;
    }
    return null;
  };
  const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    nextFrame += 1;
    frames.set(nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (
    this: Element,
  ) {
    return isScroller(this) ? viewportHeight : 0;
  });
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (
    this: Element,
  ) {
    return isScroller(this) ? contentHeight(this) : 0;
  });
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) {
      return tops.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      tops.set(this, Math.min(Math.max(0, value), isScroller(this) ? maxTop(this) : 0));
    },
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    if (this.hasAttribute("data-row-window-item")) return rect(0, rowHeight);
    if (isScroller(this)) return rect(0, viewportHeight);
    const scroller = closestScroller(this);
    return rect(-(scroller ? (tops.get(scroller) ?? 0) : 0), 0);
  });
  const flushFrames = () => {
    act(() => {
      const due = [...frames.values()];
      frames.clear();
      for (const frame of due) frame(0);
    });
  };
  return {
    scrollTo(scroller, top) {
      scroller.scrollTop = top;
      act(() => {
        scroller.dispatchEvent(new Event("scroll"));
      });
      flushFrames();
    },
    flushFrames,
    pendingFrames: () => frames.size,
    restore() {
      style.remove();
      if (original) Object.defineProperty(Element.prototype, "scrollTop", original);
      vi.restoreAllMocks();
    },
  };
}
