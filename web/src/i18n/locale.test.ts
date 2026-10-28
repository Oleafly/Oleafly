import { describe, expect, it } from "vitest";
import { browserLanguages, resolveWebLocale } from "./locale";

describe("resolveWebLocale", () => {
  it.each([
    [["de-DE"], "de"],
    [["fr-CA", "en"], "fr"],
    [["pt"], "pt-BR"],
    [["pt-PT"], "pt-BR"],
    [["pt-BR"], "pt-BR"],
    [["zh"], "zh-Hans"],
    [["zh-CN"], "zh-Hans"],
    [["zh-SG"], "zh-Hans"],
    [["zh-TW"], "zh-Hant"],
    [["zh-HK"], "zh-Hant"],
    [["zh-MO"], "zh-Hant"],
    [["zh-Hant-TW"], "zh-Hant"],
    [["zh-Hans-CN"], "zh-Hans"],
    [["no"], "nb"],
    [["nn-NO"], "nb"],
    [["nb-NO"], "nb"],
    [["ja-JP"], "ja"],
    [["ko-KR"], "ko"],
    [["uk-UA"], "uk"],
    [["sv_SE.UTF-8"], "sv"],
  ] as const)("maps %j to %s", (languages, locale) => {
    expect(resolveWebLocale(languages)).toBe(locale);
  });

  it("takes the first language the app has, skipping unsupported ones", () => {
    expect(resolveWebLocale(["ar-EG", "he", "it-IT", "de"])).toBe("it");
    expect(resolveWebLocale(["", null, undefined, "nl-BE"])).toBe("nl");
  });

  it("keeps English when English comes before a supported language", () => {
    expect(resolveWebLocale(["en-GB", "de-DE"])).toBe("en");
  });

  it("falls back to English when nothing matches", () => {
    expect(resolveWebLocale([])).toBe("en");
    expect(resolveWebLocale(["ar", "hi-IN", "sr-Latn-RS"])).toBe("en");
  });
});

describe("browserLanguages", () => {
  it("prefers navigator.languages and falls back to navigator.language", () => {
    expect(browserLanguages({ languages: ["fr-FR", "en"], language: "fr-FR" })).toEqual(["fr-FR", "en"]);
    expect(browserLanguages({ languages: [], language: "pl-PL" })).toEqual(["pl-PL"]);
    expect(browserLanguages({ languages: [], language: "" })).toEqual([]);
    expect(browserLanguages()).toEqual([...navigator.languages]);
  });
});
