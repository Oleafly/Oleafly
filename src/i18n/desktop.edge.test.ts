// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (event: { payload: unknown }) => void;

const mocks = vi.hoisted(() => ({
  tauri: true,
  invoke: vi.fn(async (_command: string, _args?: unknown): Promise<unknown> => undefined),
  listen: vi.fn(async (_name: string, _handler: (event: { payload: unknown }) => void) => () => {}),
  osLocale: vi.fn(async (): Promise<string | null> => "zh-CN"),
  logError: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: () => mocks.tauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-os", () => ({ locale: mocks.osLocale }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

async function load() {
  vi.resetModules();
  const desktop = await import("./desktop");
  const index = await import("./index");
  return { ...desktop, ...index };
}

beforeEach(() => {
  mocks.tauri = true;
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.listen.mockReset().mockResolvedValue(() => {});
  mocks.osLocale.mockReset().mockResolvedValue("zh-CN");
  mocks.logError.mockClear();
  localStorage.clear();
});

describe("desktop locale glue edge cases", () => {
  it("uses the browser language and skips native calls outside the desktop shell", async () => {
    mocks.tauri = false;
    const { initializeDesktopI18n, changeLocalePreference, currentLocale } = await load();
    await initializeDesktopI18n();
    expect(currentLocale()).toBe("en");
    expect(mocks.listen).not.toHaveBeenCalled();
    await changeLocalePreference("system");
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(localStorage.getItem("oleafly.locale")).toBe("system");
  });

  it("falls back to English when the operating system locale cannot be read", async () => {
    mocks.osLocale.mockRejectedValue(new Error("no os plugin"));
    const { initializeDesktopI18n, currentLocale } = await load();
    await initializeDesktopI18n();
    expect(currentLocale()).toBe("en");
  });

  it("logs a listener that cannot be installed and a preference the backend refuses", async () => {
    mocks.listen.mockRejectedValue(new Error("no event bus"));
    mocks.invoke.mockRejectedValue(new Error("config locked"));
    localStorage.setItem("oleafly.locale", "en");
    const { initializeDesktopI18n, changeLocalePreference, currentLocale } = await load();
    await initializeDesktopI18n();
    expect(mocks.logError).toHaveBeenCalledWith("locale change listener", expect.any(Error));
    await changeLocalePreference("en");
    expect(currentLocale()).toBe("en");
    expect(mocks.logError).toHaveBeenCalledWith("set_ui_locale", expect.any(Error));
  });

  it("ignores broadcasts for the current locale, unsupported locales and unknown preferences", async () => {
    localStorage.setItem("oleafly.locale", "en");
    const { initializeDesktopI18n, currentLocale } = await load();
    await initializeDesktopI18n();
    const handler = mocks.listen.mock.calls[0]?.[1] as Listener;
    handler({ payload: { locale: "en", preference: "fr-weird" } });
    handler({ payload: { locale: "tlh" } });
    await Promise.resolve();
    expect(currentLocale()).toBe("en");
    expect(localStorage.getItem("oleafly.locale")).toBe("en");
  });

  it("only syncs a valid backend preference that differs from the cache", async () => {
    localStorage.setItem("oleafly.locale", "en");
    const { initializeDesktopI18n, syncLocaleFromConfig, currentLocale } = await load();
    await initializeDesktopI18n();
    await syncLocaleFromConfig(undefined);
    await syncLocaleFromConfig("klingon");
    await syncLocaleFromConfig("en");
    expect(mocks.osLocale).not.toHaveBeenCalled();
    await syncLocaleFromConfig("system");
    expect(mocks.osLocale).toHaveBeenCalledOnce();
    expect(currentLocale()).toBe("zh-Hans");
    expect(localStorage.getItem("oleafly.locale")).toBe("system");
  });
});
