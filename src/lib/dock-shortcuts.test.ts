import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings";
import { useShortcutStore } from "@/store/shortcuts";

const toggleZenMode = vi.hoisted(() => vi.fn());
vi.mock("@/lib/zen-mode", () => ({ toggleZenMode }));
const lifecycle = vi.hoisted(() => ({
  requestCloseTerminals: vi.fn((_ids: readonly string[], close: () => void) => {
    close();
    return Promise.resolve(true);
  }),
  closeTerminalTabs: vi.fn(),
}));
vi.mock("@/lib/terminal-lifecycle", () => lifecycle);

import { useTerminalsStore } from "@/store/terminals";
import { handleDockShortcut, handleTerminalTabShortcut } from "./dock-shortcuts";

const insideTerminal = {
  closest: (selector: string) => (selector === ".xterm" || selector === "[data-terminal-dock]" ? {} : null),
};
const insideDock = {
  closest: (selector: string) => (selector === "[data-terminal-dock]" ? {} : null),
};

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
    useSettingsStore.setState({ terminalOpen: false });
    useShortcutStore.getState().resetAll();
  });

  it("toggles the terminal with fixed Ctrl and consumes the key event", () => {
    const event = keyboard("`", { ctrlKey: true });

    expect(handleDockShortcut(event)).toBe(true);
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it("leaves Ctrl+Shift+B alone now that there is no browser window", () => {
    const event = keyboard("b", { ctrlKey: true, shiftKey: true });

    expect(handleDockShortcut(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().terminalOpen).toBe(false);
  });

  it("toggles Zen mode with its binding and consumes the key event", () => {
    useShortcutStore.getState().setBinding("toggleZenMode", { key: "F11", shift: true });
    const event = keyboard("F11", { shiftKey: true });

    expect(handleDockShortcut(event)).toBe(true);
    expect(toggleZenMode).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(useSettingsStore.getState().terminalOpen).toBe(false);
  });

  it("does not toggle Zen mode for a different chord", () => {
    toggleZenMode.mockClear();
    useShortcutStore.getState().setBinding("toggleZenMode", { key: "F11", shift: true });
    expect(handleDockShortcut(keyboard("F11"))).toBe(false);
    expect(handleDockShortcut(keyboard("F10", { shiftKey: true }))).toBe(false);
    expect(toggleZenMode).not.toHaveBeenCalled();
  });

  it("ignores a character typed through AltGr that matches a Ctrl+Alt binding", () => {
    const originalNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", { platform: "Win32" });
    try {
      useShortcutStore
        .getState()
        .setBinding("toggleTerminal", { key: "@", mod: true, shift: true, alt: true });
      const modifiers = { ctrlKey: true, altKey: true, shiftKey: true };
      const altGr = keyboard("@", {
        ...modifiers,
        getModifierState: (key: string) => key === "AltGraph",
      });

      expect(handleDockShortcut(altGr)).toBe(false);
      expect(useSettingsStore.getState().terminalOpen).toBe(false);
      expect(altGr.preventDefault).not.toHaveBeenCalled();

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
    expect(useSettingsStore.getState().terminalOpen).toBe(false);
  });
});

describe("dock shortcuts and a focused terminal", () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    useSettingsStore.setState({ terminalOpen: false });
    useShortcutStore.getState().resetAll();
    useTerminalsStore.setState({ projectId: null, tabs: [], activeId: null, counters: {} });
    useTerminalsStore.getState().setProject("project-1");
    toggleZenMode.mockClear();
    lifecycle.requestCloseTerminals.mockClear();
    lifecycle.closeTerminalTabs.mockClear();
  });

  afterEach(() => {
    vi.stubGlobal("navigator", originalNavigator);
  });

  it("leaves Shift+F11 and Ctrl+Alt+B to a focused terminal", () => {
    const zen = Object.assign(keyboard("F11", { shiftKey: true }), { target: insideTerminal });
    const ctrlAltB = Object.assign(keyboard("b", { ctrlKey: true, altKey: true }), { target: insideTerminal });

    expect(handleDockShortcut(zen)).toBe(false);
    expect(handleDockShortcut(ctrlAltB)).toBe(false);
    expect(toggleZenMode).not.toHaveBeenCalled();
    expect(zen.preventDefault).not.toHaveBeenCalled();
    expect(ctrlAltB.preventDefault).not.toHaveBeenCalled();

    const outside = keyboard("F11", { shiftKey: true });
    expect(handleDockShortcut(outside)).toBe(true);
    expect(toggleZenMode).toHaveBeenCalledOnce();
  });

  it("still toggles the terminal from inside it", () => {
    useSettingsStore.setState({ terminalOpen: true });
    const event = Object.assign(keyboard("`", { ctrlKey: true }), { target: insideTerminal });

    expect(handleDockShortcut(event)).toBe(true);
    expect(useSettingsStore.getState().terminalOpen).toBe(false);
  });

  it("opens a new terminal with Ctrl+Shift+backquote from anywhere", () => {
    const event = keyboard("~", { ctrlKey: true, shiftKey: true });

    expect(handleTerminalTabShortcut(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(useTerminalsStore.getState().tabs).toHaveLength(2);
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
  });

  it("moves between terminal tabs only while the dock has focus", () => {
    useTerminalsStore.getState().addTerminal();
    const [first, second] = useTerminalsStore.getState().tabs;
    expect(useTerminalsStore.getState().activeId).toBe(second.id);

    const outside = keyboard("PageDown", { ctrlKey: true });
    expect(handleTerminalTabShortcut(outside)).toBe(false);
    expect(outside.preventDefault).not.toHaveBeenCalled();
    expect(useTerminalsStore.getState().activeId).toBe(second.id);

    const next = Object.assign(keyboard("PageDown", { ctrlKey: true }), { target: insideDock });
    expect(handleTerminalTabShortcut(next)).toBe(true);
    expect(useTerminalsStore.getState().activeId).toBe(first.id);

    const previous = Object.assign(keyboard("PageUp", { ctrlKey: true }), { target: insideDock });
    expect(handleTerminalTabShortcut(previous)).toBe(true);
    expect(useTerminalsStore.getState().activeId).toBe(second.id);
  });

  it("leaves Ctrl+PageUp and Ctrl+PageDown to a focused terminal off macOS", () => {
    useTerminalsStore.getState().addTerminal();
    const [first, second] = useTerminalsStore.getState().tabs;
    const inTerminal = (key: string) =>
      Object.assign(keyboard(key, { ctrlKey: true }), { type: "keydown", target: insideTerminal });

    for (const key of ["PageDown", "PageUp"]) {
      const event = inTerminal(key);
      expect(handleTerminalTabShortcut(event)).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(useTerminalsStore.getState().activeId).toBe(second.id);

    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(handleTerminalTabShortcut(inTerminal("PageDown"))).toBe(true);
    expect(useTerminalsStore.getState().activeId).toBe(first.id);
  });

  it("closes the focused terminal through the confirmation", async () => {
    const activeId = useTerminalsStore.getState().activeId;
    const outside = keyboard("w", { ctrlKey: true, shiftKey: true });
    expect(handleTerminalTabShortcut(outside)).toBe(false);

    const event = Object.assign(keyboard("w", { ctrlKey: true, shiftKey: true }), { target: insideTerminal });
    expect(handleTerminalTabShortcut(event)).toBe(true);
    await vi.waitFor(() => expect(lifecycle.closeTerminalTabs).toHaveBeenCalledWith([activeId]));
    expect(lifecycle.requestCloseTerminals).toHaveBeenCalledWith([activeId], expect.any(Function));
  });
});
