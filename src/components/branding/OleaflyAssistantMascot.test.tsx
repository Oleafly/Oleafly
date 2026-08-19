// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OleaflyAssistantMascot } from "./OleaflyAssistantMascot";

describe("OleaflyAssistantMascot", () => {
  it("owns the wrapper and blink-layer classes used by its hover animation", () => {
    const { container } = render(<OleaflyAssistantMascot />);

    expect(
      screen.getByRole("img", { name: "Oleafly AI assistant mascot" }),
    ).toHaveClass("oleafly-assistant-mascot");
    expect(
      container.querySelector(".oleafly-assistant-mascot-blink"),
    ).toBeInTheDocument();
  });
});
