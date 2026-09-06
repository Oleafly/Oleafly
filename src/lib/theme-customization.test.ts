import { beforeEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  THEME_CUSTOMIZATION_STORAGE_KEY,
  applyThemeCustomization,
  themeTokenOverride,
  clearThemeCustomization,
  emptyThemeCustomization,
  parseThemeCustomizationImport,
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

  it("skips tokens Oleafly does not use when importing a shadcn theme and reports them", () => {
    const imported = parseThemeCustomizationImport(
      `{"cssVars":{"light":{"primary":"#2563eb","chart-1":"#f00","sidebar-ring":"#0f0","__proto__":{"polluted":true},"constructor":"#000"},"dark":{"primary":"#6ea8ff","chart-1":"#f00","ring":""}},"radius":"10px"}`,
    );
    expect(imported.customization.light).toEqual({ primary: "#2563eb" });
    expect(imported.customization.dark).toEqual({ primary: "#6ea8ff" });
    expect(imported.skippedTokens).toEqual(["chart-1", "sidebar-ring"]);
    expect(Object.getPrototypeOf(imported.customization.light)).toBe(Object.prototype);
    expect("polluted" in imported.customization.light).toBe(false);
    expect(imported.customization.radius).toBe("10px");
  });

  it("rejects malformed imports with a clear message", () => {
    expect(() => parseThemeCustomizationImport("[]")).toThrow("must contain an object");
    expect(() => parseThemeCustomizationImport("{not json")).toThrow("not valid JSON");
    expect(() => parseThemeCustomizationImport(JSON.stringify({ name: "x" }))).toThrow("cssVars");
    expect(() => parseThemeCustomizationImport(JSON.stringify({ cssVars: { theme: {} } })))
      .toThrow("light and dark CSS variables");
    expect(() => parseThemeCustomizationImport(JSON.stringify({ cssVars: { light: ["#fff"], dark: {} } })))
      .toThrow("The light CSS variables must be an object");
    expect(() => parseThemeCustomizationImport(JSON.stringify({ cssVars: { light: { primary: "#12345" }, dark: {} } })))
      .toThrow("invalid color value");
    expect(() => parseThemeCustomizationImport(JSON.stringify({ cssVars: { light: { primary: "url(x)" }, dark: {} } })))
      .toThrow("invalid color value");
    expect(() => parseThemeCustomizationImport(JSON.stringify({ cssVars: { light: {}, dark: {} }, radius: "calc(1px)" })))
      .toThrow("Corner radius");
    expect(() => parseThemeCustomizationImport(JSON.stringify({ version: 2, light: {}, dark: {} })))
      .toThrow("unsupported version");
    expect(() => parseThemeCustomizationImport(42 as unknown as string)).toThrow("must be text");
    expect(() => parseThemeCustomizationImport(`{"cssVars":{"light":{},"dark":{}},"pad":"${"x".repeat(130 * 1024)}"}`))
      .toThrow("larger than 128 KiB");
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

  it("leaves an accent colour set elsewhere alone when the mode switches", () => {
    const root = document.documentElement;
    root.style.setProperty("--primary", "#2563eb");
    root.style.setProperty("--primary-foreground", "#ffffff");
    const customization = writeThemeCustomization({
      ...emptyThemeCustomization(),
      dark: { accent: "#101010" },
      radius: "8px",
    });
    applyThemeCustomization("dark", customization);
    expect(root.style.getPropertyValue("--primary")).toBe("#2563eb");
    expect(root.style.getPropertyValue("--accent")).toBe("#101010");
    applyThemeCustomization("light", customization);
    expect(root.style.getPropertyValue("--primary")).toBe("#2563eb");
    expect(root.style.getPropertyValue("--primary-foreground")).toBe("#ffffff");
    expect(root.style.getPropertyValue("--accent")).toBe("");
    expect(root.style.getPropertyValue("--radius")).toBe("8px");
    expect(themeTokenOverride("dark", "primary")).toBeUndefined();
    expect(themeTokenOverride("dark", "accent")).toBe("#101010");
  });
});
