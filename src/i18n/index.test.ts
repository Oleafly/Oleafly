// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("i18n runtime", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.documentElement.lang = "";
  });

  it("initializes English from a cached preference and sets the document language", async () => {
    const { initializeI18n, i18n, currentLocale } = await import("./index");
    const locale = await initializeI18n({
      preference: "en",
      systemLocale: async () => "zh-CN",
      missingKeyMode: "throw",
    });
    expect(locale).toBe("en");
    expect(currentLocale()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(i18n.t(($) => $.common.actions.cancel)).toBe("Cancel");
  });

  it("resolves the system locale to Simplified Chinese and loads its catalogs", async () => {
    const { initializeI18n, i18n } = await import("./index");
    await initializeI18n({
      preference: "system",
      systemLocale: async () => "zh-Hans-CN",
      missingKeyMode: "throw",
    });
    expect(i18n.language).toBe("zh-Hans");
    expect(i18n.hasResourceBundle("zh-Hans", "native")).toBe(true);
    expect(document.documentElement.lang).toBe("zh-Hans");
    expect(i18n.t(($) => $.native.menu.quit)).toBe("退出 Oleafly");
  });

  it("switches live, notifies subscribers, and keeps English as the fallback", async () => {
    const { initializeI18n, applyLocale, onLocaleApplied, i18n } = await import("./index");
    await initializeI18n({ preference: "en", systemLocale: async () => null, missingKeyMode: "warn" });
    const seen: string[] = [];
    const stop = onLocaleApplied((locale) => seen.push(locale));
    await applyLocale("zh-Hans");
    expect(seen).toEqual(["zh-Hans"]);
    expect(i18n.t(($) => $.native.menu.edit)).toBe("编辑");
    expect(i18n.getFixedT("en", "native")(($) => $.native.menu.edit)).toBe("Edit");
    stop();
  });

  it("throws on a missing key when asked to", async () => {
    const { initializeI18n, i18n } = await import("./index");
    await initializeI18n({ preference: "en", systemLocale: async () => null, missingKeyMode: "throw" });
    const dynamic = i18n as unknown as { t(key: string): string };
    expect(() => dynamic.t("common:actions.doesNotExist")).toThrow(/missing translation/);
  });

  it("round-trips the cached preference", async () => {
    const { cachePreference, readCachedPreference } = await import("./index");
    expect(readCachedPreference()).toBe("system");
    cachePreference("zh-Hans");
    expect(readCachedPreference()).toBe("zh-Hans");
    localStorage.setItem("oleafly.locale", "nope");
    expect(readCachedPreference()).toBe("system");
  });
});
