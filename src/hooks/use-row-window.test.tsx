// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { type RefObject, StrictMode, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UNMEASURED_ROW_COUNT,
  rowRange,
  useRowWindow,
} from "./use-row-window";

describe("rowRange", () => {
  it("covers the rows in the viewport plus the overscan on both sides", () => {
    expect(rowRange(1_000, 20, 400, 200, 5)).toEqual({ start: 15, end: 35 });
  });

  it("starts at the first row when the list begins inside the viewport", () => {
    expect(rowRange(1_000, 20, -150, 200, 5)).toEqual({ start: 0, end: 15 });
  });

  it("never runs past the end of the list", () => {
    expect(rowRange(30, 20, 560, 200, 5)).toEqual({ start: 23, end: 30 });
  });

  it("keeps a row in range when the list is scrolled entirely above the viewport", () => {
    expect(rowRange(30, 20, 5_000, 200, 5)).toEqual({ start: 25, end: 30 });
  });

  it("renders a bounded first page before anything has been measured", () => {
    expect(rowRange(5_000, 0, 0, 0, 5)).toEqual({
      start: 0,
      end: UNMEASURED_ROW_COUNT,
    });
    expect(rowRange(12, 0, 0, 0, 5)).toEqual({ start: 0, end: 12 });
  });

  it("uses a smaller unmeasured first page when the caller asks for one", () => {
    expect(rowRange(5_000, 0, 0, 0, 5, 6)).toEqual({ start: 0, end: 6 });
    expect(rowRange(4, 0, 0, 0, 5, 6)).toEqual({ start: 0, end: 4 });
  });

  it("is empty for an empty list", () => {
    expect(rowRange(0, 20, 0, 200, 5)).toEqual({ start: 0, end: 0 });
  });
});

function Rows({ count, unmeasuredCount }: Readonly<{ count: number; unmeasuredCount?: number }>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useRowWindow({ count, scrollRef, listRef, unmeasuredCount });
  return (
    <div ref={scrollRef}>
      <div
        ref={listRef}
        style={{ paddingTop: rows.paddingTop, paddingBottom: rows.paddingBottom }}
      >
        {Array.from({ length: rows.end - rows.start }, (_, offset) => {
          const index = rows.start + offset;
          return (
            <div key={index} data-row-window-item>
              {`row ${index}`}
            </div>
          );
        })}
      </div>
    </div>
  );
}

describe("useRowWindow without layout", () => {
  it("renders every row of a short list", () => {
    const view = render(<Rows count={25} />);
    expect(view.getAllByText(/^row /)).toHaveLength(25);
  });

  it("bounds a long list to the unmeasured first page", () => {
    const view = render(<Rows count={4_000} />);
    expect(view.getAllByText(/^row /)).toHaveLength(UNMEASURED_ROW_COUNT);
  });

  it("bounds a long list to the first page the caller chose", () => {
    const view = render(<Rows count={4_000} unmeasuredCount={6} />);
    expect(view.getAllByText(/^row /)).toHaveLength(6);
  });

  it("follows the list when it grows", () => {
    const view = render(<Rows count={3} />);
    view.rerender(<Rows count={30} />);
    expect(view.getAllByText(/^row /)).toHaveLength(30);
  });

  it("follows the list when it shrinks", () => {
    const view = render(<Rows count={4_000} />);
    view.rerender(<Rows count={3} />);
    expect(view.getAllByText(/^row /)).toHaveLength(3);
  });
});

function WindowedList({
  count,
  scrollRef,
}: Readonly<{ count: number; scrollRef: RefObject<HTMLDivElement | null> }>) {
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useRowWindow({ count, scrollRef, listRef });
  return (
    <div
      ref={listRef}
      data-testid="list"
      style={{ paddingTop: rows.paddingTop, paddingBottom: rows.paddingBottom }}
    >
      {Array.from({ length: rows.end - rows.start }, (_, offset) => {
        const index = rows.start + offset;
        return (
          <div key={index} data-row-window-item>
            {`row ${index}`}
          </div>
        );
      })}
    </div>
  );
}

function ScrolledRows({
  count,
  overflow = "auto",
}: Readonly<{ count: number; overflow?: "auto" | "visible" }>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollRef} data-testid="scroller" style={{ overflowY: overflow }}>
      <section>
        <WindowedList count={count} scrollRef={scrollRef} />
      </section>
    </div>
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

function laidOutRows(rowHeight: number, viewportHeight: number) {
  let scrollTop = 0;
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (
    this: Element,
  ) {
    return this.getAttribute("data-testid") === "scroller" ? viewportHeight : 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (
    this: Element,
  ) {
    return this.getAttribute("data-testid") === "scroller" ? scrollTop : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    if (this.hasAttribute("data-row-window-item")) return rect(0, rowHeight);
    if (this.getAttribute("data-testid") === "list") return rect(-scrollTop, 0);
    return rect(0, viewportHeight);
  });
  return {
    scrollTo(scroller: HTMLElement, top: number) {
      scrollTop = top;
      act(() => {
        scroller.dispatchEvent(new Event("scroll"));
        for (const frame of frames.splice(0)) frame(0);
      });
    },
    scrollWithoutFrames(scroller: HTMLElement, top: number) {
      scrollTop = top;
      frames.splice(0);
      scroller.dispatchEvent(new Event("scroll"));
      return frames.length;
    },
  };
}

describe("useRowWindow with layout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("measures and follows scrolling when a parent's scroller mounts in the same render as the list", () => {
    const layout = laidOutRows(20, 200);
    const view = render(<ScrolledRows count={1_000} />);
    expect(view.getAllByText(/^row /)).toHaveLength(22);

    layout.scrollTo(view.getByTestId("scroller"), 4_000);

    expect(view.getByText("row 200")).toBeTruthy();
    expect(view.queryByText("row 0")).toBeNull();
    const list = view.getByTestId("list");
    expect(list.style.paddingTop).toBe("3760px");
    expect(list.style.paddingBottom).toBe("15560px");
  });

  it("keeps following scrolling under StrictMode", () => {
    const layout = laidOutRows(20, 200);
    const view = render(
      <StrictMode>
        <ScrolledRows count={1_000} />
      </StrictMode>,
    );
    expect(view.getAllByText(/^row /)).toHaveLength(22);

    layout.scrollTo(view.getByTestId("scroller"), 4_000);

    expect(view.getByText("row 200")).toBeTruthy();
  });

  it("subscribes to the scroller ref once it is attached when the DOM cannot reveal it", () => {
    const layout = laidOutRows(20, 200);
    const view = render(<ScrolledRows count={1_000} overflow="visible" />);
    view.rerender(<ScrolledRows count={1_000} overflow="visible" />);
    expect(view.getAllByText(/^row /)).toHaveLength(22);

    layout.scrollTo(view.getByTestId("scroller"), 4_000);

    expect(view.getByText("row 200")).toBeTruthy();
  });

  it("renders the rows for a new scroll position inside the scroll event, before the next frame", () => {
    const layout = laidOutRows(20, 200);
    const view = render(<ScrolledRows count={1_000} />);
    const scroller = view.getByTestId("scroller");

    const scheduled = layout.scrollWithoutFrames(scroller, 4_000);

    expect(view.getByText("row 200")).toBeTruthy();
    expect(view.queryByText("row 0")).toBeNull();
    expect(scheduled).toBe(0);
  });
});
