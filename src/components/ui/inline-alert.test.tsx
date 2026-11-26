// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { AlertCircle } from "lucide-react";
import { describe, expect, it } from "vitest";
import { InlineAlert } from "./inline-alert";

describe("InlineAlert", () => {
  it("announces a plain message in the small tinted style", () => {
    render(<InlineAlert id="save-error">{"Could not save"}</InlineAlert>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("id", "save-error");
    expect(alert).toHaveTextContent("Could not save");
    expect(alert).toHaveClass("bg-destructive/10", "text-destructive", "text-xs", "px-3");
    expect(alert).not.toHaveClass("border");
    expect(alert.querySelector("svg")).toBeNull();
  });

  it("puts an icon beside the message and can draw a border at either size", () => {
    const { rerender } = render(
      <InlineAlert icon={AlertCircle} bordered>
        {"Lookup failed"}
      </InlineAlert>,
    );
    const alert = screen.getByRole("alert");
    const icon = alert.querySelector("svg");
    expect(alert).toHaveClass("flex", "items-start", "gap-2", "border", "border-destructive/30", "px-2.5");
    expect(alert).not.toHaveClass("px-3");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveClass("size-3.5", "shrink-0");
    expect(alert.querySelector("span")).toHaveTextContent("Lookup failed");

    rerender(
      <InlineAlert icon={AlertCircle} bordered size="sm" className="mt-3 px-3.5">
        {"Lookup failed"}
      </InlineAlert>,
    );
    expect(screen.getByRole("alert")).toHaveClass("text-sm", "mt-3", "px-3.5");
    expect(screen.getByRole("alert")).not.toHaveClass("text-xs", "px-2.5");
    expect(screen.getByRole("alert").querySelector("svg")).toHaveClass("size-4");
  });

  it("takes the amber warning tone, framed or not", () => {
    const { rerender } = render(<InlineAlert tone="warning">{"1 problem"}</InlineAlert>);
    expect(screen.getByRole("alert")).toHaveClass("bg-amber-500/10", "text-amber-700");
    expect(screen.getByRole("alert")).not.toHaveClass("bg-destructive/10", "text-destructive");
    rerender(
      <InlineAlert tone="warning" bordered>
        {"1 problem"}
      </InlineAlert>,
    );
    expect(screen.getByRole("alert")).toHaveClass("border", "border-amber-500/30");
  });
});
