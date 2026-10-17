// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CheckBadge } from "./check-badge";

describe("CheckBadge", () => {
  it("marks a selection in the primary color by default", () => {
    const { container } = render(<CheckBadge />);
    const badge = container.querySelector('[data-slot="check-badge"]');
    expect(badge).toHaveAttribute("data-tone", "primary");
    expect(badge).toHaveClass("bg-primary");
  });

  it("marks an installed or connected state in the success color", () => {
    const { container } = render(<CheckBadge tone="success" className="size-3.5" />);
    const badge = container.querySelector('[data-slot="check-badge"]');
    expect(badge).toHaveAttribute("data-tone", "success");
    expect(badge).toHaveClass("bg-emerald-600", "size-3.5");
    expect(badge).not.toHaveClass("bg-primary");
  });
});
