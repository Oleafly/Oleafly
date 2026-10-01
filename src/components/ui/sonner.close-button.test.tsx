// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "./sonner";
import { toast } from "@/lib/toast";
import { useToastStore } from "@/store/toast";

const MOVED = 'Moved "Gfhgj" to the Recycle Bin.';
const ADDED_ENTRY = "Added the entry to refs.bib";
const UNDO = "Undo";

// jsdom does not run Tailwind, so these check that the toaster hands sonner
// the classes that pull the close button inside the toast at the inline end.
const PLACEMENT = [
  "group-[.toast]:!static",
  "group-[.toast]:!order-last",
  "group-[.toast]:!shrink-0",
  "group-[.toast]:!transform-none",
];

beforeEach(() => {
  useToastStore.getState().reset();
});

function closeButtons() {
  return screen.getAllByRole("button", { name: "Close toast" });
}

describe("Toaster close button", () => {
  it.each([
    ["success", () => toast.success(MOVED)],
    ["error", () => toast.error(MOVED)],
    ["info", () => toast.info(MOVED)],
  ])("sits at the end of a %s toast", async (_kind, show) => {
    render(<Toaster />);
    act(() => {
      show();
    });

    const [button] = await screen.findAllByRole("button", { name: "Close toast" });
    for (const name of PLACEMENT) expect(button).toHaveClass(name);
  });

  it("is styled without an outline, ring or focus shadow", async () => {
    render(<Toaster />);
    act(() => {
      toast.success(MOVED);
    });

    const [button] = await screen.findAllByRole("button", { name: "Close toast" });
    expect(button).toHaveClass("group-[.toast]:hover:!bg-accent");
    expect(button).toHaveClass("group-[.toast]:focus-visible:!bg-accent");
    expect(button).toHaveClass("group-[.toast]:focus-visible:!shadow-none");
    expect(button.className).not.toMatch(/\b(?:outline|ring)-/);
  });

  it("keeps the action button and still closes the toast", async () => {
    const undo = vi.fn();
    render(<Toaster />);
    act(() => {
      toast.success(ADDED_ENTRY, { label: UNDO, onClick: undo });
    });

    expect(await screen.findByRole("button", { name: UNDO })).toBeInTheDocument();
    const [button] = closeButtons();
    for (const name of PLACEMENT) expect(button).toHaveClass(name);

    fireEvent.click(button);

    expect(undo).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
