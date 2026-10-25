// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContextRing } from "./ContextRing";

describe("ContextRing", () => {
  it("draws the share of the context window in use with its tone", () => {
    render(<ContextRing snapshot={{ context: { used: 190_000, size: 200_000 } }} />);
    const ring = screen.getByTestId("ai-context-ring");
    expect(ring).toHaveAttribute("data-tone", "critical");
    expect(ring.querySelectorAll("circle")).toHaveLength(2);
  });

  it("draws an empty ring when the window is unknown", () => {
    render(<ContextRing snapshot={{}} />);
    const ring = screen.getByTestId("ai-context-ring");
    expect(ring).toHaveAttribute("data-state", "unknown");
    expect(ring.querySelectorAll("circle")).toHaveLength(1);
  });
});
