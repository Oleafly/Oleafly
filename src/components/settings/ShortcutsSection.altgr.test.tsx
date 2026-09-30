// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useShortcutStore } from "@/store/shortcuts";
import { ShortcutsSection } from "./ShortcutsSection";

const label = enSettings.shortcuts.actions.commandPalette.label;

function setPlatform(platform: string) {
  Object.defineProperty(navigator, "platform", { value: platform, configurable: true });
}

function startCapture() {
  const row = screen.getByText(label).closest<HTMLElement>("[data-setting-id]");
  if (!row) throw new Error("command palette row is missing");
  fireEvent.click(within(row).getByRole("button", { name: /^Edit / }));
  return { row, capture: within(row).getByRole("button", { name: /^Recording / }) };
}

describe("Recording an app shortcut with AltGr", () => {
  beforeEach(() => {
    localStorage.clear();
    useShortcutStore.getState().resetAll();
  });

  afterEach(() => setPlatform(""));

  it("keeps recording on Windows when AltGr goes down before the real key", () => {
    setPlatform("Win32");
    render(<ShortcutsSection />);
    const { row, capture } = startCapture();

    // Windows reports AltGr as its own key with Ctrl and Alt held.
    fireEvent.keyDown(capture, { key: "AltGraph", ctrlKey: true, altKey: true });

    expect(useShortcutStore.getState().bindings.commandPalette).toEqual({ key: "k", mod: true });
    expect(within(row).getByRole("button", { name: /^Recording / })).toBe(capture);
    expect(row).not.toHaveTextContent("AltGraph");

    fireEvent.keyDown(capture, { key: "P", ctrlKey: true, altKey: true });

    expect(useShortcutStore.getState().bindings.commandPalette).toEqual({
      key: "p",
      mod: true,
      shift: false,
      alt: true,
    });
  });

  it("keeps recording on Linux when AltGr goes down with Ctrl held", () => {
    setPlatform("Linux x86_64");
    render(<ShortcutsSection />);
    const { row, capture } = startCapture();

    fireEvent.keyDown(capture, { key: "AltGraph", ctrlKey: true });

    expect(useShortcutStore.getState().bindings.commandPalette).toEqual({ key: "k", mod: true });
    expect(within(row).getByRole("button", { name: /^Recording / })).toBe(capture);
  });
});
