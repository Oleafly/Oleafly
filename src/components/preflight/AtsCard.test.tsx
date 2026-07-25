// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { simulateAtsParse } from "@oleafly/preflight";
import { AtsCard } from "./AtsCard";

describe("AtsCard section semantics", () => {
  it("exposes a detected GitHub Projects alias through the canonical chip id", () => {
    render(
      <AtsCard
        parse={simulateAtsParse(
          ["Jane Doe", "jane@example.com", "Experience", "GitHub Projects"].join(
            "\n",
          ),
        )}
      />,
    );
    const projects = screen.getByTestId("ats-section-projects");
    expect(projects).toHaveAttribute("data-present", "true");
    expect(projects).toHaveAttribute("data-required", "false");
    expect(projects).toHaveAccessibleName("Projects: detected");
  });

  it("labels an absent optional section neutrally rather than as a failure", () => {
    render(
      <AtsCard
        parse={simulateAtsParse(
          ["Jane Doe", "jane@example.com", "Experience", "Education"].join("\n"),
        )}
      />,
    );
    const projects = screen.getByTestId("ats-section-projects");
    expect(projects).toHaveAttribute("data-present", "false");
    expect(projects).toHaveAttribute("data-required", "false");
    expect(projects).toHaveAccessibleName("Projects: optional section not detected");
    expect(projects).toHaveClass("text-muted-foreground");
    expect(projects).not.toHaveClass("text-red-500");
  });

  it("keeps the required Experience chip distinguishable", () => {
    render(
      <AtsCard
        parse={simulateAtsParse(
          ["Jane Doe", "jane@example.com", "Education", "Skills"].join("\n"),
        )}
      />,
    );
    const experience = screen.getByTestId("ats-section-experience");
    expect(experience).toHaveAttribute("data-present", "false");
    expect(experience).toHaveAttribute("data-required", "true");
    expect(experience).toHaveAccessibleName(
      "Experience: required section not detected",
    );
  });
});
