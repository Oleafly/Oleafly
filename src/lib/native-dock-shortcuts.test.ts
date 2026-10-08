import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings";
import { useShortcutStore } from "@/store/shortcuts";
import { useTourStore } from "@/store/tours";

const originalNavigator = globalThis.navigator;

const toggleBrowser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/browser-window", () => ({ toggleBrowser }));

const toggleZenMode = vi.hoisted(() => vi.fn());
vi.mock("@/lib/zen-mode", () => ({ toggleZenMode }));

const native = vi.hoisted(() => ({
  invoke: vi.fn(async () => {}),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  projectId: "project-1" as string | null,
  unlisteners: [] as Array<ReturnType<typeof vi.fn>>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (
    event: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    native.listeners.set(event, handler);
    const unlisten = vi.fn(() => native.listeners.delete(event));
    native.unlisteners.push(unlisten);
    return unlisten;
  }),
}));

vi.mock("@/store/files", () => ({
  useFilesStore: {
    getState: () => ({ projectId: native.projectId }),
  },
}));

import {
  isNativeAcceleratorKey,
  nativeAccelerator,
  pauseNativeShortcuts,
  startNativeDockShortcutBridge,
  usesNativeDockMenu,
} from "./native-dock-shortcuts";

describe("native dock shortcuts", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    native.invoke.mockClear();
    toggleZenMode.mockClear();
    native.listeners.clear();
    native.projectId = "project-1";
    native.unlisteners = [];
    useSettingsStore.setState({ terminalOpen: false, browserOpen: false, webBrowser: true });
    useShortcutStore.getState().resetAll();
  });

  afterEach(() => vi.stubGlobal("navigator", originalNavigator));

  it("serializes fixed Ctrl dock bindings for Tauri menu accelerators", () => {
    expect(nativeAccelerator({ key: "`", ctrl: true }, true)).toBe("Ctrl+`");
    expect(
      nativeAccelerator({ key: "b", ctrl: true, shift: true }, true),
    ).toBe("Ctrl+Shift+B");
    expect(nativeAccelerator({ key: "b", mod: true, shift: true }, true)).toBe(
      "Cmd+Shift+B",
    );
    expect(nativeAccelerator({ key: " ", mod: true }, false)).toBe("Ctrl+Space");
  });

  it.each([
    ["!", "Digit1"],
    ["@", "Digit2"],
    ["#", "Digit3"],
    ["$", "Digit4"],
    ["%", "Digit5"],
    ["^", "Digit6"],
    ["&", "Digit7"],
    ["*", "Digit8"],
    ["(", "Digit9"],
    [")", "Digit0"],
    ["+", "Equal"],
    ["_", "Minus"],
    ["{", "BracketLeft"],
    ["}", "BracketRight"],
    ["?", "Slash"],
    ["~", "Backquote"],
    [":", "Semicolon"],
    ['"', "Quote"],
    ["|", "Backslash"],
    ["<", "Comma"],
    [">", "Period"],
  ])("normalizes shifted %s to the Muda %s key", (key, nativeKey) => {
    expect(
      nativeAccelerator({ key, ctrl: true, shift: true }, true),
    ).toBe(`Ctrl+Shift+${nativeKey}`);
  });

  it("refuses keys the menu cannot register", () => {
    expect(nativeAccelerator({ key: "\u2020", ctrl: true, alt: true }, true)).toBeNull();
    expect(nativeAccelerator({ key: "\u00f6", mod: true }, true)).toBeNull();
    expect(nativeAccelerator({ key: "F13", mod: true }, true)).toBe("Cmd+F13");
    expect(nativeAccelerator({ key: "ArrowUp", mod: true }, false)).toBe("Ctrl+ArrowUp");
    expect(isNativeAcceleratorKey("PageDown")).toBe(true);
    expect(isNativeAcceleratorKey("MediaPlayPause")).toBe(false);
  });

  it("keeps the default menu shortcut when a saved one cannot be registered", async () => {
    useShortcutStore.setState({
      bindings: {
        ...useShortcutStore.getState().bindings,
        toggleTerminal: { key: "\u2020", ctrl: true, alt: true },
      },
    });
    const stop = await startNativeDockShortcutBridge();
    expect(native.invoke).toHaveBeenCalledWith(
      "set_dock_shortcut_accelerators",
      expect.objectContaining({ terminalAccelerator: "Ctrl+`" }),
    );
    stop();
  });

  it("pauses and resumes the menu shortcuts", async () => {
    await pauseNativeShortcuts(true);
    await pauseNativeShortcuts(false);
    expect(native.invoke).toHaveBeenCalledWith("set_native_shortcuts_paused", { paused: true });
    expect(native.invoke).toHaveBeenLastCalledWith("set_native_shortcuts_paused", { paused: false });
  });

  it("uses only the native menu path on Tauri platforms that install the menu", () => {
    expect(usesNativeDockMenu(true, "MacIntel")).toBe(true);
    expect(usesNativeDockMenu(true, "Linux x86_64")).toBe(false);
    expect(usesNativeDockMenu(true, "Win32")).toBe(false);
    expect(usesNativeDockMenu(false, "MacIntel")).toBe(false);
  });

  it("does not install native menu listeners or accelerators on Windows", async () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    const stop = await startNativeDockShortcutBridge();
    expect(native.invoke).not.toHaveBeenCalled();
    expect(native.listeners.size).toBe(0);
    stop();
  });

  it("syncs current and edited dock bindings to the native menu", async () => {
    const stop = await startNativeDockShortcutBridge();

    expect(native.invoke).toHaveBeenLastCalledWith(
      "set_dock_shortcut_accelerators",
      {
        terminalAccelerator: "Ctrl+`",
        browserAccelerator: "Ctrl+Shift+B",
        openFolderAccelerator: "Cmd+Shift+O",
        zenModeAccelerator: "Cmd+Ctrl+Shift+F",
      },
    );

    useShortcutStore.getState().setBinding("toggleBrowser", {
      key: "e",
      ctrl: true,
      shift: true,
    });

    await vi.waitFor(() => {
      expect(native.invoke).toHaveBeenLastCalledWith(
        "set_dock_shortcut_accelerators",
        {
          terminalAccelerator: "Ctrl+`",
          browserAccelerator: "Ctrl+Shift+E",
          openFolderAccelerator: "Cmd+Shift+O",
          zenModeAccelerator: "Cmd+Ctrl+Shift+F",
        },
      );
    });

    useShortcutStore.getState().setBinding("openFolder", { key: "k", mod: true, alt: true });

    await vi.waitFor(() => {
      expect(native.invoke).toHaveBeenLastCalledWith(
        "set_dock_shortcut_accelerators",
        {
          terminalAccelerator: "Ctrl+`",
          browserAccelerator: "Ctrl+Shift+E",
          openFolderAccelerator: "Cmd+Alt+K",
          zenModeAccelerator: "Cmd+Ctrl+Shift+F",
        },
      );
    });

    useShortcutStore.getState().setBinding("toggleZenMode", { key: "z", mod: true, alt: true });

    await vi.waitFor(() => {
      expect(native.invoke).toHaveBeenLastCalledWith(
        "set_dock_shortcut_accelerators",
        {
          terminalAccelerator: "Ctrl+`",
          browserAccelerator: "Ctrl+Shift+E",
          openFolderAccelerator: "Cmd+Alt+K",
          zenModeAccelerator: "Cmd+Alt+Z",
        },
      );
    });
    stop();
  });

  it("serializes the Zen mode shortcut, including a bare function key", () => {
    expect(nativeAccelerator({ key: "f", mod: true, ctrl: true, shift: true }, true)).toBe(
      "Cmd+Ctrl+Shift+F",
    );
    expect(nativeAccelerator({ key: "F11", shift: true }, false)).toBe("Shift+F11");
  });

  it("keeps the default Zen menu shortcut when a saved one cannot be registered", async () => {
    useShortcutStore.setState({
      bindings: {
        ...useShortcutStore.getState().bindings,
        toggleZenMode: { key: "\u2020", ctrl: true, alt: true },
      },
    });
    const stop = await startNativeDockShortcutBridge();
    expect(native.invoke).toHaveBeenCalledWith(
      "set_dock_shortcut_accelerators",
      expect.objectContaining({ zenModeAccelerator: "Cmd+Ctrl+Shift+F" }),
    );
    stop();
  });

  it("turns Zen mode on and off from the native menu event", async () => {
    const stop = await startNativeDockShortcutBridge();
    native.listeners.get("menu://toggle-zen-mode")?.({ payload: null });
    expect(toggleZenMode).toHaveBeenCalledTimes(1);
    stop();
    expect(native.unlisteners).toHaveLength(3);
    expect(native.unlisteners.every((unlisten) => unlisten.mock.calls.length === 1)).toBe(true);
  });

  it("toggles docks from native menu events only while a project is open", async () => {
    const stop = await startNativeDockShortcutBridge();

    native.listeners.get("menu://toggle-terminal")?.({ payload: null });
    native.listeners.get("menu://toggle-browser")?.({ payload: null });
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
    expect(toggleBrowser).toHaveBeenCalledTimes(1);

    native.projectId = null;
    native.listeners.get("menu://toggle-terminal")?.({ payload: null });
    native.listeners.get("menu://toggle-browser")?.({ payload: null });
    // With no project open, neither dock nor the browser responds.
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
    expect(toggleBrowser).toHaveBeenCalledTimes(1);

    stop();
    expect(native.unlisteners).toHaveLength(3);
    expect(native.unlisteners.every((unlisten) => unlisten.mock.calls.length === 1)).toBe(true);
  });

  it("ignores native dock shortcuts while a tour is running", async () => {
    const stop = await startNativeDockShortcutBridge();
    const browserToggles = toggleBrowser.mock.calls.length;
    useTourStore.setState({ activeTourId: "welcome" } as never);
    try {
      native.listeners.get("menu://toggle-terminal")?.({ payload: null });
      native.listeners.get("menu://toggle-browser")?.({ payload: null });
      expect(useSettingsStore.getState().terminalOpen).toBe(false);
      expect(toggleBrowser).toHaveBeenCalledTimes(browserToggles);
    } finally {
      useTourStore.setState({ activeTourId: null } as never);
      stop();
    }
  });
});
