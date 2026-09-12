import { describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "./settings";

vi.mock("@/i18n/desktop", () => ({ changeLocalePreference: vi.fn(async () => {}) }));

describe("ui locale preference", () => {
  it("defaults to system, persists, and resets", async () => {
    const { changeLocalePreference } = await import("@/i18n/desktop");
    const store = useSettingsStore.getState();
    expect(store.uiLocalePreference).toBe("system");
    store.setUiLocalePreference("zh-Hans");
    expect(useSettingsStore.getState().uiLocalePreference).toBe("zh-Hans");
    expect(localStorage.getItem("oleafly.locale")).toBe("zh-Hans");
    expect(changeLocalePreference).toHaveBeenCalledWith("zh-Hans");
    useSettingsStore.getState().resetGeneralPreferences();
    expect(useSettingsStore.getState().uiLocalePreference).toBe("system");
    expect(changeLocalePreference).toHaveBeenLastCalledWith("system");
  });
});
