import { beforeEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  DEFAULT_ACCENT_COLOR,
  THEME_CUSTOMIZATION_STORAGE_KEY,
  accentTokenDefaults,
  applyThemeCustomization,
  clearThemeCustomization,
  effectiveAccentColor,
  emptyThemeCustomization,
} from "./theme-customization";
import {
  DEFAULT_THEME_PRESET,
  THEME_PRESET_STORAGE_KEYS,
  findThemePreset,
  readThemePresetId,
  themePresetStyle,
  themePresets,
} from "./theme-presets";

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://oleafly.test/" });
Object.defineProperties(globalThis, {
  document: { value: dom.window.document, configurable: true },
  window: { value: dom.window, configurable: true },
  localStorage: { value: dom.window.localStorage, configurable: true },
});

beforeEach(() => {
  localStorage.clear();
  clearThemeCustomization();
});

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe("theme presets", () => {
  it("offers Oleafly first, then six light and ten dark themes, each id once", () => {
    for (const [mode, count] of [["light", 7], ["dark", 11]] as const) {
      const presets = themePresets(mode);
      expect(presets).toHaveLength(count);
      expect(presets[0]).toMatchObject({ id: DEFAULT_THEME_PRESET, builtIn: true });
      expect(new Set(presets.map((preset) => preset.id)).size).toBe(count);
      expect(presets.every((preset) => preset.mode === mode)).toBe(true);
    }
  });

  it("keeps every added theme's text readable on its own surfaces and white readable on its accent", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const { name, palette } of themePresets(mode).filter((preset) => !preset.builtIn)) {
        const surfaces = [palette.background, palette.sidebar, palette.card, palette.popover, palette.hover, palette.selected];
        for (const surface of surfaces) {
          expect(contrast(palette.foreground, surface), `${name} text on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
        for (const surface of [palette.background, palette.sidebar]) {
          expect(contrast(palette.mutedForeground, surface), `${name} muted text on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast("#ffffff", palette.primary), `${name} button text`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("falls back to Oleafly for a stored id it does not know", () => {
    localStorage.setItem(THEME_PRESET_STORAGE_KEYS.dark, "solarized");
    expect(readThemePresetId("dark")).toBe(DEFAULT_THEME_PRESET);
    localStorage.setItem(THEME_PRESET_STORAGE_KEYS.dark, "darcula");
    expect(readThemePresetId("dark")).toBe("darcula");
    expect(readThemePresetId("light")).toBe(DEFAULT_THEME_PRESET);
    expect(findThemePreset("light", "darcula").id).toBe(DEFAULT_THEME_PRESET);
  });

  it("leaves the built-in look untouched and maps a theme onto the app tokens", () => {
    expect(themePresetStyle(findThemePreset("dark", DEFAULT_THEME_PRESET))).toEqual({
      tokens: {},
      properties: {},
      radius: null,
      primary: null,
    });
    const style = themePresetStyle(findThemePreset("dark", "one-dark-pro"));
    expect(style.tokens).toMatchObject({
      background: "#282c34",
      sidebar: "#21252b",
      "muted-foreground": "#9aa0ab",
      "sidebar-accent": "#323842",
      "pdf-dark-page": "#2c313a",
    });
    expect(style.properties).toEqual({ "--code-block-bg": "#21252b", "--home-background": "#282c34" });
    expect(style).toMatchObject({ radius: "0.375rem", primary: "#4570c4" });
  });
});

describe("applying a theme preset", () => {
  it("paints the chosen theme for the mode in use, under the user's own token overrides", () => {
    localStorage.setItem(THEME_PRESET_STORAGE_KEYS.dark, "github-dark");
    localStorage.setItem(
      THEME_CUSTOMIZATION_STORAGE_KEY,
      JSON.stringify({ ...emptyThemeCustomization(), dark: { sidebar: "#123456" } }),
    );
    applyThemeCustomization("dark");
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--background")).toBe("#0d1117");
    expect(style.getPropertyValue("--sidebar")).toBe("#123456");
    expect(style.getPropertyValue("--code-block-bg")).toBe("#161b22");
    expect(style.getPropertyValue("--radius")).toBe("0.375rem");
    expect(document.documentElement.dataset.themePreset).toBe("github-dark");

    applyThemeCustomization("light");
    expect(document.documentElement.dataset.themePreset).toBeUndefined();
    expect(style.getPropertyValue("--background")).toBe("");
    expect(style.getPropertyValue("--code-block-bg")).toBe("");
    expect(style.getPropertyValue("--radius")).toBe("");
  });

  it("uses the theme's accent until the user picks one, and a custom primary over both", () => {
    localStorage.setItem(THEME_PRESET_STORAGE_KEYS.light, "atom-one-light");
    expect(accentTokenDefaults("light", "")).toEqual({ "--primary": "#4d64e8", "--primary-foreground": "#ffffff" });
    expect(accentTokenDefaults("light", "#0d9488")["--primary"]).toBe("#0d9488");
    expect(effectiveAccentColor("dark", "")).toBe(DEFAULT_ACCENT_COLOR);

    localStorage.setItem(
      THEME_CUSTOMIZATION_STORAGE_KEY,
      JSON.stringify({ ...emptyThemeCustomization(), light: { primary: "#7c3aed" } }),
    );
    expect(accentTokenDefaults("light", "#0d9488")).toEqual({});
    expect(effectiveAccentColor("light", "#0d9488")).toBe("#7c3aed");
  });
});
