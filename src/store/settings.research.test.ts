import { describe, expect, it } from "vitest";
import { SECTION_SETTINGS, sectionDiffersFromDefaults, useSettingsStore } from "./settings";

describe("Settings › Research", () => {
  it("opens Settings at the Research section", () => {
    useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general" });

    useSettingsStore.getState().openSettingsAt("research");

    expect(useSettingsStore.getState()).toMatchObject({
      settingsOpen: true,
      settingsInitialSection: "research",
      settingsInitialAppearanceTab: null,
    });
  });

  it("keeps its defaults in the app config, so there is nothing in the browser to reset", () => {
    expect(SECTION_SETTINGS.research).toEqual({});
    expect(sectionDiffersFromDefaults("research", useSettingsStore.getState())).toBe(false);
  });
});
