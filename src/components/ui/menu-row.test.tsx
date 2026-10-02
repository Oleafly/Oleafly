// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MenuRow } from "./menu-row";

const LABEL = "Insert image";

describe("MenuRow", () => {
  it("runs its action and shows focus with a background tint", () => {
    const onClick = vi.fn();
    render(
      <MenuRow
        icon={<span data-testid="row-icon" />}
        label={LABEL}
        onClick={onClick}
        className="text-xs"
      />,
    );

    const row = screen.getByRole("button", { name: LABEL });
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(row).toHaveAttribute("type", "button");
    expect(row).toHaveClass("hover:bg-accent", "focus-visible:bg-accent", "text-xs");
    expect(row).not.toHaveClass("text-sm");
    expect(screen.getByTestId("row-icon").parentElement).toHaveClass("text-muted-foreground");
  });
});
