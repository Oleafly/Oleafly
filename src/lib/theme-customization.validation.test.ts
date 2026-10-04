import { describe, expect, it } from "vitest";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import {
  emptyThemeCustomization,
  normalizeThemeTokenName,
  parseThemeCustomizationImport,
  readThemeCustomization,
  serializeThemeCustomization,
  THEME_CUSTOMIZATION_STORAGE_KEY,
  validateCustomCss,
  validateRadius,
  validateThemeCustomization,
  validateThemeTokenOverrides,
} from "./theme-customization";

const theme = enCore.theme;

function storageWith(value: string | null): Storage {
  return { getItem: (key: string) => (key === THEME_CUSTOMIZATION_STORAGE_KEY ? value : null) } as Storage;
}

describe("custom CSS validation", () => {
  it.each([
    ["a declaration with two colons", "color: a:b", theme.cssNotSimple],
    ["a declaration without a property", ": red", theme.cssNotSimple],
    ["a declaration without a colon", "color red", theme.cssNotSimple],
    ["a property outside the allow list", "position: fixed", theme.cssPropertyNotAllowed.replace("{{property}}", "position")],
    ["a property with no value", "color:", theme.cssPropertyNotAllowed.replace("{{property}}", "color")],
    ["an overlong value", `color: ${"a".repeat(513)}`, theme.cssUnsafeValue],
    ["more than 64 declarations", Array.from({ length: 65 }, () => "color: red").join(";"), theme.cssTooManyDeclarations],
    ["more than 64 KiB", `color: ${"a".repeat(64 * 1024)}`, theme.cssTooLarge],
  ])("rejects %s", (_label, css, message) => {
    expect(() => validateCustomCss(css)).toThrow(message);
  });

  it("normalizes allowed declarations and treats blank CSS as none", () => {
    expect(validateCustomCss(" --oleafly-gap : 4px ; FONT-SIZE: 14px ;")).toBe("--oleafly-gap: 4px; font-size: 14px");
    expect(validateCustomCss("   ")).toBeNull();
    expect(validateCustomCss(" ; ; ")).toBeNull();
    expect(validateCustomCss(undefined)).toBeNull();
    expect(() => validateCustomCss(12)).toThrow(theme.cssNotText);
  });
});

describe("token and customization validation", () => {
  it("rejects non-objects, oversized token maps and non-text colors", () => {
    expect(() => validateThemeCustomization("theme")).toThrow(theme.customizationNotObject);
    expect(() => validateThemeTokenOverrides([])).toThrow(theme.tokens.notObject);
    const many = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`t${index}`, "#fff"]));
    expect(() => validateThemeTokenOverrides(many)).toThrow(theme.tokens.tooManyEntries.replace("{{max}}", "256"));
    expect(() => validateThemeTokenOverrides({ primary: 5 })).toThrow(theme.invalidColor.replace("{{token}}", "primary"));
    expect(() => validateThemeTokenOverrides({ ["x".repeat(65)]: "#fff" })).toThrow(theme.unsupportedToken.replace("{{token}}", "x".repeat(64)));
  });

  it("accepts prefixed token names and drops empty values", () => {
    expect(normalizeThemeTokenName("--ring")).toBe("ring");
    expect(normalizeThemeTokenName("chart-1")).toBeNull();
    expect(validateThemeTokenOverrides({ "--primary": " red ", ring: null, border: undefined, input: "" })).toEqual({ primary: "red" });
  });

  it("fills in missing modes and validates the radius", () => {
    expect(validateThemeCustomization({ version: 1 })).toEqual(emptyThemeCustomization());
    expect(validateRadius(" .5rem ")).toBe(".5rem");
    expect(validateRadius(null)).toBeNull();
    expect(() => validateRadius(4)).toThrow(theme.invalidRadius);
  });
});

describe("theme imports", () => {
  it("reads the radius from the theme block and imports a single mode", () => {
    const imported = parseThemeCustomizationImport(
      JSON.stringify({ cssVars: { light: { primary: "#111" }, dark: null, theme: { radius: "6px" } } }),
    );
    expect(imported.customization).toMatchObject({ light: { primary: "#111" }, dark: {}, radius: "6px", customCss: null });
  });

  it("round-trips a serialized customization", () => {
    const customization = { ...emptyThemeCustomization(), light: { primary: "#123456" }, radius: "4px", customCss: "color: red" };
    expect(parseThemeCustomizationImport(serializeThemeCustomization(customization)).customization).toEqual(customization);
  });
});

describe("readThemeCustomization", () => {
  it("returns the stored customization or defaults when nothing valid is stored", () => {
    const stored = { ...emptyThemeCustomization(), dark: { background: "#000" } };
    expect(readThemeCustomization(storageWith(JSON.stringify(stored)))).toEqual(stored);
    expect(readThemeCustomization(storageWith(null))).toEqual(emptyThemeCustomization());
    expect(readThemeCustomization(storageWith("{broken"))).toEqual(emptyThemeCustomization());
  });
});
