// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { startsWindowDrag, useWindowDragHoverGuard } from "./window-drag-guard";

function Harness({ enabled = true }: Readonly<{ enabled?: boolean }>) {
  const ref = useRef<HTMLDivElement>(null);
  useWindowDragHoverGuard(ref, enabled);
  return (
    <div>
      <header data-tauri-drag-region data-testid="header">
        <button type="button" data-testid="header-button" />
      </header>
      <div data-tauri-drag-region="false" data-testid="blocked" />
      <div ref={ref} data-testid="scroller" />
    </div>
  );
}

describe("window drag hover guard", () => {
  it("recognises presses that start a window drag", () => {
    render(<Harness />);
    expect(startsWindowDrag(screen.getByTestId("header"))).toBe(true);
    expect(startsWindowDrag(screen.getByTestId("header-button"))).toBe(false);
    expect(startsWindowDrag(screen.getByTestId("blocked"))).toBe(false);
    expect(startsWindowDrag(screen.getByTestId("scroller"))).toBe(false);
    expect(startsWindowDrag(null)).toBe(false);
  });

  it("stops the projects from reacting to the pointer until the drag ends", () => {
    render(<Harness />);
    const scroller = screen.getByTestId("scroller");
    fireEvent.mouseDown(screen.getByTestId("header"), { button: 0 });
    expect(scroller.style.pointerEvents).toBe("none");
    fireEvent.pointerMove(window, { buttons: 1 });
    expect(scroller.style.pointerEvents).toBe("none");
    fireEvent.pointerMove(window, { buttons: 0 });
    expect(scroller.style.pointerEvents).toBe("");

    for (const end of ["mouseUp", "keyDown", "wheel", "blur"] as const) {
      fireEvent.mouseDown(screen.getByTestId("header"), { button: 0 });
      expect(scroller.style.pointerEvents).toBe("none");
      fireEvent[end](window);
      expect(scroller.style.pointerEvents).toBe("");
    }
  });

  it("leaves other presses and a disabled guard alone", () => {
    const view = render(<Harness />);
    const scroller = screen.getByTestId("scroller");
    fireEvent.mouseDown(screen.getByTestId("header-button"), { button: 0 });
    fireEvent.mouseDown(screen.getByTestId("header"), { button: 2 });
    expect(scroller.style.pointerEvents).toBe("");
    view.rerender(<Harness enabled={false} />);
    fireEvent.mouseDown(screen.getByTestId("header"), { button: 0 });
    expect(scroller.style.pointerEvents).toBe("");
  });
});
