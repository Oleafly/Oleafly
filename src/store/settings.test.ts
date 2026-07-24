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

describe("useSettingsStore layout presets", () => {
  it("ai-only hides the editor area and shows the AI rail", () => {
    useSettingsStore.getState().setLayoutPreset("ai-only");
    const s = useSettingsStore.getState();
    expect(s.hideEditorArea).toBe(true);
    expect(s.showTree).toBe(true);
    expect(s.railTab).toBe("ai");
  });

  it("switching away from ai-only clears hideEditorArea", () => {
    useSettingsStore.getState().setLayoutPreset("ai-only");
    expect(useSettingsStore.getState().hideEditorArea).toBe(true);
    useSettingsStore.getState().setLayoutPreset("editor-preview");
    expect(useSettingsStore.getState().hideEditorArea).toBe(false);
  });
});
