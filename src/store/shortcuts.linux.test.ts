// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LINUX_BROWSER = { key: "b", ctrl: true, alt: true };
const OLD_BROWSER = { key: "b", ctrl: true, shift: true };

function setPlatform(value: string) {
  Object.defineProperty(navigator, "platform", { value, configurable: true });
}

async function freshStore() {
  vi.resetModules();
  const { useShortcutStore } = await import("./shortcuts");
  return useShortcutStore.getState().bindings;
}

describe("Toggle Browser default on Linux", () => {
  const originalPlatform = navigator.platform;

  beforeEach(() => {
    localStorage.clear();
    setPlatform("Linux x86_64");
    Object.assign(globalThis, { isTauri: true });
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    Reflect.deleteProperty(globalThis, "isTauri");
  });

  it("uses Ctrl+Alt+B so Ctrl+Shift+B stays with the visual editor's blockquote", async () => {
    expect((await freshStore()).toggleBrowser).toEqual(LINUX_BROWSER);
  });

  it("moves a saved old default and keeps every other saved choice", async () => {
    localStorage.setItem(
      "oleafly.shortcuts",
      JSON.stringify({ toggleBrowser: OLD_BROWSER, toggleTerminal: { key: "t", ctrl: true } }),
    );
    const bindings = await freshStore();
    expect(bindings.toggleBrowser).toEqual(LINUX_BROWSER);
    expect(bindings.toggleTerminal).toEqual({ key: "t", ctrl: true });

    localStorage.setItem(
      "oleafly.shortcuts",
      JSON.stringify({ toggleBrowser: { key: "y", ctrl: true, shift: true } }),
    );
    expect((await freshStore()).toggleBrowser).toEqual({ key: "y", ctrl: true, shift: true });
  });

  it("keeps Ctrl+Shift+B on macOS and Windows", async () => {
    for (const platform of ["MacIntel", "Win32"]) {
      setPlatform(platform);
      localStorage.clear();
      expect((await freshStore()).toggleBrowser).toEqual(OLD_BROWSER);
    }
  });
});
