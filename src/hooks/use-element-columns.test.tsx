// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { columnsFor, gridTrackCount, useElementColumns, useGridTracks } from "./use-element-columns";

function Grid({ fallback = 4 }: Readonly<{ fallback?: number }>) {
  const ref = useRef<HTMLDivElement>(null);
  const columns = useElementColumns(ref, 9, 0.75, fallback);
  return (
    <div ref={ref} data-testid="grid">
      {columns}
    </div>
  );
}

function Tracks({ attach = true }: Readonly<{ attach?: boolean }>) {
  const ref = useRef<HTMLDivElement>(null);
  const tracks = useGridTracks(ref, 3);
  return (
    <div ref={attach ? ref : undefined} data-testid="tracks">
      {tracks}
    </div>
  );
}

function stubTracks(value: () => string) {
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element, pseudo?: string | null) => {
    const style = computed(element, pseudo);
    Object.defineProperty(style, "gridTemplateColumns", { configurable: true, value: value() });
    return style;
  });
}

function captureResize(): { fire: () => void; disconnected: () => boolean } {
  let callback: (() => void) | null = null;
  let disconnected = false;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(next: () => void) {
        callback = next;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
  );
  return {
    fire: () => act(() => callback?.()),
    disconnected: () => disconnected,
  };
}

describe("columnsFor", () => {
  it("fits as many minimum-width cards as the width allows, never fewer than one", () => {
    expect(columnsFor(780, 9, 0.75, 16)).toBe(5);
    expect(columnsFor(780, 9, 0.75, 20)).toBe(4);
    expect(columnsFor(100, 9, 0.75, 16)).toBe(1);
  });
});

describe("useElementColumns", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the fallback until the element has a width", () => {
    const view = render(<Grid fallback={3} />);
    expect(view.getByTestId("grid")).toHaveTextContent("3");
  });

  it("follows the element width and the root font size as it resizes", () => {
    let width = 780;
    let resize: () => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {
          disconnect();
        }
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
    document.documentElement.style.fontSize = "20px";
    const view = render(<Grid />);
    expect(view.getByTestId("grid")).toHaveTextContent("4");

    width = 300;
    act(() => resize());
    expect(view.getByTestId("grid")).toHaveTextContent("1");
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    document.documentElement.style.fontSize = "";
  });

  it("measures once when the platform has no resize observer", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => 780);
    const view = render(<Grid />);
    expect(view.getByTestId("grid")).toHaveTextContent("5");
  });
});

describe("gridTrackCount", () => {
  it("counts the resolved column tracks", () => {
    expect(gridTrackCount("200px 200px 200px")).toBe(3);
    expect(gridTrackCount("212.5px")).toBe(1);
  });

  it("finds no tracks in an unresolved or empty value", () => {
    expect(gridTrackCount("repeat(auto-fill, minmax(12.5rem, 1fr))")).toBe(0);
    expect(gridTrackCount("repeat(2, 100px 100px)")).toBe(0);
    expect(gridTrackCount("none")).toBe(0);
    expect(gridTrackCount("")).toBe(0);
  });
});

describe("useGridTracks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads the grid's columns and follows them when the grid resizes", () => {
    let value = "100px 100px 100px 100px";
    stubTracks(() => value);
    const resize = captureResize();
    const view = render(<Tracks />);
    expect(view.getByTestId("tracks")).toHaveTextContent("4");
    value = "150px 150px";
    resize.fire();
    expect(view.getByTestId("tracks")).toHaveTextContent("2");
    view.unmount();
    expect(resize.disconnected()).toBe(true);
  });

  it("keeps the fallback until the grid has resolved columns", () => {
    let value = "";
    stubTracks(() => value);
    const resize = captureResize();
    const view = render(<Tracks />);
    expect(view.getByTestId("tracks")).toHaveTextContent("3");
    value = "repeat(2, 100px 100px)";
    resize.fire();
    expect(view.getByTestId("tracks")).toHaveTextContent("3");
  });

  it("keeps the fallback when nothing is attached", () => {
    const view = render(<Tracks attach={false} />);
    expect(view.getByTestId("tracks")).toHaveTextContent("3");
  });

  it("reads the grid once when the platform has no resize observer", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    stubTracks(() => "100px 100px");
    const view = render(<Tracks />);
    expect(view.getByTestId("tracks")).toHaveTextContent("2");
  });
});
