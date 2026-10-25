import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_ICON_IDS,
  appIconSource,
  readAppIcon,
  sectionDiffersFromDefaults,
  useSettingsStore,
} from "./settings";

async function reload(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
  vi.resetModules();
  return (await import("./settings")).useSettingsStore.getState();
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().resetAppearancePreferences();
});

describe("app icon preference", () => {
  it("offers the blue and light icons and starts on blue", async () => {
    expect(APP_ICON_IDS).toEqual(["blue", "light"]);
    expect((await reload({})).appIcon).toBe("blue");
  });

  it("saves the chosen icon and reads it back after a restart", async () => {
    useSettingsStore.getState().setAppIcon("light");
    expect(useSettingsStore.getState().appIcon).toBe("light");
    expect(localStorage.getItem("oleafly.appIcon")).toBe("light");
    expect((await reload({})).appIcon).toBe("light");
  });

  it("falls back to blue for a stored value it doesn't know", async () => {
    expect((await reload({ "oleafly.appIcon": "green" })).appIcon).toBe("blue");
    expect(readAppIcon("light")).toBe("light");
    expect(readAppIcon("LIGHT")).toBe("blue");
    expect(readAppIcon(undefined)).toBe("blue");
  });

  it("never stores a value outside the list", () => {
    useSettingsStore.getState().setAppIcon("purple" as never);
    expect(useSettingsStore.getState().appIcon).toBe("blue");
    expect(localStorage.getItem("oleafly.appIcon")).toBe("blue");
  });

  it("counts as an appearance change until the appearance reset", () => {
    expect(sectionDiffersFromDefaults("appearance", useSettingsStore.getState())).toBe(false);
    useSettingsStore.getState().setAppIcon("light");
    expect(sectionDiffersFromDefaults("appearance", useSettingsStore.getState())).toBe(true);
    useSettingsStore.getState().resetAppearancePreferences();
    expect(useSettingsStore.getState().appIcon).toBe("blue");
    expect(localStorage.getItem("oleafly.appIcon")).toBe("blue");
  });

  it("points each icon at its image", () => {
    expect(appIconSource("blue")).toBe("/app-icon/blue.png");
    expect(appIconSource("light")).toBe("/app-icon/light.png");
  });
});
