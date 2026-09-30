// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useEditorKeymapStore } from "@/store/editor-keymap";
import { useShortcutStore } from "@/store/shortcuts";
import { ShortcutsSection } from "./ShortcutsSection";

const commandPalette = enSettings.shortcuts.actions.commandPalette.label;
const prompt = enSettings.shortcuts.application.prompt;

// AltGr+Q on a German layout, from engines that report AltGr as Ctrl+Alt.
const altGrAt = { key: "@", code: "KeyQ", ctrlKey: true, altKey: true, modifierAltGraph: true };
// AltGr+Shift+4 on US-International, as WebView2 reports it.
const altGrPound = { key: "£", code: "Digit4", shiftKey: true, modifierAltGraph: true };
const ctrlAltQ = { key: "q", code: "KeyQ", ctrlKey: true, altKey: true };

function setPlatform(value: string) {
  Object.defineProperty(navigator, "platform", { value, configurable: true });
}

function startAppCapture() {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Edit ${commandPalette}`) }));
  return screen.getByRole("button", { name: new RegExp(`^Recording ${commandPalette}`) });
}

async function startTitleCaseCapture() {
  await userEvent.setup().click(screen.getByTestId("shortcuts-tab-editor"));
  const row = screen.getByTestId("editor-key-row-titleCase");
  fireEvent.click(within(row).getByRole("button", { name: /^Edit / }));
  return { row, capture: within(row).getByRole("button", { name: /^Recording / }) };
}

describe("ShortcutsSection with AltGr layouts", () => {
  beforeEach(() => {
    localStorage.clear();
    setPlatform("Win32");
    useShortcutStore.getState().resetAll();
    useEditorKeymapStore.getState().resetAll();
  });

  it("keeps the application recorder waiting through an AltGr character", () => {
    render(<ShortcutsSection />);
    const capture = startAppCapture();

    fireEvent.keyDown(capture, altGrAt);

    expect(
      screen.getByRole("button", { name: new RegExp(`^Recording ${commandPalette}`) }),
    ).toBe(capture);
    expect(screen.getByText(prompt)).toBeInTheDocument();
    expect(useShortcutStore.getState().bindings.commandPalette).toEqual({ key: "k", mod: true });

    fireEvent.keyDown(capture, ctrlAltQ);

    expect(useShortcutStore.getState().bindings.commandPalette).toEqual({
      key: "q",
      mod: true,
      shift: false,
      alt: true,
    });
  });

  it("keeps the application recorder waiting through Ctrl, AltGr+Q and dead keys in WebView2", () => {
    render(<ShortcutsSection />);
    const capture = startAppCapture();

    // WebView2 clears Ctrl and Alt once AltGr is down.
    fireEvent.keyDown(capture, { key: "Control", code: "ControlLeft", ctrlKey: true });
    fireEvent.keyDown(capture, { key: "AltGraph", code: "AltRight", modifierAltGraph: true });
    fireEvent.keyDown(capture, { key: "@", code: "KeyQ", modifierAltGraph: true });
    // Ctrl with the ^ accent key on a French layout.
    fireEvent.keyDown(capture, { key: "Dead", code: "BracketLeft", ctrlKey: true });

    expect(
      screen.getByRole("button", { name: new RegExp(`^Recording ${commandPalette}`) }),
    ).toBe(capture);
    expect(useShortcutStore.getState().bindings.commandPalette).toEqual({ key: "k", mod: true });

    // Left Ctrl+Left Alt+K on a German layout, where AltGr+K types nothing.
    fireEvent.keyDown(capture, { key: "k", code: "KeyK", ctrlKey: true, altKey: true });

    expect(useShortcutStore.getState().bindings.commandPalette).toEqual({
      key: "k",
      mod: true,
      shift: false,
      alt: true,
    });
  });

  it("keeps the editor key recorder waiting through AltGr characters", async () => {
    render(<ShortcutsSection />);
    const { row, capture } = await startTitleCaseCapture();

    fireEvent.keyDown(capture, altGrAt);
    fireEvent.keyDown(capture, altGrPound);

    expect(useEditorKeymapStore.getState().keys.titleCase).toBe("");
    expect(within(row).getByRole("button", { name: /^Recording / })).toBe(capture);
    expect(row).toHaveTextContent(prompt);

    fireEvent.keyDown(capture, ctrlAltQ);

    expect(useEditorKeymapStore.getState().keys.titleCase).toBe("Mod-Alt-q");
  });

  it("keeps the editor key recorder waiting through Shift with a character", async () => {
    render(<ShortcutsSection />);
    const { row, capture } = await startTitleCaseCapture();

    fireEvent.keyDown(capture, { key: "!", code: "Digit1", shiftKey: true });

    expect(useEditorKeymapStore.getState().keys.titleCase).toBe("");
    expect(within(row).getByRole("button", { name: /^Recording / })).toBe(capture);
  });

  it("keeps the application recorder waiting through Ctrl with AltGr on Linux", () => {
    setPlatform("Linux x86_64");
    render(<ShortcutsSection />);
    const capture = startAppCapture();

    fireEvent.keyDown(capture, { key: "AltGraph", code: "AltRight", ctrlKey: true });
    fireEvent.keyDown(capture, { key: "GroupNext", code: "ShiftLeft", ctrlKey: true });

    expect(
      screen.getByRole("button", { name: new RegExp(`^Recording ${commandPalette}`) }),
    ).toBe(capture);
    expect(useShortcutStore.getState().bindings.commandPalette).toEqual({ key: "k", mod: true });

    // Ctrl+AltGr+9 on a German layout types nothing on Linux, so it records.
    fireEvent.keyDown(capture, {
      key: "]",
      code: "Digit9",
      ctrlKey: true,
      modifierAltGraph: true,
    });

    expect(useShortcutStore.getState().bindings.commandPalette).toEqual({
      key: "]",
      mod: true,
      shift: false,
      alt: false,
    });
  });
});
