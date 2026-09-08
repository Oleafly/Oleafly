import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the Tauri surface the updater primitives touch. isTauri is toggled per
// test via the exported ref so we can exercise the browser (no-updater) path.
const state = vi.hoisted(() => ({ tauri: true }));
const { check } = vi.hoisted(() => ({ check: vi.fn() }));
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => state.tauri,
  invoke,
  Channel: class { onmessage = (_event: unknown) => {}; },
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(), message: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
const { WebviewWindow, getByLabel, once, setFocus } = vi.hoisted(() => {
  const once = vi.fn();
  const setFocus = vi.fn();
  const getByLabel = vi.fn();
  const WebviewWindow = vi.fn(
    class {
      once = once;
    },
  );
  (WebviewWindow as unknown as { getByLabel: unknown }).getByLabel = getByLabel;
  return { WebviewWindow, getByLabel, once, setFocus };
});
vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow }));

const { flushForQuit } = vi.hoisted(() => ({ flushForQuit: vi.fn(async () => {}) }));
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ flushForQuit }) },
}));

import type { Update } from "@tauri-apps/plugin-updater";
import { findUpdate, installUpdate, openUpdateWindow, runUpdateCheck } from "./updater";

beforeEach(() => {
  flushForQuit.mockReset().mockResolvedValue(undefined);
  state.tauri = true;
  check.mockReset();
  invoke.mockReset();
  logError.mockReset().mockResolvedValue(undefined);
  WebviewWindow.mockClear();
  getByLabel.mockReset();
  once.mockReset();
  setFocus.mockReset();
});

describe("findUpdate", () => {
  it("returns null in the browser dev server without calling the plugin", async () => {
    state.tauri = false;
    expect(await findUpdate()).toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  it("returns null when the plugin reports no update (up to date)", async () => {
    check.mockResolvedValue(null);
    expect(await findUpdate()).toBeNull();
  });

  it("returns the Update object when one is available", async () => {
    const update = { version: "0.2.0", currentVersion: "0.1.1", body: "notes" };
    check.mockResolvedValue(update);
    expect(await findUpdate()).toBe(update);
  });

  it("passes a timeout so a hung check can't latch inFlight forever", async () => {
    check.mockResolvedValue(null);
    await findUpdate();
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ timeout: 15000 }));
  });
});

describe("installUpdate", () => {
  const update = { rid: 5 } as Update;

  it("downloads and verifies before requesting a guarded native install", async () => {
    const percents: number[] = [];
    invoke.mockImplementation(async (command, options) => {
      if (command === "download_update") {
        expect(options.rid).toBe(5);
        options.onEvent.onmessage({ event: "Started", data: { contentLength: 100 } });
        options.onEvent.onmessage({ event: "Progress", data: { chunkLength: 40 } });
        options.onEvent.onmessage({ event: "Progress", data: { chunkLength: 60 } });
        options.onEvent.onmessage({ event: "Finished" });
        return 8;
      }
    });
    await installUpdate(update, (p) => percents.push(p));
    expect(percents).toEqual([0, 40, 100, 100]);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(["download_update", "install_update"]);
    expect(invoke).toHaveBeenLastCalledWith("install_update", { rid: 8 });
    expect(flushForQuit).not.toHaveBeenCalled();
  });

  it("does not install if the download stalls or fails verification", async () => {
    invoke.mockRejectedValue(new Error("download stopped making progress"));
    await expect(installUpdate(update)).rejects.toThrow("stopped making progress");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(flushForQuit).not.toHaveBeenCalled();
  });

  it("waits for the entire verified download even after progress reaches 100", async () => {
    let downloaded!: (rid: number) => void;
    invoke.mockImplementation((command, options) => {
      if (command === "download_update") {
        options.onEvent.onmessage({ event: "Finished" });
        return new Promise<number>((resolve) => { downloaded = resolve; });
      }
      return Promise.resolve();
    });
    const installing = installUpdate(update);
    expect(invoke).toHaveBeenCalledTimes(1);
    downloaded(8);
    await installing;
    expect(invoke).toHaveBeenLastCalledWith("install_update", { rid: 8 });
  });

  it("surfaces a main-window save failure without falling back to an unguarded install", async () => {
    invoke.mockResolvedValueOnce(8).mockRejectedValueOnce(new Error("disk full"));
    await expect(installUpdate(update)).rejects.toThrow("disk full");
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe("concurrent checks", () => {
  it("shares the actual result with every caller", async () => {
    let finish!: (update: Update) => void;
    check.mockImplementation(() => new Promise<Update>((resolve) => { finish = resolve; }));
    const automatic = runUpdateCheck();
    const manual = runUpdateCheck({ rethrow: true });
    const direct = findUpdate();
    const update = { version: "0.4.0" } as Update;
    finish(update);
    expect(await Promise.all([automatic, manual, direct])).toEqual([update, update, update]);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("preserves each caller's error policy and allows another check after failure", async () => {
    check.mockRejectedValue(new Error("offline"));
    const automatic = runUpdateCheck();
    const manual = runUpdateCheck({ rethrow: true });
    await expect(manual).rejects.toThrow("offline");
    expect(await automatic).toBeNull();
    check.mockResolvedValue(null);
    expect(await runUpdateCheck({ rethrow: true })).toBeNull();
    expect(check).toHaveBeenCalledTimes(2);
  });
});

describe("openUpdateWindow", () => {
  it("does nothing in the browser dev server", async () => {
    state.tauri = false;
    await openUpdateWindow();
    expect(getByLabel).not.toHaveBeenCalled();
    expect(WebviewWindow).not.toHaveBeenCalled();
  });

  it("focuses the window that is already open instead of making a second one", async () => {
    getByLabel.mockResolvedValue({ setFocus });
    await openUpdateWindow();
    expect(setFocus).toHaveBeenCalledTimes(1);
    expect(WebviewWindow).not.toHaveBeenCalled();
  });

  it("creates the window and carries the manual flag into its url", async () => {
    getByLabel.mockResolvedValue(null);
    await openUpdateWindow({ manual: true });
    expect(WebviewWindow).toHaveBeenCalledTimes(1);
    const [label, options] = WebviewWindow.mock.calls[0] as unknown as [
      string,
      { url: string },
    ];
    expect(label).toBe("update");
    expect(options.url).toContain("manual=1");
  });

  it("omits the manual flag on the automatic path", async () => {
    getByLabel.mockResolvedValue(null);
    await openUpdateWindow();
    const [, options] = WebviewWindow.mock.calls[0] as unknown as [string, { url: string }];
    expect(options.url).not.toContain("manual=1");
  });

  it("reports a window that fails to open instead of failing silently", async () => {
    getByLabel.mockResolvedValue(null);
    await openUpdateWindow();
    const [event, handler] = once.mock.calls[0] as unknown as [
      string,
      (e: { payload: unknown }) => void,
    ];
    expect(event).toBe("tauri://error");
    handler({ payload: "no display" });
    expect(logError).toHaveBeenCalledWith("updater", "no display");
  });
});
