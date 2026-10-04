// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmationDialog } from "./confirmation-dialog";

function dialog(overrides: Partial<Parameters<typeof ConfirmationDialog>[0]> = {}) {
  const props = {
    open: true,
    title: "Discard changes?",
    description: "Your edits will be lost.",
    confirmLabel: "Discard",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<ConfirmationDialog {...props} />);
  return props;
}

describe("ConfirmationDialog", () => {
  it("shows its title and description and answers both buttons", () => {
    const props = dialog({ cancelLabel: "Keep editing" });

    expect(screen.getByRole("alertdialog", { name: "Discard changes?" })).toHaveAccessibleDescription(
      "Your edits will be lost.",
    );
    fireEvent.click(screen.getByRole("button", { name: /Keep editing/ }));
    fireEvent.click(screen.getByRole("button", { name: /Discard/ }));

    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("confirms with Enter when the action is not destructive", () => {
    const props = dialog();

    fireEvent.keyDown(document.body, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(document.body, { key: "Enter", metaKey: true });
    fireEvent.keyDown(document.body, { key: "a" });
    expect(props.onConfirm).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not confirm a destructive action with Enter", () => {
    const props = dialog({ destructive: true });

    fireEvent.keyDown(document.body, { key: "Enter" });

    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Discard" })).not.toHaveTextContent("↵");
  });

  it("renders nothing while closed", () => {
    const props = dialog({ open: false });

    fireEvent.keyDown(document.body, { key: "Enter" });

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});
