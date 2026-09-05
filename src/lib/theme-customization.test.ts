import { beforeEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  THEME_CUSTOMIZATION_STORAGE_KEY,
  applyThemeCustomization,
  clearThemeCustomization,
  emptyThemeCustomization,
  parseThemeCustomizationJson,
  readThemeCustomization,
  resetThemeCustomization,
  validateCustomCss,
  validateThemeCustomization,
  writeThemeCustomization,
} from "./theme-customization";

const dom = new JSDOM("<!doctype html><html><head></head><body><div id=\"root\"></div></body></html>", {
  url: "https://oleafly.test/",
});
Object.defineProperties(globalThis, {
  document: { value: dom.window.document, configurable: true },
  window: { value: dom.window, configurable: true },
  localStorage: { value: dom.window.localStorage, configurable: true },
});

beforeEach(() => {
  localStorage.clear();
  clearThemeCustomization();
  document.body.innerHTML = '<div id="root"></div>';
});

describe("theme customization schema", () => {
  it("imports the shadcn CSS variable shape", () => {
    const imported = parseThemeCustomizationJson(JSON.stringify({
      $schema: "https://ui.shadcn.com/schema/registry-theme.json",
      cssVars: {
        light: { background: "#ffffff", foreground: "#111111" },
        dark: { background: "oklch(0.2 0 0)", foreground: "#eeeeee" },
      },
      radius: "8px",
      oleafly: { customCss: "color: #111111" },
    }));
    expect(imported.light.background).toBe("#ffffff");
    expect(imported.dark.background).toBe("oklch(0.2 0 0)");
    expect(imported.radius).toBe("8px");
    expect(imported.customCss).toBe("color: #111111");
  });

  it("rejects unknown tokens and executable stylesheet features", () => {
    expect(() => validateThemeCustomization({ light: { injected: "#fff" }, dark: {} })).toThrow("Unsupported theme token");
    expect(() => validateCustomCss("@import url(https://example.test/theme.css)"))
      .toThrow("cannot use at-rules, URLs, or selectors");
    expect(() => validateCustomCss("body { color: #fff }"))
      .toThrow("cannot use at-rules, URLs, or selectors");
  });
});

describe("theme customization application", () => {
  it("persists separately from the theme preference and applies the resolved mode", () => {
    const customization = writeThemeCustomization({
      ...emptyThemeCustomization(),
      light: { primary: "#123456" },
      dark: { primary: "#abcdef" },
      radius: "12px",
    });
    expect(localStorage.getItem(THEME_CUSTOMIZATION_STORAGE_KEY)).not.toBeNull();
    expect(localStorage.getItem("oleafly.theme")).toBeNull();
    applyThemeCustomization("dark", customization);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("#abcdef");
    expect(document.documentElement.style.getPropertyValue("--radius")).toBe("12px");
    applyThemeCustomization("light", customization);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("#123456");
  });

  it("restores defaults by removing explicit overrides and scoped styles", () => {
    writeThemeCustomization({
      ...emptyThemeCustomization(),
      dark: { primary: "#abcdef" },
      customCss: "color: #abcdef",
    });
    applyThemeCustomization("dark");
    expect(document.querySelector("style[data-oleafly-custom-theme]")).not.toBeNull();
    resetThemeCustomization();
    applyThemeCustomization("dark", readThemeCustomization());
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("");
    expect(document.querySelector("style[data-oleafly-custom-theme]")?.textContent).toBe("");
  });
});
