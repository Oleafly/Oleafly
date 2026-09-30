// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { ResetToDefaults } from "./ResetToDefaults";

describe("ResetToDefaults", () => {
  it("marks the button when a setting differs from its default", () => {
    render(<ResetToDefaults sectionName="General" onReset={() => {}} changed />);

    const button = screen.getByRole("button", { name: enSettings.reset.button });
    expect(button).toHaveAccessibleDescription(enSettings.reset.changed);
    expect(screen.getByTestId("reset-changed-dot")).toBeInTheDocument();
  });

  it("adds nothing while every setting is at its default", () => {
    render(<ResetToDefaults sectionName="General" onReset={() => {}} />);

    const button = screen.getByRole("button", { name: enSettings.reset.button });
    expect(button).not.toHaveAccessibleDescription();
    expect(screen.queryByTestId("reset-changed-dot")).not.toBeInTheDocument();
  });
});
