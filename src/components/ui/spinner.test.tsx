// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner } from "./spinner";

const LABEL = "Building preview";

describe("Spinner", () => {
  it("spins at the md size by default, stops under reduced motion and stays out of the accessibility tree", () => {
    const { container } = render(<Spinner />);
    const icon = container.querySelector("svg");
    expect(icon).toHaveClass("animate-spin", "motion-reduce:animate-none", "shrink-0", "size-4");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it.each([
    ["xs", "size-3"],
    ["sm", "size-3.5"],
    ["md", "size-4"],
    ["lg", "size-5"],
    ["xl", "size-6"],
  ] as const)("maps the %s size to %s", (size, token) => {
    const { container } = render(<Spinner size={size} />);
    expect(container.querySelector("svg")).toHaveClass(token);
  });

  it("lets a caller override the size and colour and pass through attributes", () => {
    const { container } = render(
      <Spinner size="sm" className="size-8 text-primary" data-testid="busy-icon" />,
    );
    const icon = screen.getByTestId("busy-icon");
    expect(icon).toBe(container.querySelector("svg"));
    expect(icon).toHaveClass("size-8", "text-primary");
    expect(icon).not.toHaveClass("size-3.5");
  });

  it("is announced when it carries its own label", () => {
    render(<Spinner aria-label={LABEL} />);
    const icon = screen.getByLabelText(LABEL);
    expect(icon).not.toHaveAttribute("aria-hidden");
  });
});
