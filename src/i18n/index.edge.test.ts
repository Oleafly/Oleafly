// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("missing translations", () => {
  it("warns once per missing key in warn mode", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { initializeI18n, i18n } = await import("./index");
    await initializeI18n({ preference: "en", systemLocale: async () => null, missingKeyMode: "warn" });
    const dynamic = i18n as unknown as { t(key: string): string };
    dynamic.t("common:actions.notThere");
    dynamic.t("common:actions.notThere");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("[i18n] missing translation common:actions.notThere");
  });

  it("stays quiet in log mode", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { initializeI18n, i18n } = await import("./index");
    await initializeI18n({ preference: "en", systemLocale: async () => null, missingKeyMode: "log" });
    const dynamic = i18n as unknown as { t(key: string): string };
    expect(() => dynamic.t("common:actions.alsoMissing")).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("cached preference without storage", () => {
  it("falls back to the system preference and ignores failed writes", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { cachePreference, readCachedPreference } = await import("./index");
    expect(readCachedPreference()).toBe("system");
    expect(() => cachePreference("zh-Hans")).not.toThrow();
  });
});
