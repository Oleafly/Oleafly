// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Users } from "lucide-react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { NavItem } from "./nav-item";

const LABEL = "People";

describe("NavItem", () => {
  it("marks the current section and shows it with a border, not an outline", () => {
    render(<NavItem icon={Users} label={LABEL} active />);
    const item = screen.getByRole("button", { name: "People" });
    expect(item).toHaveAttribute("aria-current", "page");
    expect(item).toHaveAttribute("type", "button");
    expect(item).toHaveClass("border-border", "bg-background", "font-medium");
    expect(item.className).not.toMatch(/\b(outline|ring)-/);
  });

  it("tints an inactive item on hover and keyboard focus and passes clicks and refs through", async () => {
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(
      <NavItem
        ref={ref}
        icon={Users}
        label={LABEL}
        active={false}
        labelClassName="max-md:sr-only"
        data-testid="nav-people"
        onClick={onClick}
      />,
    );
    const item = screen.getByTestId("nav-people");
    expect(item).not.toHaveAttribute("aria-current");
    expect(item).toHaveClass("border-transparent", "hover:bg-background/60", "focus-visible:bg-background/60");
    expect(screen.getByText("People")).toHaveClass("max-md:sr-only");
    expect(ref.current).toBe(item);
    await userEvent.setup().click(item);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
