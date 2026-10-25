import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_ICONS,
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
  it("offers pastel first, then blue, light and the other gradients, and starts on pastel", async () => {
    expect(APP_ICON_IDS).toEqual([
      "pastel",
      "blue",
      "light",
      "prism",
      "iridescent",
      "ocean",
      "mint",
      "aurora",
      "sunset",
      "coral",
    ]);
    expect((await reload({})).appIcon).toBe("pastel");
  });

  it("saves the chosen icon and reads it back after a restart", async () => {
    useSettingsStore.getState().setAppIcon("light");
    expect(useSettingsStore.getState().appIcon).toBe("light");
    expect(localStorage.getItem("oleafly.appIcon")).toBe("light");
    expect((await reload({})).appIcon).toBe("light");
  });

  it("keeps a saved blue choice and falls back to pastel for a value it doesn't know", async () => {
    expect((await reload({ "oleafly.appIcon": "blue" })).appIcon).toBe("blue");
    expect((await reload({ "oleafly.appIcon": "green" })).appIcon).toBe("pastel");
    expect(readAppIcon("light")).toBe("light");
    expect(readAppIcon("LIGHT")).toBe("pastel");
    expect(readAppIcon("violet")).toBe("pastel");
    expect(readAppIcon(undefined)).toBe("pastel");
  });

  it("never stores a value outside the list", () => {
    useSettingsStore.getState().setAppIcon("purple" as never);
    expect(useSettingsStore.getState().appIcon).toBe("pastel");
    expect(localStorage.getItem("oleafly.appIcon")).toBe("pastel");
  });

  it("counts as an appearance change until the appearance reset", () => {
    expect(sectionDiffersFromDefaults("appearance", useSettingsStore.getState())).toBe(false);
    useSettingsStore.getState().setAppIcon("light");
    expect(sectionDiffersFromDefaults("appearance", useSettingsStore.getState())).toBe(true);
    useSettingsStore.getState().resetAppearancePreferences();
    expect(useSettingsStore.getState().appIcon).toBe("pastel");
    expect(localStorage.getItem("oleafly.appIcon")).toBe("pastel");
  });

  it("points each icon at its image", () => {
    expect(appIconSource("blue")).toBe("/app-icon/blue.png");
    expect(appIconSource("light")).toBe("/app-icon/light.png");
    expect(appIconSource("prism")).toBe("/app-icon/prism.png");
    expect(appIconSource("pastel")).toBe("/app-icon/pastel.png");
  });

  it("ships an image for every icon it offers", () => {
    for (const icon of APP_ICONS) {
      expect(icon.src).toBe(`/app-icon/${icon.id}.png`);
      expect(existsSync(resolve(process.cwd(), "public", icon.src.slice(1))), icon.id).toBe(true);
    }
  });
});
