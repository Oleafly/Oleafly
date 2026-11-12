// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_KEY_DEFINITIONS, sameEditorKey } from "@/store/editor-keymap";
import type { ShortcutBinding } from "./shortcuts";

const originalPlatform = navigator.platform;
const SPLIT_BY_PLATFORM = [
  "notesLocalGraph",
  "notesOutline",
  "notesNewNote",
  "notesSearch",
  "notesBookmark",
  "notesCopyLink",
  "notesProperties",
  "notesBack",
  "notesForward",
] as const;
const WEBVIEW_AND_DESKTOP_CHORDS = ["c", "e", "i", "j", "p", "r", "u", "v"];

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

function usPress(binding: ShortcutBinding): KeyboardEvent {
  const key = binding.shift ? binding.key.toUpperCase() : binding.key;
  const code = binding.key.length === 1 ? `Key${binding.key.toUpperCase()}` : binding.key;
  return press({ key, code, ctrlKey: Boolean(binding.mod || binding.ctrl), shiftKey: Boolean(binding.shift), altKey: Boolean(binding.alt) });
}

function editorKey(binding: ShortcutBinding): string {
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

describe("default keys for the Notes shortcuts", () => {
  it("keeps Cmd+Option on macOS", async () => {
    setPlatform("MacIntel");
    const { useShortcutStore } = await freshShortcuts();
    const { bindings } = useShortcutStore.getState();
    expect(bindings.notesLocalGraph).toEqual({ key: "g", mod: true, alt: true });
    expect(bindings.notesOutline).toEqual({ key: "o", mod: true, alt: true });
    expect(bindings.notesNewNote).toEqual({ key: "n", mod: true, alt: true });
    expect(bindings.notesSearch).toEqual({ key: "f", mod: true, alt: true });
    expect(bindings.notesBookmark).toEqual({ key: "b", mod: true, alt: true });
    expect(bindings.notesCopyLink).toEqual({ key: "l", mod: true, alt: true });
    expect(bindings.notesProperties).toEqual({ key: "i", mod: true, alt: true });
    expect(bindings.notesBack).toEqual({ key: "[", mod: true });
    expect(bindings.notesForward).toEqual({ key: "]", mod: true });
  });

  it.each(["Win32", "Linux x86_64"])("uses Ctrl+Shift instead of Ctrl+Alt on %s", async (platform) => {
    setPlatform(platform);
    const { matchesShortcut, useShortcutStore } = await freshShortcuts();
    const { bindings } = useShortcutStore.getState();
    expect(bindings.notesLocalGraph).toEqual({ key: "m", mod: true, shift: true });
    expect(bindings.notesOutline).toEqual({ key: "k", mod: true, shift: true });
    expect(bindings.notesNewNote).toEqual({ key: "n", mod: true, shift: true });
    expect(bindings.notesSearch).toEqual({ key: "a", mod: true, shift: true });
    expect(bindings.notesBookmark).toEqual({ key: "y", mod: true, shift: true });
    expect(bindings.notesCopyLink).toEqual({ key: "x", mod: true, shift: true });
    expect(bindings.notesProperties).toEqual({ key: "t", mod: true, shift: true });
    expect(bindings.notesBack).toEqual({ key: "ArrowLeft", alt: true });
    expect(bindings.notesForward).toEqual({ key: "ArrowRight", alt: true });
    for (const id of SPLIT_BY_PLATFORM) expect(matchesShortcut(usPress(bindings[id]), bindings[id]), id).toBe(true);
  });

  it.each(["MacIntel", "Win32", "Linux x86_64"])("gives every Notes shortcut a default that clashes with nothing on %s", async (platform) => {
    setPlatform(platform);
    const { SHORTCUT_DEFINITIONS, reservedShortcutAction, sameShortcutBinding } = await freshShortcuts();
    const apple = platform === "MacIntel";
    const notes = SHORTCUT_DEFINITIONS.filter(({ scope }) => scope === "notes");
    expect(notes.length).toBeGreaterThan(0);
    for (const { id, defaultBinding: binding } of notes) {
      const clashes = SHORTCUT_DEFINITIONS.filter((other) => other.id !== id && sameShortcutBinding(other.defaultBinding, binding));
      expect(clashes.map((other) => other.id), id).toEqual([]);
      expect(reservedShortcutAction(binding), id).toBeNull();
      if (apple) continue;
      expect(Boolean(binding.alt && /^[a-z0-9]$/u.test(binding.key)), `${id} uses Ctrl+Alt`).toBe(false);
      expect(Boolean(binding.shift && WEBVIEW_AND_DESKTOP_CHORDS.includes(binding.key)), `${id} uses a WebView or desktop chord`).toBe(false);
    }
    for (const id of SPLIT_BY_PLATFORM) {
      const binding = notes.find((definition) => definition.id === id)?.defaultBinding;
      expect(binding, id).toBeDefined();
      if (!binding) continue;
      expect(EDITOR_KEY_DEFINITIONS.filter(({ defaultKey }) => sameEditorKey(defaultKey, editorKey(binding))), id).toEqual([]);
    }
  });

  it("never fires for a character typed with AltGr on Windows", async () => {
    setPlatform("Win32");
    const { SHORTCUT_DEFINITIONS, matchesShortcut, useShortcutStore } = await freshShortcuts();
    const { bindings } = useShortcutStore.getState();
    const altGr = [
      press({ key: "ó", code: "KeyO", ctrlKey: true, altKey: true, altGraph: true }),
      press({ key: "ł", code: "KeyL", ctrlKey: true, altKey: true, altGraph: true }),
      press({ key: "ń", code: "KeyN", ctrlKey: true, altKey: true, altGraph: true }),
      press({ key: "{", code: "KeyB", ctrlKey: true, altKey: true, altGraph: true }),
      press({ key: "[", code: "KeyF", ctrlKey: true, altKey: true, altGraph: true }),
    ];
    for (const event of altGr) {
      expect(SHORTCUT_DEFINITIONS.filter(({ id }) => matchesShortcut(event, bindings[id])).map(({ id }) => id), event.key).toEqual([]);
    }
  });

  it("leaves saved bindings as they were, including a saved Ctrl+Alt one", async () => {
    setPlatform("Win32");
    localStorage.setItem(
      "oleafly.shortcuts",
      JSON.stringify({
        notesLocalGraph: { key: "g", mod: true, alt: true },
        notesCopyLink: { key: "l", mod: true, alt: true },
        notesOutline: { key: "u", mod: true },
      }),
    );
    const { useShortcutStore } = await freshShortcuts();
    const { bindings } = useShortcutStore.getState();
    expect(bindings.notesLocalGraph).toEqual({ key: "g", mod: true, alt: true });
    expect(bindings.notesCopyLink).toEqual({ key: "l", mod: true, alt: true });
    expect(bindings.notesOutline).toEqual({ key: "u", mod: true });
    useShortcutStore.getState().resetBinding("notesLocalGraph");
    useShortcutStore.getState().resetBinding("notesCopyLink");
    expect(useShortcutStore.getState().bindings.notesLocalGraph).toEqual({ key: "m", mod: true, shift: true });
    expect(useShortcutStore.getState().bindings.notesCopyLink).toEqual({ key: "x", mod: true, shift: true });
    expect(useShortcutStore.getState().bindings.notesOutline).toEqual({ key: "u", mod: true });
  });
});
