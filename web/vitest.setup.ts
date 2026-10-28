import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { initializeWebI18n } from "./src/i18n";
import { installPackageMessages } from "./src/i18n/packages";
import { resetWebState } from "./src/store";

await initializeWebI18n();
installPackageMessages();

if (!globalThis.localStorage) {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage);
}

if (typeof ResizeObserver === "undefined") {
  function noop() {}
  function resizeObserverStub() {
    return { observe: noop, unobserve: noop, disconnect: noop };
  }
  (globalThis as Record<string, unknown>).ResizeObserver = resizeObserverStub;
}

if (typeof window.matchMedia !== "function") {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

afterEach(() => {
  cleanup();
  resetWebState();
});
