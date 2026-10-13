// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boxBetween, boxesOverlap, edgeScrollStep, useMarqueeSelection } from "./marquee-selection";
import { useLibrarySelectionStore } from "@/store/library-selection";
import { isMac } from "@/lib/utils";

const RECTS: Record<string, { left: number; top: number; width: number; height: number }> = {
  scroller: { left: 0, top: 0, width: 800, height: 600 },
  a: { left: 100, top: 100, width: 80, height: 100 },
  b: { left: 400, top: 100, width: 80, height: 100 },
  c: { left: 120, top: 120, width: 40, height: 40 },
};

let frames: FrameRequestCallback[] = [];

function flush() {
  act(() => {
    for (const frame of frames.splice(0)) frame(0);
  });
}

function Harness({ enabled = true }: Readonly<{ enabled?: boolean }>) {
  const ref = useRef<HTMLDivElement>(null);
  useMarqueeSelection(ref, enabled);
  return (
    <div ref={ref} data-testid="scroller" data-rect="scroller">
      <div data-library-item="a" data-rect="a" />
      <div data-library-item="b" data-rect="b" />
      <div data-library-item="c" data-library-locked="" data-rect="c" />
      <p data-testid="empty" className="h-4" />
    </div>
  );
}

function pointer(type: "pointerDown" | "pointerMove" | "pointerUp", target: Element, x: number, y: number, extra = {}) {
  const buttons = type === "pointerUp" ? 0 : 1;
  fireEvent[type](target, { button: 0, buttons, pointerId: 1, clientX: x, clientY: y, ...extra });
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const rect = RECTS[(this as HTMLElement).dataset.rect ?? ""] ?? { left: 0, top: 0, width: 0, height: 0 };
    return { ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON: () => rect } as DOMRect;
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
  Element.prototype.releasePointerCapture = vi.fn();
  useLibrarySelectionStore.getState().clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("marquee geometry", () => {
  it("normalises boxes, tests overlap and scrolls near the edges", () => {
    expect(boxBetween(10, 50, 0, 5)).toEqual({ left: 0, top: 5, right: 10, bottom: 50 });
    const box = boxBetween(0, 0, 100, 100);
    expect(boxesOverlap(box, { left: 50, top: 50, right: 150, bottom: 150 })).toBe(true);
    expect(boxesOverlap(box, { left: 100, top: 0, right: 150, bottom: 50 })).toBe(false);
    expect(edgeScrollStep(300, 0, 600)).toBe(0);
    expect(edgeScrollStep(0, 0, 600)).toBe(-22);
    expect(edgeScrollStep(590, 0, 600)).toBeGreaterThan(0);
  });
});

describe("marquee selection", () => {
  it("selects the projects the box touches and skips locked ones", () => {
    render(<Harness />);
    const scroller = screen.getByTestId("scroller");
    pointer("pointerDown", screen.getByTestId("empty"), 50, 50);
    pointer("pointerMove", scroller, 52, 51);
    expect(document.querySelector('[data-testid="library-marquee"]')).toBeNull();
    pointer("pointerMove", scroller, 200, 220);
    flush();
    const box = document.querySelector<HTMLElement>('[data-testid="library-marquee"]');
    expect(box?.style.width).toBe("150px");
    expect(box?.style.transform).toBe("translate(50px, 50px)");
    expect([...useLibrarySelectionStore.getState().ids]).toEqual(["a"]);
    pointer("pointerMove", scroller, 500, 220);
    flush();
    expect([...useLibrarySelectionStore.getState().ids].sort()).toEqual(["a", "b"]);
    pointer("pointerUp", scroller, 500, 220);
    expect(document.querySelector('[data-testid="library-marquee"]')).toBeNull();
    expect([...useLibrarySelectionStore.getState().ids].sort()).toEqual(["a", "b"]);
  });

  it("adds to the selection with the modifier and clears it on a plain click", () => {
    useLibrarySelectionStore.getState().replace(new Set(["b"]));
    render(<Harness />);
    const scroller = screen.getByTestId("scroller");
    pointer("pointerDown", screen.getByTestId("empty"), 50, 50, isMac ? { metaKey: true } : { ctrlKey: true });
    pointer("pointerMove", scroller, 200, 220);
    flush();
    pointer("pointerUp", scroller, 200, 220);
    expect([...useLibrarySelectionStore.getState().ids].sort()).toEqual(["a", "b"]);
    pointer("pointerDown", screen.getByTestId("empty"), 50, 50);
    pointer("pointerUp", scroller, 50, 50);
    expect(useLibrarySelectionStore.getState().ids.size).toBe(0);
  });

  it("ignores presses on projects, other buttons and when disabled", () => {
    useLibrarySelectionStore.getState().replace(new Set(["b"]));
    const view = render(<Harness />);
    const item = document.querySelector('[data-library-item="a"]') as Element;
    pointer("pointerDown", item, 110, 110);
    pointer("pointerMove", item, 300, 300);
    flush();
    pointer("pointerUp", item, 300, 300);
    expect([...useLibrarySelectionStore.getState().ids]).toEqual(["b"]);
    view.rerender(<Harness enabled={false} />);
    pointer("pointerDown", screen.getByTestId("empty"), 50, 50);
    pointer("pointerUp", screen.getByTestId("scroller"), 50, 50);
    expect([...useLibrarySelectionStore.getState().ids]).toEqual(["b"]);
  });

  it("keeps scrolling while the pointer rests near an edge", () => {
    render(<Harness />);
    const scroller = screen.getByTestId("scroller");
    pointer("pointerDown", screen.getByTestId("empty"), 50, 300);
    pointer("pointerMove", scroller, 60, 595);
    flush();
    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(frames).toHaveLength(1);
    fireEvent.pointerCancel(scroller, { pointerId: 1 });
    expect(document.querySelector('[data-testid="library-marquee"]')).toBeNull();
  });

  it("keeps projects that scroll out of the window selected while the box still covers them", () => {
    render(<Harness />);
    const scroller = screen.getByTestId("scroller");
    pointer("pointerDown", screen.getByTestId("empty"), 50, 50);
    pointer("pointerMove", scroller, 500, 220);
    flush();
    expect([...useLibrarySelectionStore.getState().ids].sort()).toEqual(["a", "b"]);
    document.querySelector('[data-library-item="a"]')?.remove();
    pointer("pointerMove", scroller, 510, 230);
    flush();
    expect([...useLibrarySelectionStore.getState().ids].sort()).toEqual(["a", "b"]);
  });

  it("ends a drag whose release never arrived and cancels one on Escape", () => {
    useLibrarySelectionStore.getState().replace(new Set(["b"]));
    render(<Harness />);
    const scroller = screen.getByTestId("scroller");
    pointer("pointerDown", screen.getByTestId("empty"), 50, 50);
    pointer("pointerMove", scroller, 200, 220);
    flush();
    expect([...useLibrarySelectionStore.getState().ids]).toEqual(["a"]);
    fireEvent.pointerMove(scroller, { buttons: 0, pointerId: 1, clientX: 500, clientY: 220 });
    flush();
    expect(document.querySelector('[data-testid="library-marquee"]')).toBeNull();
    expect([...useLibrarySelectionStore.getState().ids]).toEqual(["a"]);

    useLibrarySelectionStore.getState().replace(new Set(["b"]));
    pointer("pointerDown", screen.getByTestId("empty"), 50, 50);
    pointer("pointerMove", scroller, 200, 220);
    flush();
    const cancel = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    window.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect([...useLibrarySelectionStore.getState().ids]).toEqual(["b"]);
    expect(document.querySelector('[data-testid="library-marquee"]')).toBeNull();

    pointer("pointerDown", screen.getByTestId("empty"), 50, 50);
    pointer("pointerMove", scroller, 200, 220);
    fireEvent(scroller, Object.assign(new Event("lostpointercapture"), { pointerId: 1 }));
    expect(document.querySelector('[data-testid="library-marquee"]')).toBeNull();
    const ignored = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    window.dispatchEvent(ignored);
    expect(ignored.defaultPrevented).toBe(false);
  });
});
