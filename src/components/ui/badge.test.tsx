// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, type BadgeVariant } from "./badge";

const LABEL = "Connected";

describe("Badge", () => {
  it("renders the default variant at the default size", () => {
    render(<Badge>{LABEL}</Badge>);
    const badge = screen.getByText(LABEL);
    expect(badge).toHaveClass("rounded-full", "bg-primary", "px-2", "py-0.5", "text-xs", "font-medium");
  });

  it.each([
    ["muted", ["bg-muted", "text-muted-foreground", "border-transparent"]],
    ["success", ["bg-emerald-500/10", "text-emerald-700", "dark:text-emerald-300"]],
    ["warning", ["bg-amber-500/10", "text-amber-700", "dark:text-amber-300"]],
    ["destructive", ["bg-destructive/10", "text-destructive"]],
    ["info", ["bg-sky-500/10", "text-sky-700", "dark:text-sky-300"]],
    ["primaryGhost", ["bg-primary/10", "text-primary"]],
  ] as const)("gives the %s status its tint", (variant, tokens) => {
    render(<Badge variant={variant as BadgeVariant}>{LABEL}</Badge>);
    expect(screen.getByText(LABEL)).toHaveClass(...tokens);
  });

  it("shrinks to the compact pill used in dense rows", () => {
    render(
      <Badge variant="success" size="sm" className="gap-1">
        {LABEL}
      </Badge>,
    );
    const badge = screen.getByText(LABEL);
    expect(badge).toHaveClass("px-1.5", "text-[10px]", "gap-1");
    expect(badge).not.toHaveClass("px-2", "text-xs");
  });
});
