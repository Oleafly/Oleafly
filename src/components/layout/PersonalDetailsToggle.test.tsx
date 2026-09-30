// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceDockControls } from "@/components/layout/WorkspaceControls";
import { ThemeProvider } from "@/lib/theme";
import { TOOLBAR_OVERFLOW } from "@/lib/use-toolbar-layout";
import { HIDE_PERSONAL_DETAILS_ATTRIBUTE, usePersonalDetailsStore } from "@/store/personal-details";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const strings = enShell.personalDetails;

function renderControls(overflow = 0) {
  return render(
    <ThemeProvider>
      <WorkspaceDockControls overflow={overflow} />
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  act(() => usePersonalDetailsStore.getState().setHidden(false));
});

describe("personal details toolbar toggle", () => {
  it("sits with the small icon controls and offers to hide details", () => {
    renderControls();
    const toggle = screen.getByTestId("personal-details-toggle");
    expect(toggle).toHaveAccessibleName(strings.hide);
    expect(toggle.closest("[data-toolbar-item]")).toHaveAttribute("data-toolbar-item", "personal-details");
    expect(toggle.querySelector("svg")).toHaveClass("lucide-eye");
  });

  it("hides details on click and shows the eye-off icon and a matching label", async () => {
    const user = userEvent.setup();
    renderControls();
    await user.click(screen.getByTestId("personal-details-toggle"));

    expect(usePersonalDetailsStore.getState().hidden).toBe(true);
    expect(document.documentElement).toHaveAttribute(HIDE_PERSONAL_DETAILS_ATTRIBUTE);
    const toggle = screen.getByTestId("personal-details-toggle");
    expect(toggle).toHaveAccessibleName(strings.show);
    expect(toggle.querySelector("svg")).toHaveClass("lucide-eye-off");

    await user.click(toggle);
    expect(usePersonalDetailsStore.getState().hidden).toBe(false);
  });

  it("shows the state with a background tint, never an outline or ring", async () => {
    const user = userEvent.setup();
    renderControls();
    await user.click(screen.getByTestId("personal-details-toggle"));
    const className = screen.getByTestId("personal-details-toggle").className;
    expect(className).toContain("bg-primary/10");
    expect(className).not.toMatch(/(^|\s)(ring|outline)[-\w/]*/);
  });

  it("moves into the overflow menu with the theme when the toolbar is narrow", async () => {
    const user = userEvent.setup();
    renderControls(TOOLBAR_OVERFLOW.theme);
    const hiddenItem = screen.getByTestId("personal-details-toggle").closest("[data-toolbar-item]");
    expect(hiddenItem).toHaveAttribute("aria-hidden", "true");

    await user.click(screen.getByTestId("workspace-menu"));
    const menu = screen.getByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: strings.hide }));
    expect(usePersonalDetailsStore.getState().hidden).toBe(true);
  });
});
