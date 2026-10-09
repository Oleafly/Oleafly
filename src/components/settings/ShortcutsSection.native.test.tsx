// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useShortcutStore } from "@/store/shortcuts";

const native = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<void>>(async () => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => true }));

import { ShortcutsSection } from "./ShortcutsSection";

const toggleTerminal = enSettings.shortcuts.actions.toggleTerminal.label;
const nativeKeyError = enSettings.shortcuts.error.nativeKey;
const optionEqual = { key: "≠", code: "Equal", ctrlKey: true, altKey: true };
const optionT = { key: "†", code: "KeyT", ctrlKey: true, altKey: true };
const pauses = () =>
  native.invoke.mock.calls
    .filter(([command]) => command === "set_native_shortcuts_paused")
    .map(([, args]) => (args as { paused: boolean } | undefined)?.paused);

describe("ShortcutsSection with native menu shortcuts", () => {
  const originalPlatform = navigator.platform;

  beforeEach(() => {
    Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
    native.invoke.mockClear();
    useShortcutStore.getState().resetAll();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "platform", { value: originalPlatform, configurable: true });
  });

  it("pauses the menu shortcuts while recording and refuses a key the menu cannot use", async () => {
    render(<ShortcutsSection />);
    const before = useShortcutStore.getState().bindings.toggleTerminal;
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Edit ${toggleTerminal}`) }));
    const capture = screen.getByRole("button", { name: new RegExp(`^Recording ${toggleTerminal}`) });
    await waitFor(() => expect(pauses()).toEqual([true]));

    fireEvent.keyDown(capture, optionEqual);

    expect(screen.getByText(nativeKeyError)).toBeInTheDocument();
    expect(useShortcutStore.getState().bindings.toggleTerminal).toEqual(before);

    fireEvent.keyDown(capture, { key: "Escape" });
    await waitFor(() => expect(pauses()).toEqual([true, false]));
  });

  it("records Ctrl+Option+letter as the letter pressed, which the menu can use", async () => {
    render(<ShortcutsSection />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Edit ${toggleTerminal}`) }));
    const capture = screen.getByRole("button", { name: new RegExp(`^Recording ${toggleTerminal}`) });

    fireEvent.keyDown(capture, optionT);

    expect(screen.queryByText(nativeKeyError)).toBeNull();
    expect(useShortcutStore.getState().bindings.toggleTerminal).toEqual({
      key: "t",
      ctrl: true,
      shift: false,
      alt: true,
    });
  });
});
