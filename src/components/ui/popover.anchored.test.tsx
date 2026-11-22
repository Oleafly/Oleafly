// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AnchoredPopover } from "./popover";

const LABEL = "Comment";
const BODY = "Composer";

async function settle() {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

function rect(top: number) {
  return new DOMRect(40, top, 60, 16);
}

describe("AnchoredPopover", () => {
  it("opens without a trigger and measures its anchor", async () => {
    const anchor = vi.fn(() => rect(100));
    render(
      <AnchoredPopover open onOpenChange={vi.fn()} anchor={anchor} ariaLabel={LABEL}>
        {BODY}
      </AnchoredPopover>,
    );
    await settle();

    expect(screen.getByRole("dialog", { name: LABEL })).toHaveTextContent(BODY);
    expect(screen.queryByRole("button")).toBeNull();
    expect(anchor).toHaveBeenCalled();
  });

  it("accepts an object with getBoundingClientRect, such as a Range", async () => {
    const getBoundingClientRect = vi.fn(() => rect(20));
    render(
      <AnchoredPopover open onOpenChange={vi.fn()} anchor={{ getBoundingClientRect }} ariaLabel={LABEL}>
        {BODY}
      </AnchoredPopover>,
    );
    await settle();
    expect(getBoundingClientRect).toHaveBeenCalled();
  });

  it("measures the anchor again when its scroller scrolls", async () => {
    const scroller = document.createElement("div");
    scroller.style.overflow = "auto";
    const inner = document.createElement("div");
    scroller.append(inner);
    document.body.append(scroller);
    let top = 100;
    const anchor = vi.fn(() => rect(top));
    render(
      <AnchoredPopover open onOpenChange={vi.fn()} anchor={anchor} contextElement={inner} ariaLabel={LABEL}>
        {BODY}
      </AnchoredPopover>,
    );
    await settle();
    anchor.mockClear();

    top = 40;
    fireEvent.scroll(scroller);
    await settle();

    expect(anchor).toHaveBeenCalled();
    expect(anchor.mock.results.at(-1)?.value).toEqual(rect(40));
    scroller.remove();
  });

  it("drops the card surface when bare, for content with its own box", async () => {
    const { rerender } = render(
      <AnchoredPopover open onOpenChange={vi.fn()} anchor={() => rect(0)} ariaLabel={LABEL}>
        {BODY}
      </AnchoredPopover>,
    );
    await settle();
    const card = screen.getByRole("dialog", { name: LABEL });
    expect(card).toHaveClass("border", "bg-card", "p-1", "shadow-xl");
    expect(card).not.toHaveAttribute("data-bare");

    rerender(
      <AnchoredPopover open bare onOpenChange={vi.fn()} anchor={() => rect(0)} ariaLabel={LABEL}>
        {BODY}
      </AnchoredPopover>,
    );
    await settle();
    const bare = screen.getByRole("dialog", { name: LABEL });
    expect(bare).toHaveAttribute("data-bare");
    expect(bare).toHaveClass("shadow-xl");
    expect(bare).not.toHaveClass("border", "bg-card", "p-1");
  });

  it("leaves the open state to its caller", async () => {
    const onOpenChange = vi.fn();
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <AnchoredPopover
          open={open}
          onOpenChange={(next) => {
            onOpenChange(next);
            setOpen(next);
          }}
          anchor={() => rect(0)}
          ariaLabel={LABEL}
        >
          {BODY}
        </AnchoredPopover>
      );
    }
    render(<Host />);
    await settle();

    fireEvent.keyDown(screen.getByRole("dialog", { name: LABEL }), { key: "Escape" });
    await settle();

    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("dialog", { name: LABEL })).toBeNull();
  });
});
