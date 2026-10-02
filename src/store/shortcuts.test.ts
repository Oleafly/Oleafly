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

const altGraph = (key: string) => key === "AltGraph";

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
    const originalNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", { platform: "Linux x86_64" });
    try {
      const { bindingFromEvent, sameShortcutBinding } = await import(
        "@/store/shortcuts"
      );

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
    } finally {
      vi.stubGlobal("navigator", originalNavigator);
    }
  });

  it("records macOS Ctrl as a fixed modifier", async () => {
    const originalNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    try {
      const { bindingFromEvent } = await import("@/store/shortcuts");

      expect(bindingFromEvent(keyboard("`", { ctrlKey: true }))).toEqual({
        key: "`",
        ctrl: true,
        shift: false,
        alt: false,
      });
    } finally {
      vi.stubGlobal("navigator", originalNavigator);
    }
  });

  it("ignores characters typed through AltGr on Windows", async () => {
    const originalNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", { platform: "Win32" });
    try {
      const { bindingFromEvent } = await import("@/store/shortcuts");
      // Engines that report AltGr as Ctrl+Alt.
      const altGr = { ctrlKey: true, altKey: true, getModifierState: altGraph };

      expect(bindingFromEvent(keyboard("@", altGr))).toBeNull();
      expect(bindingFromEvent(keyboard("{", altGr))).toBeNull();
      // WebView2 clears Ctrl and Alt, so Ctrl held with AltGr carries Ctrl only.
      expect(
        bindingFromEvent(keyboard("@", { ctrlKey: true, getModifierState: altGraph })),
      ).toBeNull();
      // Ctrl with an accent key such as ^ on a French layout.
      expect(bindingFromEvent(keyboard("Dead", { ctrlKey: true }))).toBeNull();
      expect(bindingFromEvent(keyboard("q", { ctrlKey: true, altKey: true }))).toEqual({
        key: "q",
        mod: true,
        shift: false,
        alt: true,
      });
    } finally {
      vi.stubGlobal("navigator", originalNavigator);
    }
  });

  it("ignores AltGr, layout switching and other non-keys held with Ctrl on Linux", async () => {
    const originalNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", { platform: "Linux x86_64" });
    try {
      const { bindingFromEvent } = await import("@/store/shortcuts");

      expect(bindingFromEvent(keyboard("AltGraph", { ctrlKey: true }))).toBeNull();
      expect(bindingFromEvent(keyboard("GroupNext", { ctrlKey: true }))).toBeNull();
      expect(
        bindingFromEvent(keyboard("GroupNext", { ctrlKey: true, altKey: true })),
      ).toBeNull();
      expect(bindingFromEvent(keyboard("Super", { ctrlKey: true }))).toBeNull();
      expect(bindingFromEvent(keyboard("Compose", { ctrlKey: true }))).toBeNull();
      expect(bindingFromEvent(keyboard("@", { getModifierState: altGraph }))).toBeNull();
      expect(bindingFromEvent(keyboard("Dead", { ctrlKey: true }))).toBeNull();
      expect(bindingFromEvent(keyboard("Unidentified", { ctrlKey: true }))).toBeNull();
      expect(bindingFromEvent(keyboard("Process", { ctrlKey: true }))).toBeNull();
    } finally {
      vi.stubGlobal("navigator", originalNavigator);
    }
  });

  it("never matches a character typed through AltGr on Windows", async () => {
    const originalNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", { platform: "Win32" });
    try {
      const { matchesShortcut } = await import("@/store/shortcuts");

      expect(
        matchesShortcut(
          keyboard("@", { ctrlKey: true, altKey: true, getModifierState: altGraph }),
          { key: "@", mod: true, alt: true },
        ),
      ).toBe(false);
      expect(
        matchesShortcut(keyboard("@", { ctrlKey: true, getModifierState: altGraph }), {
          key: "@",
          mod: true,
        }),
      ).toBe(false);
      expect(
        matchesShortcut(keyboard("q", { ctrlKey: true, altKey: true }), {
          key: "q",
          mod: true,
          alt: true,
        }),
      ).toBe(true);
    } finally {
      vi.stubGlobal("navigator", originalNavigator);
    }
  });

  it("records and matches Ctrl with AltGr on Linux, where it types nothing", async () => {
    const originalNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", { platform: "Linux x86_64" });
    try {
      const { bindingFromEvent, matchesShortcut } = await import("@/store/shortcuts");
      // Ctrl+AltGr+9 on a German layout. WebKitGTK reports AltGraph from 2.54
      // and leaves it out before that.
      const webKit254 = keyboard("]", { ctrlKey: true, getModifierState: altGraph });
      const webKit252 = keyboard("]", { ctrlKey: true });

      for (const event of [webKit254, webKit252]) {
        expect(bindingFromEvent(event)).toEqual({
          key: "]",
          mod: true,
          shift: false,
          alt: false,
        });
        expect(matchesShortcut(event, { key: "]", mod: true })).toBe(true);
      }
    } finally {
      vi.stubGlobal("navigator", originalNavigator);
    }
  });

  it("still records macOS Option characters with Cmd", async () => {
    const originalNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    try {
      const { bindingFromEvent } = await import("@/store/shortcuts");

      expect(bindingFromEvent(keyboard("@", { metaKey: true, altKey: true }))).toEqual({
        key: "@",
        mod: true,
        shift: false,
        alt: true,
      });
    } finally {
      vi.stubGlobal("navigator", originalNavigator);
    }
  });

  it("keeps fixed Ctrl distinct from the macOS platform modifier", async () => {
    const originalNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    try {
      const { matchesShortcut, sameShortcutBinding } = await import(
        "@/store/shortcuts"
      );

      expect(
        matchesShortcut(keyboard("`", { ctrlKey: true }), {
          key: "`",
          ctrl: true,
        }),
      ).toBe(true);
      expect(
        matchesShortcut(keyboard("`", { metaKey: true }), {
          key: "`",
          ctrl: true,
        }),
      ).toBe(false);
      expect(
        sameShortcutBinding(
          { key: "`", ctrl: true },
          { key: "`", mod: true },
        ),
      ).toBe(false);
    } finally {
      vi.stubGlobal("navigator", originalNavigator);
    }
  });

  it("registers unused dock toggle defaults", async () => {
    const { SHORTCUT_DEFINITIONS, useShortcutStore } = await import(
      "@/store/shortcuts"
    );

    expect(useShortcutStore.getState().bindings.toggleTerminal).toEqual({
      key: "`",
      ctrl: true,
    });
    expect(useShortcutStore.getState().bindings.toggleBrowser).toEqual({
      key: "b",
      ctrl: true,
      shift: true,
    });
    expect(
      SHORTCUT_DEFINITIONS.map(({ id }) => id).filter((id) =>
        ["toggleTerminal", "toggleBrowser"].includes(id),
      ),
    ).toEqual(["toggleTerminal", "toggleBrowser"]);
  });

  it("opens a folder with Cmd or Ctrl+Shift+O by default, without clashing with another action", async () => {
    const { SHORTCUT_DEFINITIONS, sameShortcutBinding, useShortcutStore } = await import(
      "@/store/shortcuts"
    );
    const openFolder = useShortcutStore.getState().bindings.openFolder;

    expect(openFolder).toEqual({ key: "o", mod: true, shift: true });
    expect(
      SHORTCUT_DEFINITIONS.filter(({ id, defaultBinding }) =>
        id !== "openFolder" && sameShortcutBinding(defaultBinding, openFolder),
      ),
    ).toEqual([]);
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

  it("tells when any binding differs from its default", async () => {
    const { shortcutsDifferFromDefaults, useShortcutStore } = await import("@/store/shortcuts");
    const differs = () => shortcutsDifferFromDefaults(useShortcutStore.getState().bindings);
    expect(differs()).toBe(false);

    useShortcutStore.getState().setBinding("recompile", { key: "r", mod: true });
    expect(differs()).toBe(true);

    useShortcutStore.getState().resetAll();
    expect(differs()).toBe(false);
  });

  it("merges stored bindings with defaults and survives malformed storage", async () => {
    localStorage.setItem(
      "oleafly.shortcuts",
      JSON.stringify({ commandPalette: { key: "p", mod: true } }),
    );
    const stored = await import("@/store/shortcuts");
    expect(stored.useShortcutStore.getState().bindings.commandPalette.key).toBe("p");
    expect(stored.useShortcutStore.getState().bindings.recompile.key).toBe("Enter");
    expect(stored.useShortcutStore.getState().bindings.toggleTerminal).toEqual({
      key: "`",
      ctrl: true,
    });
    expect(stored.useShortcutStore.getState().bindings.toggleBrowser).toEqual({
      key: "b",
      ctrl: true,
      shift: true,
    });

    vi.resetModules();
    localStorage.setItem("oleafly.shortcuts", "{");
    const malformed = await import("@/store/shortcuts");
    expect(malformed.useShortcutStore.getState().bindings.commandPalette.key).toBe("k");
  });

  it("falls back to the default for a stored binding the recorder cannot produce", async () => {
    localStorage.setItem(
      "oleafly.shortcuts",
      JSON.stringify({
        commandPalette: { key: "AltGraph", mod: true },
        searchDocuments: { key: "GroupNext", mod: true },
        recompile: { key: "k" },
        forwardSync: { key: "y", mod: true, shift: true },
        toggleTerminal: { key: "t", ctrl: true },
      }),
    );
    const { useShortcutStore } = await import("@/store/shortcuts");
    const bindings = useShortcutStore.getState().bindings;

    expect(bindings.commandPalette).toEqual({ key: "k", mod: true });
    expect(bindings.searchDocuments).toEqual({ key: "f", mod: true, shift: true });
    expect(bindings.recompile).toEqual({ key: "Enter", mod: true });
    expect(bindings.forwardSync).toEqual({ key: "y", mod: true, shift: true });
    expect(bindings.toggleTerminal).toEqual({ key: "t", ctrl: true });
  });

  it("rejects operating-system chords that would shadow core editing", async () => {
    const { reservedShortcutAction } = await import("@/store/shortcuts");
    expect(reservedShortcutAction({ key: "a", mod: true })).toBe("selectAll");
    expect(reservedShortcutAction({ key: "v", mod: true })).toBe("paste");
    expect(reservedShortcutAction({ key: "s", mod: true })).toBe("save");
    expect(reservedShortcutAction({ key: "k", mod: true })).toBeNull();
    expect(reservedShortcutAction({ key: "s", mod: true, shift: true })).toBeNull();
  });

  it("leaves Hide and Minimize free where the menu has no such items", async () => {
    const originalNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", { platform: "Win32" });
    try {
      const { reservedShortcutAction } = await import("@/store/shortcuts");
      expect(reservedShortcutAction({ key: "h", mod: true })).toBeNull();
      expect(reservedShortcutAction({ key: "m", mod: true })).toBeNull();
    } finally {
      vi.stubGlobal("navigator", originalNavigator);
    }
  });

  it("reserves the macOS window switching shortcut", async () => {
    const originalNavigator = globalThis.navigator;
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    try {
      const { reservedShortcutAction } = await import("@/store/shortcuts");
      expect(reservedShortcutAction({ key: "`", mod: true })).toBe("windowSwitching");
      expect(reservedShortcutAction({ key: "`", ctrl: true })).toBeNull();
      expect(reservedShortcutAction({ key: "h", mod: true })).toBe("hide");
      expect(reservedShortcutAction({ key: "m", mod: true })).toBe("minimize");
    } finally {
      vi.stubGlobal("navigator", originalNavigator);
    }
  });
});
