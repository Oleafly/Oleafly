import { describe, expect, it } from "vitest";
import { isLocalePreference, normalizeLocale } from "./locale";

describe("desktop locale resolution", () => {
  it("accepts only persisted System default or supported locale values", () => {
    expect(isLocalePreference("system")).toBe(true);
    expect(isLocalePreference("en")).toBe(true);
    expect(isLocalePreference("es")).toBe(false);
    expect(isLocalePreference(null)).toBe(false);
  });

  it("maps regional English system locales to the bundled English catalog", () => {
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("en-GB")).toBe("en");
    expect(normalizeLocale("fr-FR")).toBe("en");
    expect(normalizeLocale(null)).toBe("en");
  });
});
