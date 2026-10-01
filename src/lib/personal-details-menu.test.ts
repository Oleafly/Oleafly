import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  invoke: vi.fn(async () => {}),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    native.listeners.set(event, handler);
    return () => native.listeners.delete(event);
  }),
}));
vi.mock("@/lib/browser-window", () => ({ toggleBrowser: vi.fn() }));

import {
  PERSONAL_DETAILS_MENU_EVENT,
  startPersonalDetailsMenuBridge,
} from "@/lib/personal-details-menu";
import { usePersonalDetailsStore } from "@/store/personal-details";

const originalNavigator = globalThis.navigator;

beforeEach(() => {
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  native.invoke.mockClear();
  native.listeners.clear();
});

afterEach(() => {
  usePersonalDetailsStore.getState().setHidden(false);
  vi.stubGlobal("navigator", originalNavigator);
});

describe("View menu bridge for personal details", () => {
  it("toggles the mode from the View menu and keeps the check mark in step", async () => {
    const stop = await startPersonalDetailsMenuBridge();
    expect(native.invoke).toHaveBeenLastCalledWith("set_personal_details_hidden", { hidden: false });

    native.listeners.get(PERSONAL_DETAILS_MENU_EVENT)?.({ payload: null });
    expect(usePersonalDetailsStore.getState().hidden).toBe(true);
    expect(native.invoke).toHaveBeenLastCalledWith("set_personal_details_hidden", { hidden: true });

    usePersonalDetailsStore.getState().setHidden(false);
    expect(native.invoke).toHaveBeenLastCalledWith("set_personal_details_hidden", { hidden: false });

    stop();
    expect(native.listeners.size).toBe(0);
  });

  it("does nothing on Windows, which has no native menu bar", async () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    const stop = await startPersonalDetailsMenuBridge();
    expect(native.invoke).not.toHaveBeenCalled();
    expect(native.listeners.size).toBe(0);
    stop();
  });
});
