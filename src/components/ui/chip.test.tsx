// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Chip } from "./chip";

const IMPROVE = "Improve";
const QUOTES = "Quotes";
const TRANSLATE = "Translate";

describe("Chip", () => {
  it("is a plain button pill when it isn't a toggle", () => {
    const onClick = vi.fn();
    render(<Chip onClick={onClick}>{IMPROVE}</Chip>);
    const chip = screen.getByRole("button", { name: "Improve" });
    expect(chip).toHaveAttribute("type", "button");
    expect(chip).not.toHaveAttribute("aria-pressed");
    expect(chip).toHaveClass("rounded-full", "bg-muted", "border-border");
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows its state as a toggle with a tint, never a ring", () => {
    const { rerender } = render(<Chip pressed={false}>{QUOTES}</Chip>);
    expect(screen.getByRole("button", { name: "Quotes" })).toHaveAttribute("aria-pressed", "false");
    rerender(<Chip pressed>{QUOTES}</Chip>);
    const chip = screen.getByRole("button", { name: "Quotes" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveClass("bg-primary/10", "text-primary");
    expect(chip.className).not.toMatch(/\b(ring|outline)-/u);
  });

  it("takes extra classes and a disabled state", () => {
    render(
      <Chip className="flex-1" disabled>
        {TRANSLATE}
      </Chip>,
    );
    const chip = screen.getByRole("button", { name: "Translate" });
    expect(chip).toHaveClass("flex-1");
    expect(chip).toBeDisabled();
  });
});
