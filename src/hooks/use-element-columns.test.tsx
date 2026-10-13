// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { columnsFor, useElementColumns } from "./use-element-columns";

function Grid({ fallback = 4 }: Readonly<{ fallback?: number }>) {
  const ref = useRef<HTMLDivElement>(null);
  const columns = useElementColumns(ref, 9, 0.75, fallback);
  return (
    <div ref={ref} data-testid="grid">
      {columns}
    </div>
  );
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
