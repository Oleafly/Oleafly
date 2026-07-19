import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const values = new Map<string, string>();

function keyboard(
  key: string,
  options: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...options,
  } as KeyboardEvent;
}

describe("shortcut bindings", () => {
  beforeAll(() => {
    vi.stubGlobal("localStorage", {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });

  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("matches platform modifier shortcuts exactly", async () => {
    const { matchesShortcut } = await import("@/store/shortcuts");
    const apple = /Mac|iPhone|iPad/.test(navigator.platform);
    const event = keyboard("K", apple ? { metaKey: true } : { ctrlKey: true });

    expect(matchesShortcut(event, { key: "k", mod: true })).toBe(true);
    expect(matchesShortcut(event, { key: "k", mod: true, shift: true })).toBe(false);
    expect(matchesShortcut(event, { key: "k" })).toBe(false);
  });

  it("records non-modifier keys and ignores modifier-only presses", async () => {
    const { bindingFromEvent, sameShortcutBinding } = await import("@/store/shortcuts");

    expect(bindingFromEvent(keyboard("Shift"))).toBeNull();
    expect(bindingFromEvent(keyboard("g"))).toBeNull();
    expect(bindingFromEvent(keyboard("Tab", { metaKey: true }))).toBeNull();
    expect(bindingFromEvent(keyboard("Escape", { metaKey: true }))).toBeNull();
    expect(
      bindingFromEvent(
        keyboard("J", {
          ctrlKey: true,
          shiftKey: true,
          altKey: true,
        }),
      ),
    ).toEqual({
      key: "j",
      mod: true,
      shift: true,
      alt: true,
    });
    expect(
      sameShortcutBinding(
        { key: "b", mod: true },
        { key: "B", mod: true, shift: false, alt: false },
      ),
    ).toBe(true);
  });

  it("persists edits and restores individual and global defaults", async () => {
    const { useShortcutStore } = await import("@/store/shortcuts");

    useShortcutStore.getState().setBinding("commandPalette", {
      key: "p",
      mod: true,
      alt: true,
    });
    expect(JSON.parse(localStorage.getItem("oleafly.shortcuts") ?? "{}").commandPalette).toEqual({
      key: "p",
      mod: true,
      alt: true,
    });

    useShortcutStore.getState().resetBinding("commandPalette");
    expect(useShortcutStore.getState().bindings.commandPalette).toEqual({
      key: "k",
      mod: true,
    });

    useShortcutStore.getState().setBinding("recompile", { key: "r", mod: true });
    useShortcutStore.getState().resetAll();
    expect(useShortcutStore.getState().bindings.recompile).toEqual({
      key: "Enter",
      mod: true,
    });
  });

  it("merges stored bindings with defaults and survives malformed storage", async () => {
    localStorage.setItem(
      "oleafly.shortcuts",
      JSON.stringify({ commandPalette: { key: "p", mod: true } }),
    );
    const stored = await import("@/store/shortcuts");
    expect(stored.useShortcutStore.getState().bindings.commandPalette.key).toBe("p");
    expect(stored.useShortcutStore.getState().bindings.recompile.key).toBe("Enter");

    vi.resetModules();
    localStorage.setItem("oleafly.shortcuts", "{");
    const malformed = await import("@/store/shortcuts");
    expect(malformed.useShortcutStore.getState().bindings.commandPalette.key).toBe("k");
  });

  it("rejects operating-system chords that would shadow core editing", async () => {
    const { reservedShortcutLabel } = await import("@/store/shortcuts");
    expect(reservedShortcutLabel({ key: "a", mod: true })).toBe("Select all");
    expect(reservedShortcutLabel({ key: "v", mod: true })).toBe("Paste");
    expect(reservedShortcutLabel({ key: "s", mod: true })).toBe("Save");
    expect(reservedShortcutLabel({ key: "k", mod: true })).toBeNull();
    expect(reservedShortcutLabel({ key: "s", mod: true, shift: true })).toBeNull();
  });
});
