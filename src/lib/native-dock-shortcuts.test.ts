import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings";
import { useShortcutStore } from "@/store/shortcuts";

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
  nativeAccelerator,
  startNativeDockShortcutBridge,
  usesNativeDockMenu,
} from "./native-dock-shortcuts";

describe("native dock shortcuts", () => {
  beforeEach(() => {
    native.invoke.mockClear();
    native.listeners.clear();
    native.projectId = "project-1";
    native.unlisteners = [];
    useSettingsStore.setState({ terminalOpen: false, browserOpen: false, webBrowser: true });
    useShortcutStore.getState().resetAll();
  });

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

  it("uses only the native menu path on Tauri platforms that install the menu", () => {
    expect(usesNativeDockMenu(true, "MacIntel")).toBe(true);
    expect(usesNativeDockMenu(true, "Linux x86_64")).toBe(true);
    expect(usesNativeDockMenu(true, "Win32")).toBe(false);
    expect(usesNativeDockMenu(false, "MacIntel")).toBe(false);
  });

  it("syncs current and edited dock bindings to the native menu", async () => {
    const stop = await startNativeDockShortcutBridge();

    expect(native.invoke).toHaveBeenLastCalledWith(
      "set_dock_shortcut_accelerators",
      {
        terminalAccelerator: "Ctrl+`",
        browserAccelerator: "Ctrl+Shift+B",
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
        },
      );
    });
    stop();
  });

  it("toggles docks from native menu events only while a project is open", async () => {
    const stop = await startNativeDockShortcutBridge();

    native.listeners.get("menu://toggle-terminal")?.({ payload: null });
    native.listeners.get("menu://toggle-browser")?.({ payload: null });
    expect(useSettingsStore.getState()).toMatchObject({
      terminalOpen: true,
      browserOpen: true,
    });

    native.projectId = null;
    native.listeners.get("menu://toggle-terminal")?.({ payload: null });
    native.listeners.get("menu://toggle-browser")?.({ payload: null });
    expect(useSettingsStore.getState()).toMatchObject({
      terminalOpen: true,
      browserOpen: true,
    });

    stop();
    expect(native.unlisteners).toHaveLength(2);
    expect(native.unlisteners.every((unlisten) => unlisten.mock.calls.length === 1)).toBe(true);
  });
});
