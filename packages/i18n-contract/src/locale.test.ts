import { describe, expect, it } from "vitest";
import {
  canonicalizeLocale,
  isLocalePreference,
  resolveLocale,
  resolvePreference,
  SUPPORTED_LOCALES,
} from "./locale";

describe("locale resolution", () => {
  it("declares English and Simplified Chinese", () => {
    expect(SUPPORTED_LOCALES).toEqual(["en", "zh-Hans"]);
  });

  it("canonicalizes Chinese tags by script and region", () => {
    expect(canonicalizeLocale("zh")).toBe("zh-Hans");
    expect(canonicalizeLocale("zh-CN")).toBe("zh-Hans");
    expect(canonicalizeLocale("zh_CN.UTF-8")).toBe("zh-Hans");
    expect(canonicalizeLocale("zh-Hans-SG")).toBe("zh-Hans");
    expect(canonicalizeLocale("zh-TW")).toBe("zh-Hant");
    expect(canonicalizeLocale("zh-Hant-HK")).toBe("zh-Hant");
    expect(canonicalizeLocale("zh-MO")).toBe("zh-Hant");
  });

  it("canonicalizes other tags to language plus region", () => {
    expect(canonicalizeLocale("en-US")).toBe("en-US");
    expect(canonicalizeLocale("EN")).toBe("en");
    expect(canonicalizeLocale("pt_BR")).toBe("pt-BR");
    expect(canonicalizeLocale("")).toBeNull();
    expect(canonicalizeLocale(null)).toBeNull();
  });

  it("resolves to a supported locale with fallbacks", () => {
    expect(resolveLocale("zh-CN")).toBe("zh-Hans");
    expect(resolveLocale("zh-TW")).toBe("zh-Hans");
    expect(resolveLocale("en-GB")).toBe("en");
    expect(resolveLocale("fr-FR")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });

  it("resolves a preference against the system locale", () => {
    expect(resolvePreference("system", "zh-Hans-CN")).toBe("zh-Hans");
    expect(resolvePreference("system", null)).toBe("en");
    expect(resolvePreference("zh-Hans", "en-US")).toBe("zh-Hans");
  });

  it("guards preference values", () => {
    expect(isLocalePreference("system")).toBe(true);
    expect(isLocalePreference("zh-Hans")).toBe(true);
    expect(isLocalePreference("zh")).toBe(false);
    expect(isLocalePreference(42)).toBe(false);
  });
});
