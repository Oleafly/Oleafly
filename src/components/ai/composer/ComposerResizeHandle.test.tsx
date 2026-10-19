// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/ai.json" with { type: "json" };
import { ComposerResizeHandle } from "./ComposerResizeHandle";

function renderHandle(height = 56) {
  const props = {
    height,
    min: 56,
    max: 480,
    onPreview: vi.fn(),
    onCommit: vi.fn(),
    onReset: vi.fn(),
  };
  render(<ComposerResizeHandle {...props} />);
  return { props, handle: screen.getByRole("separator", { name: en.composer.resizeHandle }) };
}

describe("ComposerResizeHandle", () => {
  it("grows by dragging the top edge up and saves on release", () => {
    const { props, handle } = renderHandle();
    fireEvent.pointerDown(handle, { button: 0, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 440, pointerId: 1 });
    expect(props.onPreview).toHaveBeenCalledWith(116);
    fireEvent.pointerUp(handle, { clientY: 440, pointerId: 1 });
    expect(props.onCommit).toHaveBeenCalledWith(116);
  });

  it("moves one line per arrow key and resets on double-click", () => {
    const { props, handle } = renderHandle(100);
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(props.onCommit).toHaveBeenLastCalledWith(120);
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(props.onCommit).toHaveBeenLastCalledWith(80);
    fireEvent.doubleClick(handle);
    expect(props.onReset).toHaveBeenCalledOnce();
  });

  it("never goes past its bounds", () => {
    const { props, handle } = renderHandle();
    fireEvent.pointerDown(handle, { button: 0, clientY: 900, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(props.onCommit).toHaveBeenLastCalledWith(480);
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(props.onCommit).toHaveBeenLastCalledWith(56);
  });

  it("exposes its value to assistive technology", () => {
    const { handle } = renderHandle(120);
    expect(handle).toHaveAttribute("aria-orientation", "horizontal");
    expect(handle).toHaveAttribute("aria-valuenow", "120");
    expect(handle).toHaveAttribute("aria-valuemin", "56");
    expect(handle).toHaveAttribute("aria-valuemax", "480");
    expect(handle).toHaveAttribute("tabindex", "0");
  });
});
