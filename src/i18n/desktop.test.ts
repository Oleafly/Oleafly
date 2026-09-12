// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
type Listener = (event: { payload: unknown }) => void;
const listen = vi.fn<(name: string, handler: Listener) => Promise<() => void>>(async () => () => {});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: (name: string, handler: Listener) => listen(name, handler) }));
vi.mock("@tauri-apps/plugin-os", () => ({ locale: async () => "zh-CN" }));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));

describe("desktop locale glue", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
    listen.mockClear();
    localStorage.clear();
  });

  it("boots from the cached preference and subscribes to changes", async () => {
    localStorage.setItem("oleafly.locale", "zh-Hans");
    const { initializeDesktopI18n } = await import("./desktop");
    const { currentLocale } = await import("./index");
    await initializeDesktopI18n();
    expect(currentLocale()).toBe("zh-Hans");
    expect(listen).toHaveBeenCalledWith("i18n:locale-changed", expect.any(Function));
  });

  it("follows the operating system when the preference is system", async () => {
    const { initializeDesktopI18n } = await import("./desktop");
    const { currentLocale } = await import("./index");
    await initializeDesktopI18n();
    expect(currentLocale()).toBe("zh-Hans");
  });

  it("persists a change through the backend and applies it locally", async () => {
    localStorage.setItem("oleafly.locale", "en");
    invoke.mockResolvedValue("zh-Hans");
    const { initializeDesktopI18n, changeLocalePreference } = await import("./desktop");
    const { currentLocale } = await import("./index");
    await initializeDesktopI18n();
    expect(currentLocale()).toBe("en");
    await changeLocalePreference("zh-Hans");
    expect(invoke).toHaveBeenCalledWith("set_ui_locale", { preference: "zh-Hans" });
    expect(localStorage.getItem("oleafly.locale")).toBe("zh-Hans");
    expect(currentLocale()).toBe("zh-Hans");
  });

  it("adopts the backend preference when it differs from the cache", async () => {
    localStorage.setItem("oleafly.locale", "en");
    const { initializeDesktopI18n, syncLocaleFromConfig } = await import("./desktop");
    const { currentLocale } = await import("./index");
    await initializeDesktopI18n();
    expect(currentLocale()).toBe("en");
    await syncLocaleFromConfig("zh-Hans");
    expect(currentLocale()).toBe("zh-Hans");
    expect(localStorage.getItem("oleafly.locale")).toBe("zh-Hans");
  });

  it("applies a change broadcast from another window", async () => {
    localStorage.setItem("oleafly.locale", "en");
    const { initializeDesktopI18n } = await import("./desktop");
    const { currentLocale } = await import("./index");
    await initializeDesktopI18n();
    const handler = listen.mock.calls[0]?.[1];
    if (!handler) throw new Error("listener was not registered");
    handler({ payload: { locale: "zh-Hans", preference: "zh-Hans" } });
    await vi.waitFor(() => expect(currentLocale()).toBe("zh-Hans"));
    expect(localStorage.getItem("oleafly.locale")).toBe("zh-Hans");
  });
});
