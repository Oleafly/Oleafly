// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webview = vi.hoisted(() => ({ tauri: false, setZoom: vi.fn(async (_scale: number) => {}) }));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => webview.tauri, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom: webview.setZoom }) }));

import { useSettingsStore } from "@/store/settings";
import { useShortcutStore } from "@/store/shortcuts";
import { AppZoom, APP_ZOOM_STORAGE_KEY, applyAppZoom, steppedAppZoom, storedAppZoom, zoomApp } from "./app-zoom";

function key(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  webview.tauri = false;
  webview.setZoom.mockClear();
  useShortcutStore.getState().resetAll();
  useSettingsStore.getState().setAppZoom(100);
});

afterEach(() => {
  localStorage.clear();
});

describe("app zoom levels", () => {
  it("steps through the fixed levels and stops at both ends", () => {
    expect(steppedAppZoom(100, 1)).toBe(110);
    expect(steppedAppZoom(110, 1)).toBe(125);
    expect(steppedAppZoom(100, -1)).toBe(90);
    expect(steppedAppZoom(200, 1)).toBe(200);
    expect(steppedAppZoom(80, -1)).toBe(80);
    expect(steppedAppZoom(137, 1)).toBe(110);
  });

  it("reads only a known level back from storage", () => {
    localStorage.setItem(APP_ZOOM_STORAGE_KEY, "150");
    expect(storedAppZoom()).toBe(150);
    localStorage.setItem(APP_ZOOM_STORAGE_KEY, "133");
    expect(storedAppZoom()).toBe(100);
  });

  it("zooms the Tauri webview and does nothing in a plain browser", async () => {
    await applyAppZoom(125);
    expect(webview.setZoom).not.toHaveBeenCalled();
    webview.tauri = true;
    await applyAppZoom(125);
    expect(webview.setZoom).toHaveBeenCalledWith(1.25);
  });
});

describe("the AppZoom keeper", () => {
  it("zooms in, out and back with the shortcuts, Cmd/Ctrl plus included", () => {
    render(<AppZoom />);
    expect(key({ key: "=", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(useSettingsStore.getState().appZoom).toBe(110);
    key({ key: "+", ctrlKey: true, shiftKey: true });
    expect(useSettingsStore.getState().appZoom).toBe(125);
    key({ key: "-", ctrlKey: true });
    expect(useSettingsStore.getState().appZoom).toBe(110);
    key({ key: "0", ctrlKey: true });
    expect(useSettingsStore.getState().appZoom).toBe(100);
    expect(localStorage.getItem(APP_ZOOM_STORAGE_KEY)).toBe("100");
  });

  it("applies the level to the webview whenever it changes", async () => {
    webview.tauri = true;
    render(<AppZoom />);
    act(() => zoomApp(1));
    await vi.waitFor(() => expect(webview.setZoom).toHaveBeenLastCalledWith(1.1));
  });

  it("follows a rebinding and leaves keys another handler already took", () => {
    useShortcutStore.getState().setBinding("zoomIn", { key: "u", mod: true, alt: true });
    render(<AppZoom />);
    key({ key: "=", ctrlKey: true });
    expect(useSettingsStore.getState().appZoom).toBe(100);
    key({ key: "u", ctrlKey: true, altKey: true });
    expect(useSettingsStore.getState().appZoom).toBe(110);

    const taken = new KeyboardEvent("keydown", { key: "0", ctrlKey: true, bubbles: true, cancelable: true });
    taken.preventDefault();
    act(() => {
      window.dispatchEvent(taken);
    });
    expect(useSettingsStore.getState().appZoom).toBe(110);
  });

  it("picks up a zoom changed in another window", () => {
    render(<AppZoom />);
    localStorage.setItem(APP_ZOOM_STORAGE_KEY, "175");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: APP_ZOOM_STORAGE_KEY }));
    });
    expect(useSettingsStore.getState().appZoom).toBe(175);
  });
});
