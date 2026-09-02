// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useModalAccessibility } from "./use-modal-accessibility";

function Dialog({ onClose }: { onClose: () => void }) {
  const { dialogRef } = useModalAccessibility<HTMLDivElement>(true, onClose);
  return (
    <div role="dialog" ref={dialogRef} tabIndex={-1}>
      <input aria-label="Inner editor" data-modal-escape-inner="" />
      <button type="button">Other</button>
    </div>
  );
}

describe("useModalAccessibility Escape handling", () => {
  it("leaves Escape to an inner editor and still closes from elsewhere", () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Inner editor" }), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("button", { name: "Other" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
