import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "./settings";

const lsValues = new Map<string, string>();

describe("useSettingsStore dock appearance settings", () => {
  beforeAll(() => {
    vi.stubGlobal("localStorage", {
      clear: () => lsValues.clear(),
      getItem: (key: string) => lsValues.get(key) ?? null,
      setItem: (key: string, value: string) => lsValues.set(key, value),
      removeItem: (key: string) => lsValues.delete(key),
    });
  });

  beforeEach(() => {
    lsValues.clear();
  });

  it("defaults dockPlacement to left", () => {
    expect(useSettingsStore.getState().dockPlacement).toBe("left");
  });

  it("setDockPlacement updates state and persists to localStorage", () => {
    useSettingsStore.getState().setDockPlacement("bottom");
    expect(useSettingsStore.getState().dockPlacement).toBe("bottom");
    expect(localStorage.getItem("oleafly.dockPlacement")).toBe("bottom");
    useSettingsStore.getState().setDockPlacement("left");
  });
});
