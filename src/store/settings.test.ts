import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "./settings";

const lsValues = new Map<string, string>();

describe("useSettingsStore dock/glass appearance settings", () => {
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

  it("defaults dockPlacement to left and dashboardGlass to ambient", () => {
    expect(useSettingsStore.getState().dockPlacement).toBe("left");
    expect(useSettingsStore.getState().dashboardGlass).toBe("ambient");
  });

  it("setDockPlacement updates state and persists to localStorage", () => {
    useSettingsStore.getState().setDockPlacement("bottom");
    expect(useSettingsStore.getState().dockPlacement).toBe("bottom");
    expect(localStorage.getItem("oleafly.dockPlacement")).toBe("bottom");
    useSettingsStore.getState().setDockPlacement("left");
  });

  it("setDashboardGlass updates state and persists to localStorage", () => {
    useSettingsStore.getState().setDashboardGlass("full");
    expect(useSettingsStore.getState().dashboardGlass).toBe("full");
    expect(localStorage.getItem("oleafly.dashboardGlass")).toBe("full");
    useSettingsStore.getState().setDashboardGlass("ambient");
  });
});
