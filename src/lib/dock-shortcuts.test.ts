import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings";
import { useShortcutStore } from "@/store/shortcuts";

const toggleBrowser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/browser-window", () => ({ toggleBrowser }));

import { handleDockShortcut } from "./dock-shortcuts";

function keyboard(
  key: string,
  modifiers: Partial<
    Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "getModifierState">
  > = {},
): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...modifiers,
  } as unknown as KeyboardEvent;
}

describe("dock shortcuts", () => {
  beforeEach(() => {
    useSettingsStore.setState({ terminalOpen: false, browserOpen: false, webBrowser: true });
    useShortcutStore.getState().resetAll();
  });

  it("toggles the terminal with fixed Ctrl and consumes the key event", () => {
    const event = keyboard("`", { ctrlKey: true });

    expect(handleDockShortcut(event)).toBe(true);
    expect(useSettingsStore.getState()).toMatchObject({
      terminalOpen: true,
      browserOpen: false,
    });
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it("launches the browser window with fixed Ctrl+Shift+B", () => {
    const event = keyboard("b", {
      ctrlKey: true,
      shiftKey: true,
    });

    expect(handleDockShortcut(event)).toBe(true);
    expect(toggleBrowser).toHaveBeenCalled();
    expect(useSettingsStore.getState().terminalOpen).toBe(false);
  });

  it("leaves Ctrl+Shift+B to the visual editor's blockquote while it has focus", () => {
    const event = keyboard("b", { ctrlKey: true, shiftKey: true });
    Object.assign(event, {
      target: { closest: (selector: string) => (selector === ".ProseMirror" ? {} : null) },
    });
    const calls = toggleBrowser.mock.calls.length;

    expect(handleDockShortcut(event)).toBe(false);
    expect(toggleBrowser).toHaveBeenCalledTimes(calls);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores a character typed through AltGr that matches a Ctrl+Alt binding", () => {
    const originalNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", { platform: "Win32" });
    try {
      useShortcutStore
        .getState()
        .setBinding("toggleTerminal", { key: "@", mod: true, shift: true, alt: true });
      const modifiers = { ctrlKey: true, altKey: true, shiftKey: true };
      // From engines that report AltGr as Ctrl+Alt.
      const altGr = keyboard("@", {
        ...modifiers,
        getModifierState: (key: string) => key === "AltGraph",
      });

      expect(handleDockShortcut(altGr)).toBe(false);
      expect(useSettingsStore.getState().terminalOpen).toBe(false);
      expect(altGr.preventDefault).not.toHaveBeenCalled();

      // US Ctrl+Alt+Shift+2 carries the same key without AltGraph.
      const chord = keyboard("@", modifiers);
      expect(handleDockShortcut(chord)).toBe(true);
      expect(useSettingsStore.getState().terminalOpen).toBe(true);
    } finally {
      vi.stubGlobal("navigator", originalNavigator);
    }
  });

  it("leaves unrelated key events alone", () => {
    const event = keyboard("x", { ctrlKey: true });

    expect(handleDockShortcut(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(useSettingsStore.getState()).toMatchObject({
      terminalOpen: false,
      browserOpen: false,
    });
  });
});
