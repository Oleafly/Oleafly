// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsOptionCards } from "./SettingsOptionCards";

const OPTIONS = [
  { id: "one", label: "One", preview: <span data-testid="preview-one" /> },
  { id: "two", label: "Two", preview: <span data-testid="preview-two" /> },
] as const;
const LAYOUT = "Layout";
const STYLE = "Style";
const PICK = "Pick a layout";
const RESET = "Reset";

describe("SettingsOptionCards", () => {
  it("names its group, marks the chosen card and reports a new choice", () => {
    const onChange = vi.fn();
    render(
      <SettingsOptionCards
        testId="cards"
        label={LAYOUT}
        description={PICK}
        value="one"
        options={OPTIONS}
        onChange={onChange}
        optionTestId={(id) => `card-${id}`}
        adornment={<button type="button">{RESET}</button>}
      />,
    );
    expect(screen.getByRole("group", { name: "Layout" })).toBeInTheDocument();
    expect(screen.getByText("Pick a layout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
    expect(screen.getByTestId("card-one")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("card-two")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("preview-two")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Two" }));
    expect(onChange).toHaveBeenCalledWith("two");
  });

  it("lays out four columns when asked and works without test ids", () => {
    render(
      <SettingsOptionCards label={STYLE} description={PICK} value="two" options={OPTIONS} onChange={vi.fn()} columns={4} />,
    );
    expect(screen.getByRole("group", { name: "Style" }).className).toContain("sm:grid-cols-4");
    expect(screen.getByRole("button", { name: "Two" })).not.toHaveAttribute("data-testid");
  });
});

describe("SettingsOptionCards focus", () => {
  it("tints the chosen card on keyboard focus as well as the others", () => {
    render(
      <SettingsOptionCards
        label={LAYOUT}
        description={STYLE}
        value="b"
        onChange={() => {}}
        options={[
          { id: "a", label: "A", preview: null },
          { id: "b", label: "B", preview: null },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "B" }).className).toContain("focus-visible:bg-primary/15");
    expect(screen.getByRole("button", { name: "A" }).className).toContain("focus-visible:bg-accent");
  });
});
