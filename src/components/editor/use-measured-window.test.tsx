// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { type RefObject, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEASURED_WINDOW_ITEM,
  UNMEASURED_ITEM_COUNT,
  measuredRange,
  measuredSizes,
  prefixSums,
  useMeasuredWindow,
} from "./use-measured-window";

function measuredOffsets(keys: readonly string[], heights: ReadonlyMap<string, number>, estimate: () => number) {
  return prefixSums(measuredSizes(keys, heights, estimate));
}

describe("measured offsets and ranges", () => {
  it("adds up measured heights and estimates", () => {
    const offsets = measuredOffsets(["a", "b", "c"], new Map([["b", 50]]), () => 20);
    expect([...offsets]).toEqual([0, 20, 70, 90]);
  });

  it("covers the viewport with the items that intersect it", () => {
    const offsets = measuredOffsets(
      Array.from({ length: 100 }, (_, index) => String(index)),
      new Map(),
      () => 10,
    );
    expect(measuredRange(offsets, 95, 205)).toEqual({ start: 9, end: 21 });
    expect(measuredRange(offsets, -50, 20)).toEqual({ start: 0, end: 2 });
    expect(measuredRange(offsets, 5_000, 6_000)).toEqual({ start: 99, end: 100 });
    expect(measuredRange(measuredOffsets([], new Map(), () => 10), 0, 100)).toEqual({ start: 0, end: 0 });
  });
});

type Layout = { scrollTop: number; clientHeight: number; heights: (index: number) => number; listTop: number };

function List({ count, estimate = 20, overscan = 0 }: Readonly<{ count: number; estimate?: number; overscan?: number }>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const keys = Array.from({ length: count }, (_, index) => `item-${index}`);
  const window = useMeasuredWindow({ keys, estimate: () => estimate, scrollRef, listRef, overscan });
  return (
    <div ref={scrollRef} data-testid="scroller">
      <div ref={listRef} data-testid="list" style={{ paddingTop: window.paddingTop, paddingBottom: window.paddingBottom }}>
        {Array.from({ length: window.end - window.start }, (_, offset) => {
          const index = window.start + offset;
          return (
            <div key={keys[index]} {...{ [MEASURED_WINDOW_ITEM]: index }}>
              {`item ${index}`}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChildList({
  count,
  scrollRef,
}: Readonly<{ count: number; scrollRef: RefObject<HTMLDivElement | null> }>) {
  const listRef = useRef<HTMLDivElement>(null);
  const keys = Array.from({ length: count }, (_, index) => `item-${index}`);
  const window = useMeasuredWindow({ keys, estimate: () => 20, scrollRef, listRef, overscan: 0 });
  return (
    <div ref={listRef} data-testid="list" style={{ paddingTop: window.paddingTop, paddingBottom: window.paddingBottom }}>
      {Array.from({ length: window.end - window.start }, (_, offset) => {
        const index = window.start + offset;
        return (
          <div key={keys[index]} {...{ [MEASURED_WINDOW_ITEM]: index }}>
            {`item ${index}`}
          </div>
        );
      })}
    </div>
  );
}

function ParentScroller({ count }: Readonly<{ count: number }>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollRef} data-testid="scroller" style={{ overflowY: "auto" }}>
      <ChildList count={count} scrollRef={scrollRef} />
    </div>
  );
}

function installLayout(layout: Layout) {
  const original = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const element = this as HTMLElement;
    const rect = (top: number, height: number) =>
      ({ top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    if (element.dataset.testid === "scroller") return rect(0, layout.clientHeight);
    const list = element.closest<HTMLElement>("[data-testid=list]");
    if (element.dataset.testid === "list") return rect(layout.listTop - layout.scrollTop, 0);
    const index = element.getAttribute(MEASURED_WINDOW_ITEM);
    if (list && index !== null) {
      const items = [...list.querySelectorAll<HTMLElement>(`[${MEASURED_WINDOW_ITEM}]`)];
      const first = Number(items[0]?.getAttribute(MEASURED_WINDOW_ITEM) ?? 0);
      let top = layout.listTop - layout.scrollTop + Number.parseFloat(list.style.paddingTop || "0");
      for (let at = first; at < Number(index); at++) top += layout.heights(at);
      return rect(top, layout.heights(Number(index)));
    }
    return original.call(this);
  });
}

function attachScroller(layout: Layout) {
  const scroller = document.querySelector<HTMLElement>("[data-testid=scroller]") as HTMLElement;
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, get: () => layout.clientHeight },
    scrollTop: {
      configurable: true,
      get: () => layout.scrollTop,
      set: (value: number) => {
        layout.scrollTop = value;
      },
    },
  });
  return scroller;
}

function rendered(): number[] {
  return [...document.querySelectorAll(`[${MEASURED_WINDOW_ITEM}]`)].map((node) =>
    Number(node.getAttribute(MEASURED_WINDOW_ITEM)),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useMeasuredWindow", () => {
  it("renders a bounded first page before anything can be measured", () => {
    render(<List count={5_000} />);
    expect(rendered()).toHaveLength(UNMEASURED_ITEM_COUNT);
    expect(rendered()[0]).toBe(0);
  });

  it("renders a short list completely", () => {
    render(<List count={7} />);
    expect(rendered()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("renders the items in view after a scroll, using measured heights", () => {
    const layout: Layout = { scrollTop: 0, clientHeight: 200, heights: (index) => (index % 2 ? 50 : 30), listTop: 0 };
    installLayout(layout);
    const view = render(<List count={1_000} />);
    const scroller = attachScroller(layout);
    view.rerender(<List count={1_000} />);
    expect(rendered()[0]).toBe(0);
    expect(rendered().length).toBeLessThan(20);

    act(() => {
      layout.scrollTop = 8_000;
      scroller.dispatchEvent(new Event("scroll"));
    });
    const items = rendered();
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(40);
    const list = document.querySelector<HTMLElement>("[data-testid=list]") as HTMLElement;
    const top = Number.parseFloat(list.style.paddingTop);
    expect(top).toBeLessThanOrEqual(layout.scrollTop);
    let bottom = top;
    for (const index of items) bottom += layout.heights(index);
    expect(bottom).toBeGreaterThanOrEqual(layout.scrollTop + layout.clientHeight);
  });

  it("keeps the item at the top of the view in place when items above it measure taller than estimated", () => {
    const layout: Layout = { scrollTop: 0, clientHeight: 200, heights: () => 40, listTop: 0 };
    installLayout(layout);
    render(<List count={1_000} estimate={20} overscan={100} />);
    const scroller = attachScroller(layout);
    act(() => {
      layout.scrollTop = 4_000;
      scroller.dispatchEvent(new Event("scroll"));
    });
    const list = document.querySelector<HTMLElement>("[data-testid=list]") as HTMLElement;
    let top = Number.parseFloat(list.style.paddingTop);
    for (const index of rendered()) {
      if (index === 200) break;
      top += layout.heights(index);
    }
    expect(rendered()).toContain(200);
    expect(rendered()[0]).toBeLessThan(200);
    expect(Math.abs(top - layout.scrollTop)).toBeLessThan(1);
  });

  it("follows a scroller that belongs to a parent component", () => {
    const layout: Layout = { scrollTop: 0, clientHeight: 200, heights: () => 20, listTop: 0 };
    installLayout(layout);
    const clientHeight = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === "scroller" ? layout.clientHeight : 0;
    });
    render(<ParentScroller count={1_000} />);
    const scroller = attachScroller(layout);
    act(() => {
      layout.scrollTop = 10_000;
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(rendered()).toContain(500);
    clientHeight.mockRestore();
  });

  it("moves the window when content above the list changes height", () => {
    const callbacks: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          callbacks.push(callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const layout: Layout = { scrollTop: 0, clientHeight: 200, heights: () => 20, listTop: 0 };
    installLayout(layout);
    const clientHeight = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === "scroller" ? layout.clientHeight : 0;
    });
    render(<ParentScroller count={1_000} />);
    const scroller = attachScroller(layout);
    act(() => {
      layout.scrollTop = 4_000;
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(rendered()).toContain(200);
    act(() => {
      layout.listTop = -3_000;
      for (const callback of callbacks) callback();
    });
    expect(rendered()).toContain(350);
    clientHeight.mockRestore();
    vi.unstubAllGlobals();
  });
});
