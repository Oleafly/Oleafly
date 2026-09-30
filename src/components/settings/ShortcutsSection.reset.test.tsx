// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useSettingsStore } from "@/store/settings";
import { useShortcutStore } from "@/store/shortcuts";
import { ShortcutsSection } from "./ShortcutsSection";

describe("Keyboard Shortcuts reset", () => {
  beforeEach(() => {
    localStorage.clear();
    useShortcutStore.getState().resetAll();
    useSettingsStore.getState().setAccentColor("#db2777");
  });

  it("resets only shortcut bindings after confirmation and persists the defaults", () => {
    useShortcutStore.getState().setBinding("recompile", {
      key: "r",
      mod: true,
      shift: true,
    });

    render(<ShortcutsSection />);

    fireEvent.click(
      screen.getByRole("button", { name: enSettings.reset.button }),
    );

    const confirmation = screen.getByRole("alertdialog", {
      name: enSettings.reset.confirmTitle.replace(
        "{{sectionName}}",
        enSettings.shortcuts.reset.sectionName,
      ),
    });
    expect(confirmation).toHaveTextContent(
      enSettings.reset.confirmDescription.replace(
        "{{sectionName}}",
        enSettings.shortcuts.reset.sectionName,
      ),
    );
    expect(useShortcutStore.getState().bindings.recompile).toEqual({
      key: "r",
      mod: true,
      shift: true,
    });

    fireEvent.click(
      within(confirmation).getByRole("button", { name: enSettings.reset.button }),
    );

    expect(useShortcutStore.getState().bindings.recompile).toEqual({
      key: "Enter",
      mod: true,
    });
    expect(
      JSON.parse(localStorage.getItem("oleafly.shortcuts") ?? "{}")
        .recompile,
    ).toEqual({ key: "Enter", mod: true });
    expect(useSettingsStore.getState().accentColor).toBe("#db2777");
    expect(localStorage.getItem("oleafly.accent")).toBe("#db2777");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows a row reset only after the binding changes", () => {
    const label = enSettings.shortcuts.actions.recompile.label;
    const resetName = enSettings.shortcuts.application.resetAriaLabel.replace(
      "{{action}}",
      label,
    );
    render(<ShortcutsSection />);
    const row = screen.getByText(label).closest("[data-setting-id]");
    expect(row).toHaveAttribute("data-setting-id", "shortcut.recompile");
    expect(screen.queryByRole("button", { name: resetName })).not.toBeInTheDocument();

    act(() =>
      useShortcutStore.getState().setBinding("recompile", { key: "r", mod: true, shift: true }),
    );
    expect(row).toHaveTextContent(enSettings.changed.marker);
    fireEvent.click(screen.getByRole("button", { name: resetName }));

    expect(useShortcutStore.getState().bindings.recompile).toEqual({ key: "Enter", mod: true });
    expect(screen.queryByRole("button", { name: resetName })).not.toBeInTheDocument();
    expect(row).not.toHaveTextContent(enSettings.changed.marker);
  });

  it("announces the changed state on the shortcut button", () => {
    const label = enSettings.shortcuts.actions.recompile.label;
    render(<ShortcutsSection />);
    const row = screen.getByText(label).closest<HTMLElement>("[data-setting-id]");
    if (!row) throw new Error("recompile row is missing");
    const capture = () => within(row).getByRole("button", { name: /^Edit / });
    expect(capture()).not.toHaveAccessibleDescription();

    act(() =>
      useShortcutStore.getState().setBinding("recompile", { key: "r", mod: true, shift: true }),
    );
    expect(capture()).toHaveAccessibleDescription(enSettings.changed.marker);

    fireEvent.click(
      within(row).getByRole("button", {
        name: enSettings.shortcuts.application.resetAriaLabel.replace("{{action}}", label),
      }),
    );
    expect(capture()).not.toHaveAccessibleDescription();
  });

  it("keeps the shortcut button in place when the row Reset appears", () => {
    const label = enSettings.shortcuts.actions.recompile.label;
    render(<ShortcutsSection />);
    const row = screen.getByText(label).closest<HTMLElement>("[data-setting-id]");
    if (!row) throw new Error("recompile row is missing");
    const capture = within(row).getByRole("button", { name: /^Edit / });
    expect(capture.parentElement?.lastElementChild).toBe(capture);

    act(() =>
      useShortcutStore.getState().setBinding("recompile", { key: "r", mod: true, shift: true }),
    );

    const moved = within(row).getByRole("button", { name: /^Edit / });
    expect(moved.parentElement?.lastElementChild).toBe(moved);
  });

  it("moves keyboard focus to the shortcut button after a row reset", async () => {
    const label = enSettings.shortcuts.actions.recompile.label;
    useShortcutStore.getState().setBinding("recompile", { key: "r", mod: true, shift: true });
    render(<ShortcutsSection />);
    const reset = screen.getByRole("button", {
      name: enSettings.shortcuts.application.resetAriaLabel.replace("{{action}}", label),
    });
    const row = reset.closest<HTMLElement>("[data-setting-id]");
    if (!row) throw new Error("recompile row is missing");

    reset.focus();
    fireEvent.click(reset);

    await waitFor(() =>
      expect(document.activeElement).toBe(within(row).getByRole("button", { name: /^Edit / })),
    );
  });
});
