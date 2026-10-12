// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "./locales/en/collab.json" with { type: "json" };
import zhCollab from "./locales/zh-Hans/collab.json" with { type: "json" };

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

  it("loads a lazy English namespace on demand, once, and ignores unknown names", async () => {
    const { initializeI18n, i18n, loadNamespace } = await import("./index");
    await initializeI18n({ preference: "en", systemLocale: async () => null, missingKeyMode: "throw" });
    expect(i18n.hasResourceBundle("en", "collab")).toBe(false);
    await Promise.all([loadNamespace("collab"), loadNamespace("collab")]);
    expect(i18n.hasResourceBundle("en", "collab")).toBe(true);
    expect(i18n.t(($) => $.collab.section.servers.title)).toBe(enCollab.section.servers.title);
    await expect(loadNamespace("not-a-namespace")).resolves.toBeUndefined();
    expect(i18n.hasResourceBundle("en", "not-a-namespace")).toBe(false);
  });

  it("loads a translated lazy catalog only when its namespace is asked for", async () => {
    const { initializeI18n, i18n, loadNamespace } = await import("./index");
    await initializeI18n({ preference: "zh-Hans", systemLocale: async () => null, missingKeyMode: "throw" });
    expect(i18n.hasResourceBundle("zh-Hans", "native")).toBe(true);
    expect(i18n.hasResourceBundle("zh-Hans", "collab")).toBe(false);
    await loadNamespace("collab");
    expect(i18n.hasResourceBundle("zh-Hans", "collab")).toBe(true);
    expect(i18n.hasResourceBundle("en", "collab")).toBe(true);
    expect(i18n.t(($) => $.collab.section.servers.title)).toBe(zhCollab.section.servers.title);
  });

  it("brings a loaded lazy namespace along to the next language and leaves unloaded ones lazy", async () => {
    const { initializeI18n, applyLocale, i18n, loadNamespace } = await import("./index");
    await initializeI18n({ preference: "en", systemLocale: async () => null, missingKeyMode: "throw" });
    await applyLocale("ru");
    expect(i18n.hasResourceBundle("ru", "native")).toBe(true);
    expect(i18n.hasResourceBundle("ru", "collab")).toBe(false);
    await loadNamespace("collab");
    expect(i18n.hasResourceBundle("ru", "collab")).toBe(true);
    await applyLocale("zh-Hans");
    expect(i18n.t(($) => $.collab.section.servers.title)).toBe(zhCollab.section.servers.title);
  });

  it("loads the language being switched to when the namespace is asked for during the switch", async () => {
    const { initializeI18n, applyLocale, i18n, loadNamespace } = await import("./index");
    await initializeI18n({ preference: "en", systemLocale: async () => null, missingKeyMode: "throw" });
    const asked = loadNamespace("collab");
    await applyLocale("zh-Hans");
    await asked;
    expect(i18n.t(($) => $.collab.section.servers.title)).toBe(zhCollab.section.servers.title);
    const switching = applyLocale("ru");
    await Promise.all([loadNamespace("collab"), switching]);
    expect(i18n.hasResourceBundle("ru", "collab")).toBe(true);
  });
});
