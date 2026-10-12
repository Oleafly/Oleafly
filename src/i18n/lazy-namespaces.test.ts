import { afterAll, describe, expect, it } from "vitest";
import { i18n } from "./index";
import { LAZY_NAMESPACES, loadCatalog, loadNamespace } from "./lazy-namespaces";

describe("lazy namespaces", () => {
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("ships a loader for every lazy namespace in every locale", () => {
    for (const namespace of LAZY_NAMESPACES) {
      expect(loadCatalog("en", namespace)).not.toBeNull();
      expect(loadCatalog("fr", namespace)).not.toBeNull();
      expect(loadCatalog("zh-Hans", namespace)).not.toBeNull();
    }
  });

  it("adds the English bundle, then the bundle of each language the app switches to", async () => {
    expect(i18n.hasResourceBundle("en", "settingsFile")).toBe(false);
    await loadNamespace("settingsFile");
    expect(i18n.hasResourceBundle("en", "settingsFile")).toBe(true);
    await loadNamespace("settingsFile");

    await i18n.changeLanguage("de");
    await expect.poll(() => i18n.hasResourceBundle("de", "settingsFile")).toBe(true);
    expect(i18n.getResource("de", "settingsFile", "export")).toBeTypeOf("string");
  });
});
