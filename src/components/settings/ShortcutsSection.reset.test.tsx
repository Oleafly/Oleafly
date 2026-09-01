// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
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

    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

    const confirmation = screen.getByRole("alertdialog", {
      name: /Reset Keyboard Shortcuts settings/u,
    });
    expect(confirmation).toHaveTextContent(
      "Restore Keyboard Shortcuts preferences to their defaults.",
    );
    expect(useShortcutStore.getState().bindings.recompile).toEqual({
      key: "r",
      mod: true,
      shift: true,
    });

    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Reset to defaults" }),
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
});
