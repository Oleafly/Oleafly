import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings";
import { useShortcutStore } from "@/store/shortcuts";
import { handleDockShortcut } from "./dock-shortcuts";

function keyboard(
  key: string,
  modifiers: Partial<Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey" | "altKey">> = {},
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
    useSettingsStore.setState({ terminalOpen: false, browserOpen: false });
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

  it("toggles the browser with fixed Ctrl+Shift+B", () => {
    const event = keyboard("b", {
      ctrlKey: true,
      shiftKey: true,
    });

    expect(handleDockShortcut(event)).toBe(true);
    expect(useSettingsStore.getState()).toMatchObject({
      terminalOpen: false,
      browserOpen: true,
    });
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
