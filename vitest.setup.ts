import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(cleanup);

if (typeof localStorage === "undefined") {
  const lsValues = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => lsValues.get(key) ?? null,
    setItem: (key: string, value: string) => lsValues.set(key, value),
    removeItem: (key: string) => lsValues.delete(key),
    clear: () => lsValues.clear(),
    key: (index: number) => Array.from(lsValues.keys())[index] ?? null,
    get length() {
      return lsValues.size;
    },
  } as Storage);
}
