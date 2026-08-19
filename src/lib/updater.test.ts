import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the Tauri surface the updater primitives touch. isTauri is toggled per
// test via the exported ref so we can exercise the browser (no-updater) path.
const state = vi.hoisted(() => ({ tauri: true }));
const { check } = vi.hoisted(() => ({ check: vi.fn() }));
const { relaunch } = vi.hoisted(() => ({ relaunch: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => state.tauri }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));
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

import { findUpdate, installUpdate, openUpdateWindow } from "./updater";

beforeEach(() => {
  flushForQuit.mockReset().mockResolvedValue(undefined);
  state.tauri = true;
  check.mockReset();
  relaunch.mockReset();
  logError.mockReset();
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
  it("reports 0→100 progress from download events, then relaunches", async () => {
    const percents: number[] = [];
    const update = {
      downloadAndInstall: vi.fn(async (cb: (e: unknown) => void) => {
        cb({ event: "Started", data: { contentLength: 100 } });
        cb({ event: "Progress", data: { chunkLength: 40 } });
        cb({ event: "Progress", data: { chunkLength: 60 } });
        cb({ event: "Finished", data: {} });
      }),
    };
    // biome-ignore lint/suspicious/noExplicitAny: test double for the Update type
    await installUpdate(update as any, (p) => percents.push(p));
    expect(percents).toEqual([0, 40, 100, 100]);
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("stays at 0% until finish when no content length is advertised", async () => {
    const percents: number[] = [];
    const update = {
      downloadAndInstall: vi.fn(async (cb: (e: unknown) => void) => {
        cb({ event: "Started", data: {} });
        cb({ event: "Progress", data: { chunkLength: 50 } });
        cb({ event: "Finished", data: {} });
      }),
    };
    // biome-ignore lint/suspicious/noExplicitAny: test double for the Update type
    await installUpdate(update as any, (p) => percents.push(p));
    expect(percents).toEqual([0, 100]);
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("flushes dirty buffers durably before relaunching", async () => {
    let resolveFlush!: () => void;
    flushForQuit.mockImplementation(
      () => new Promise<void>((resolve) => { resolveFlush = resolve; }),
    );
    const update = {
      downloadAndInstall: vi.fn(async (cb: (e: unknown) => void) => {
        cb({ event: "Finished", data: {} });
      }),
    };
    // biome-ignore lint/suspicious/noExplicitAny: test double for the Update type
    const installing = installUpdate(update as any);
    await vi.waitFor(() => expect(flushForQuit).toHaveBeenCalledTimes(1));
    expect(relaunch).not.toHaveBeenCalled();

    resolveFlush();
    await installing;
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("blocks the relaunch when the pre-restart flush fails", async () => {
    flushForQuit.mockRejectedValue(new Error("disk full"));
    const update = {
      downloadAndInstall: vi.fn(async () => {}),
    };
    // biome-ignore lint/suspicious/noExplicitAny: test double for the Update type
    await expect(installUpdate(update as any)).rejects.toThrow("disk full");
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("propagates a download failure and does not relaunch", async () => {
    const update = {
      downloadAndInstall: vi.fn(async () => {
        throw new Error("network down");
      }),
    };
    // biome-ignore lint/suspicious/noExplicitAny: test double for the Update type
    await expect(installUpdate(update as any)).rejects.toThrow("network down");
    expect(relaunch).not.toHaveBeenCalled();
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

