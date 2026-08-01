import { describe, expect, it } from "vitest";
import { isLocalePreference, normalizeLocale } from "./locale";

describe("desktop locale resolution", () => {
  it("accepts only persisted System default or supported locale values", () => {
    expect(isLocalePreference("system")).toBe(true);
    expect(isLocalePreference("en")).toBe(true);
    expect(isLocalePreference("es")).toBe(true);
    expect(isLocalePreference("fr")).toBe(true);
    expect(isLocalePreference("zh")).toBe(true);
    expect(isLocalePreference("de")).toBe(false);
    expect(isLocalePreference(null)).toBe(false);
    // Guard against coercion: values whose toString() matches a locale must
    // not narrow to a preference.
    expect(isLocalePreference(["en"])).toBe(false);
  });

  it("maps system locales to their supported primary language", () => {
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("es-MX")).toBe("es");
    expect(normalizeLocale("fr-CA")).toBe("fr");
    expect(normalizeLocale("zh-Hans-CN")).toBe("zh");
    expect(normalizeLocale("FR")).toBe("fr");
  });

  it("falls back to English for unsupported or missing system locales", () => {
    expect(normalizeLocale("de-DE")).toBe("en");
    expect(normalizeLocale("pt-BR")).toBe("en");
    expect(normalizeLocale("")).toBe("en");
    expect(normalizeLocale(null)).toBe("en");
    expect(normalizeLocale(undefined)).toBe("en");
  });
});
