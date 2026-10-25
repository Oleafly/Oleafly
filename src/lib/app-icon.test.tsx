// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  tauri: false,
  appIconSet: vi.fn(async (_variant: string) => {}),
  logError: vi.fn(async (_context: string, _error: unknown) => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => bridge.tauri, invoke: vi.fn() }));
vi.mock("@/lib/tauri", () => ({ appIconSet: bridge.appIconSet }));
vi.mock("@/lib/log", () => ({ logError: bridge.logError }));

import { useSettingsStore } from "@/store/settings";
import { AppIcon, applyAppIcon } from "./app-icon";

beforeEach(() => {
  localStorage.clear();
  bridge.tauri = false;
  bridge.appIconSet.mockReset().mockResolvedValue(undefined);
  bridge.logError.mockClear();
  useSettingsStore.getState().setAppIcon("blue");
});

describe("applying the app icon", () => {
  it("asks the app to change its icon only inside Tauri", async () => {
    await applyAppIcon("light");
    expect(bridge.appIconSet).not.toHaveBeenCalled();
    bridge.tauri = true;
    await applyAppIcon("light");
    expect(bridge.appIconSet).toHaveBeenCalledWith("light");
  });

  it("applies the saved icon at startup and again whenever it changes", async () => {
    bridge.tauri = true;
    useSettingsStore.getState().setAppIcon("light");
    render(<AppIcon />);
    await act(async () => {});
    expect(bridge.appIconSet).toHaveBeenLastCalledWith("light");

    await act(async () => {
      useSettingsStore.getState().setAppIcon("blue");
    });
    expect(bridge.appIconSet).toHaveBeenLastCalledWith("blue");

    await act(async () => {
      useSettingsStore.getState().resetAppearancePreferences();
    });
    expect(bridge.appIconSet).toHaveBeenCalledTimes(2);
  });

  it("logs a failure instead of throwing", async () => {
    bridge.tauri = true;
    const failure = new Error("no window");
    bridge.appIconSet.mockRejectedValueOnce(failure);
    render(<AppIcon />);
    await act(async () => {});
    expect(bridge.logError).toHaveBeenCalledWith("apply the app icon", failure);
  });
});
