import { beforeEach, describe, expect, it } from "vitest";
import { sectionDiffersFromDefaults, useSettingsStore } from "./settings";

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ editorThemeLight: "system", editorThemeDark: "system", editorColors: {} });
});

const stored = () => JSON.parse(localStorage.getItem("oleafly.editor.colors") ?? "{}") as unknown;

describe("editor theme pair and colors", () => {
  it("keeps a theme for light mode and one for dark mode", () => {
    const settings = useSettingsStore.getState();
    settings.setEditorTheme("light", "paper");
    settings.setEditorTheme("dark", "neon" as never);

    expect(useSettingsStore.getState()).toMatchObject({
      editorThemeLight: "paper",
      editorThemeDark: "system",
    });
    expect(localStorage.getItem("oleafly.editorTheme.light")).toBe("paper");
    expect(localStorage.getItem("oleafly.editorTheme.dark")).toBe("system");
  });

  it("saves colors per theme, normalizes them and drops the ones set back to the theme", () => {
    const settings = useSettingsStore.getState();
    settings.setEditorColor("paper", "heading", "#AA0000");
    settings.setEditorColor("paper", "comment", "#00AA00");
    settings.setEditorColor("system-dark", "background", "#101010");
    settings.setEditorColor("paper", "math", "not a color");

    expect(useSettingsStore.getState().editorColors).toEqual({
      paper: { heading: "#aa0000", comment: "#00aa00" },
      "system-dark": { background: "#101010" },
    });

    settings.setEditorColor("paper", "heading", "");
    settings.setEditorColor("system-dark", "background", "");
    expect(useSettingsStore.getState().editorColors).toEqual({ paper: { comment: "#00aa00" } });
    expect(stored()).toEqual({ paper: { comment: "#00aa00" } });
  });

  it("resets one theme's colors and leaves the others alone", () => {
    const settings = useSettingsStore.getState();
    settings.setEditorColor("paper", "heading", "#aa0000");
    settings.setEditorColor("nord", "heading", "#bb0000");

    settings.resetEditorColors("paper");

    expect(useSettingsStore.getState().editorColors).toEqual({ nord: { heading: "#bb0000" } });
    expect(stored()).toEqual({ nord: { heading: "#bb0000" } });
  });

  it("imports a theme pair and merges its colors over the saved ones", () => {
    const settings = useSettingsStore.getState();
    settings.setEditorColor("nord", "heading", "#bb0000");
    settings.setEditorColor("paper", "heading", "#aa0000");

    settings.importEditorThemes({
      themes: { light: "one-light", dark: "nord" },
      colors: { paper: { math: "#0000aa" } },
    });

    expect(useSettingsStore.getState()).toMatchObject({
      editorThemeLight: "one-light",
      editorThemeDark: "nord",
      editorColors: { nord: { heading: "#bb0000" }, paper: { math: "#0000aa" } },
    });
  });

  it("counts custom colors as an Appearance change and clears them on reset", () => {
    expect(sectionDiffersFromDefaults("appearance", useSettingsStore.getState())).toBe(false);
    useSettingsStore.getState().setEditorColor("paper", "heading", "#aa0000");
    expect(sectionDiffersFromDefaults("appearance", useSettingsStore.getState())).toBe(true);

    useSettingsStore.getState().resetAppearancePreferences();

    expect(useSettingsStore.getState().editorColors).toEqual({});
    expect(localStorage.getItem("oleafly.editor.colors")).toBe("{}");
    expect(sectionDiffersFromDefaults("appearance", useSettingsStore.getState())).toBe(false);
  });
});
