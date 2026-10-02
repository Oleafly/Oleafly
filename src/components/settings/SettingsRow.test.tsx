// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsRow } from "./SettingsRow";

const LABEL = "Font size";
const DESCRIPTION = "Size of the interface text.";
const DETAIL = "Press a key to record.";
const STATE = "Installed";
const CONTROL = "Change";
const ICON = "icon";

describe("SettingsRow", () => {
  it("lays out the label and description on the left and the control on the right", () => {
    render(
      <SettingsRow
        testId="settings-row-font-size"
        label={LABEL}
        description={DESCRIPTION}
        control={<button type="button">{CONTROL}</button>}
      />,
    );

    const row = screen.getByTestId("settings-row-font-size");
    expect(row).toHaveClass(
      "flex",
      "items-center",
      "justify-between",
      "gap-4",
      "rounded-lg",
      "border",
      "bg-card",
      "p-3",
    );
    expect(screen.getByText(LABEL)).toHaveClass("text-sm", "font-medium");
    expect(screen.getByText(DESCRIPTION)).toHaveClass("text-xs", "text-muted-foreground");
    const control = screen.getByRole("button", { name: CONTROL });
    expect(control.parentElement).toBe(row);
    expect(row.lastElementChild).toBe(control);
  });

  it("omits the description and renders details, an adornment and a leading icon when given", () => {
    render(
      <SettingsRow
        testId="row"
        label={LABEL}
        adornment={<span>{STATE}</span>}
        details={<p>{DETAIL}</p>}
        icon={<span data-testid="row-icon">{ICON}</span>}
      />,
    );

    const row = screen.getByTestId("row");
    expect(row.querySelector(".text-muted-foreground")).toBeNull();
    expect(screen.getByText(LABEL).parentElement).toHaveClass("flex", "flex-wrap", "gap-2");
    expect(screen.getByText(STATE).previousElementSibling).toBe(screen.getByText(LABEL));
    expect(screen.getByText(DETAIL)).toBeInTheDocument();
    expect(screen.getByTestId("row-icon").parentElement).toHaveClass("items-start", "gap-3");
  });

  it("passes interaction attributes and extra classes to the row", () => {
    render(
      <SettingsRow
        testId="row"
        role="switch"
        aria-checked
        aria-label={LABEL}
        className="cursor-pointer"
        label={LABEL}
      />,
    );

    const row = screen.getByRole("switch", { name: LABEL });
    expect(row).toBe(screen.getByTestId("row"));
    expect(row).toHaveClass("cursor-pointer", "bg-card");
  });
});
