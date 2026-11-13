// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CustomNumberInput } from "./CustomNumberInput";

const RANGE = { min: 1, max: 3, step: 0.1 };
const clamp = (value: number) => Math.min(3, Math.max(1, value));

function setup(value = 2) {
  const onCommit = vi.fn();
  const view = render(
    <CustomNumberInput value={value} onCommit={onCommit} range={RANGE} clamp={clamp} ariaLabel="Size" testId="size" />,
  );
  return { onCommit, view, input: screen.getByRole("spinbutton", { name: "Size" }) };
}

describe("CustomNumberInput", () => {
  it("commits a typed value inside the range right away", () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: "2.5" } });
    expect(onCommit).toHaveBeenCalledWith(2.5);
    fireEvent.change(input, { target: { value: "9" } });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("clamps on blur and on Enter, and keeps the value for empty text", () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(3);
    expect(input).toHaveValue(3);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(input, { key: "a" });
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it("ignores the Enter that confirms an IME composition", () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenLastCalledWith(3);
  });

  it("shows a value changed from outside", () => {
    const { view, input } = setup();
    view.rerender(
      <CustomNumberInput value={1.5} onCommit={vi.fn()} range={RANGE} clamp={clamp} ariaLabel="Size" testId="size" />,
    );
    expect(input).toHaveValue(1.5);
  });
});
