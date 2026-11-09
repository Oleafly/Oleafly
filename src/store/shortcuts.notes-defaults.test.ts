// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_KEY_DEFINITIONS, sameEditorKey } from "@/store/editor-keymap";

const NOTE_PANELS = ["notesLocalGraph", "notesOutline"] as const;
const originalPlatform = navigator.platform;

function setPlatform(value: string) {
  Object.defineProperty(navigator, "platform", { value, configurable: true });
}

async function freshShortcuts() {
  vi.resetModules();
  return import("./shortcuts");
}

function press(init: KeyboardEventInit & { altGraph?: boolean }): KeyboardEvent {
  const event = new KeyboardEvent("keydown", init);
  Object.defineProperty(event, "getModifierState", { value: (name: string) => name === "AltGraph" && Boolean(init.altGraph) });
  return event;
}

function editorKey(binding: { key: string; mod?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean }): string {
  return [binding.mod && "Mod", binding.ctrl && "Ctrl", binding.alt && "Alt", binding.shift && "Shift", binding.key]
    .filter(Boolean)
    .join("-");
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  setPlatform(originalPlatform);
});

describe("default keys for the local graph and outline panels", () => {
  it("keeps Cmd+Option+G and Cmd+Option+O on macOS", async () => {
    setPlatform("MacIntel");
    const { useShortcutStore } = await freshShortcuts();
    const { bindings } = useShortcutStore.getState();
    expect(bindings.notesLocalGraph).toEqual({ key: "g", mod: true, alt: true });
    expect(bindings.notesOutline).toEqual({ key: "o", mod: true, alt: true });
  });

  it.each(["Win32", "Linux x86_64"])("avoids Ctrl+Alt, which Windows layouts type as AltGr, on %s", async (platform) => {
    setPlatform(platform);
    const { SHORTCUT_DEFINITIONS, matchesShortcut, sameShortcutBinding, useShortcutStore } = await freshShortcuts();
    const { bindings } = useShortcutStore.getState();
    expect(bindings.notesLocalGraph).toEqual({ key: "m", mod: true, shift: true });
    expect(bindings.notesOutline).toEqual({ key: "k", mod: true, shift: true });
    for (const id of NOTE_PANELS) {
      const binding = bindings[id];
      expect(binding.alt).toBeFalsy();
      const clashes = SHORTCUT_DEFINITIONS.filter(
        (other) => other.id !== id && sameShortcutBinding(other.defaultBinding, binding),
      );
      expect(clashes).toEqual([]);
      expect(EDITOR_KEY_DEFINITIONS.filter(({ defaultKey }) => sameEditorKey(defaultKey, editorKey(binding)))).toEqual([]);
    }
    expect(matchesShortcut(press({ key: "M", code: "KeyM", ctrlKey: true, shiftKey: true }), bindings.notesLocalGraph)).toBe(true);
    expect(matchesShortcut(press({ key: "K", code: "KeyK", ctrlKey: true, shiftKey: true }), bindings.notesOutline)).toBe(true);
    const polishO = press({ key: "ó", code: "KeyO", ctrlKey: true, altKey: true, altGraph: true });
    expect(SHORTCUT_DEFINITIONS.some(({ id }) => matchesShortcut(polishO, bindings[id]))).toBe(false);
  });

  it("leaves saved bindings as they were, including a saved Ctrl+Alt one", async () => {
    setPlatform("Win32");
    localStorage.setItem(
      "oleafly.shortcuts",
      JSON.stringify({
        notesLocalGraph: { key: "g", mod: true, alt: true },
        notesOutline: { key: "u", mod: true },
      }),
    );
    const { useShortcutStore } = await freshShortcuts();
    const { bindings } = useShortcutStore.getState();
    expect(bindings.notesLocalGraph).toEqual({ key: "g", mod: true, alt: true });
    expect(bindings.notesOutline).toEqual({ key: "u", mod: true });
    useShortcutStore.getState().resetBinding("notesLocalGraph");
    expect(useShortcutStore.getState().bindings.notesLocalGraph).toEqual({ key: "m", mod: true, shift: true });
    expect(useShortcutStore.getState().bindings.notesOutline).toEqual({ key: "u", mod: true });
  });
});
