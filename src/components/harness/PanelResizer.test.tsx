// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PanelResizer } from "./PanelResizer";

function setup() {
  const onResize = vi.fn();
  const onReset = vi.fn();
  const utils = render(
    <PanelResizer
      width={400}
      minWidth={320}
      maxWidth={768}
      onResize={onResize}
      onReset={onReset}
      label="Resize the utility panel"
    />,
  );
  return { ...utils, onResize, onReset };
}

describe("PanelResizer", () => {
  it("renders as an accessible vertical separator", () => {
    const { getByRole } = setup();
    const handle = getByRole("separator");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
  });

  it("reports a clamped width while dragging, relative to the drag start", () => {
    const { getByTestId, onResize } = setup();
    const handle = getByTestId("harness-panel-resizer");

    fireEvent.pointerDown(handle, { button: 0, clientX: 600, pointerId: 1 });
    // Dragged 100px left of the start → right panel grows by 100.
    fireEvent.pointerMove(handle, { clientX: 500, pointerId: 1 });
    expect(onResize).toHaveBeenLastCalledWith(500);
    // Dragged far left → clamped to the maximum.
    fireEvent.pointerMove(handle, { clientX: -400, pointerId: 1 });
    expect(onResize).toHaveBeenLastCalledWith(768);
    // Dragged right of the start → clamped to the minimum.
    fireEvent.pointerMove(handle, { clientX: 1000, pointerId: 1 });
    expect(onResize).toHaveBeenLastCalledWith(320);
    fireEvent.pointerUp(handle, { pointerId: 1 });
  });

  it("grows a left-side panel when dragged rightward", () => {
    const onResize = vi.fn();
    const onReset = vi.fn();
    render(
      <PanelResizer
        width={300}
        minWidth={224}
        maxWidth={480}
        onResize={onResize}
        onReset={onReset}
        label="Resize the sidebar"
        side="left"
        testId="sidebar-resizer"
      />,
    );
    const handle = screen.getByTestId("sidebar-resizer");
    fireEvent.pointerDown(handle, { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 380, pointerId: 1 });
    expect(onResize).toHaveBeenLastCalledWith(380);
    fireEvent.pointerMove(handle, { clientX: 100, pointerId: 1 });
    expect(onResize).toHaveBeenLastCalledWith(224);
    fireEvent.pointerUp(handle, { pointerId: 1 });
  });

  it("ignores non-primary buttons", () => {
    const { getByTestId, onResize } = setup();
    const handle = getByTestId("harness-panel-resizer");
    fireEvent.pointerDown(handle, { button: 2, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 50, pointerId: 1 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("resizes by keyboard steps and resets on Enter", () => {
    const { getByRole, onResize, onReset } = setup();
    const handle = getByRole("separator");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onResize).toHaveBeenLastCalledWith(416);
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    expect(onResize).toHaveBeenLastCalledWith(336);
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("resets on double click", () => {
    const { getByTestId, onReset } = setup();
    fireEvent.dblClick(getByTestId("harness-panel-resizer"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
