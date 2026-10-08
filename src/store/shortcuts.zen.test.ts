// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_KEY_DEFINITIONS, sameEditorKey } from "@/store/editor-keymap";

const MAC_ZEN = { key: "f", mod: true, ctrl: true, shift: true };
const OTHER_ZEN = { key: "F11", shift: true };

function setPlatform(value: string) {
  Object.defineProperty(navigator, "platform", { value, configurable: true });
}

async function freshShortcuts() {
  vi.resetModules();
  return import("./shortcuts");
}

function keyboard(key: string, options: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...options,
  } as KeyboardEvent;
}

describe("Toggle Zen mode shortcut", () => {
  const originalPlatform = navigator.platform;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it("is a rebindable application shortcut", async () => {
    const { SHORTCUT_DEFINITIONS, useShortcutStore } = await freshShortcuts();
    expect(SHORTCUT_DEFINITIONS.map(({ id }) => id)).toContain("toggleZenMode");
    useShortcutStore.getState().setBinding("toggleZenMode", { key: "z", mod: true, alt: true });
    expect(useShortcutStore.getState().bindings.toggleZenMode).toEqual({
      key: "z",
      mod: true,
      alt: true,
    });
    useShortcutStore.getState().resetBinding("toggleZenMode");
    expect(useShortcutStore.getState().bindings.toggleZenMode).not.toEqual({
      key: "z",
      mod: true,
      alt: true,
    });
  });

  it("defaults to Ctrl+Cmd+Shift+F on macOS", async () => {
    setPlatform("MacIntel");
    const { useShortcutStore, shortcutLabel } = await freshShortcuts();
    const binding = useShortcutStore.getState().bindings.toggleZenMode;
    expect(binding).toEqual(MAC_ZEN);
    expect(shortcutLabel(binding)).toBe("⌘Ctrl⇧F");
  });

  it.each(["Win32", "Linux x86_64"])("defaults to Shift+F11 on %s", async (platform) => {
    setPlatform(platform);
    const { useShortcutStore, shortcutLabel } = await freshShortcuts();
    const binding = useShortcutStore.getState().bindings.toggleZenMode;
    expect(binding).toEqual(OTHER_ZEN);
    expect(shortcutLabel(binding)).toBe("Shift+F11");
  });

  it("matches its own key event and no neighbouring chord", async () => {
    setPlatform("Win32");
    const { matchesShortcut } = await freshShortcuts();
    expect(matchesShortcut(keyboard("F11", { shiftKey: true }), OTHER_ZEN)).toBe(true);
    expect(matchesShortcut(keyboard("F11"), OTHER_ZEN)).toBe(false);
    expect(matchesShortcut(keyboard("F11", { shiftKey: true, ctrlKey: true }), OTHER_ZEN)).toBe(
      false,
    );
    setPlatform("MacIntel");
    expect(
      matchesShortcut(keyboard("F", { shiftKey: true, ctrlKey: true, metaKey: true }), MAC_ZEN),
    ).toBe(true);
    expect(matchesShortcut(keyboard("F", { shiftKey: true, metaKey: true }), MAC_ZEN)).toBe(false);
  });

  it("keeps the function key default after another shortcut is saved", async () => {
    setPlatform("Win32");
    const first = await freshShortcuts();
    first.useShortcutStore.getState().setBinding("toggleTerminal", { key: "t", ctrl: true });
    const second = await freshShortcuts();
    expect(second.useShortcutStore.getState().bindings.toggleZenMode).toEqual(OTHER_ZEN);
    expect(second.useShortcutStore.getState().bindings.toggleTerminal).toEqual({
      key: "t",
      ctrl: true,
    });
  });

  it("restores a chosen binding after a reload", async () => {
    setPlatform("Win32");
    const first = await freshShortcuts();
    first.useShortcutStore.getState().setBinding("toggleZenMode", { key: "z", mod: true, alt: true });
    const second = await freshShortcuts();
    expect(second.useShortcutStore.getState().bindings.toggleZenMode).toEqual({
      key: "z",
      mod: true,
      alt: true,
    });
  });

  it("records a function key with or without a modifier", async () => {
    setPlatform("Win32");
    const { bindingFromEvent } = await freshShortcuts();
    expect(bindingFromEvent(keyboard("F11", { shiftKey: true }))).toEqual({
      key: "F11",
      shift: true,
      alt: false,
    });
    expect(bindingFromEvent(keyboard("F9"))).toEqual({ key: "F9", shift: false, alt: false });
    expect(bindingFromEvent(keyboard("g"))).toBeNull();
    expect(bindingFromEvent(keyboard("F25"))).toBeNull();
  });

  it.each(["MacIntel", "Win32", "Linux x86_64"])(
    "collides with no other application shortcut or editor key on %s",
    async (platform) => {
      setPlatform(platform);
      const { SHORTCUT_DEFINITIONS, sameShortcutBinding } = await freshShortcuts();
      const zen = SHORTCUT_DEFINITIONS.find(({ id }) => id === "toggleZenMode");
      expect(zen).toBeDefined();
      const clashes = SHORTCUT_DEFINITIONS.filter(
        ({ id, defaultBinding }) =>
          id !== "toggleZenMode" && sameShortcutBinding(defaultBinding, zen?.defaultBinding ?? OTHER_ZEN),
      );
      expect(clashes).toEqual([]);
      const mac = platform === "MacIntel";
      const candidate = mac ? "Cmd-Ctrl-Shift-f" : "Shift-F11";
      const editorClash = EDITOR_KEY_DEFINITIONS.filter(({ defaultKey }) =>
        sameEditorKey(defaultKey, candidate),
      );
      expect(editorClash).toEqual([]);
    },
  );
});
