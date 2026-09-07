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

import {
  findUpdate,
  installUpdate,
  openUpdateWindow,
  runUpdateCheck,
  UpdateDownloadStalledError,
} from "./updater";
import tauriConfig from "../../src-tauri/tauri.conf.json";

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

describe("runUpdateCheck", () => {
  it("gives a joiner the shared result instead of an ambiguous null", async () => {
    let resolveCheck!: (u: unknown) => void;
    check.mockImplementation(() => new Promise((resolve) => { resolveCheck = resolve; }));

    const startup = runUpdateCheck();
    const manual = runUpdateCheck({ rethrow: true });
    const update = { version: "9.9.9", currentVersion: "0.1.1" };
    resolveCheck(update);

    expect(await startup).toBe(update);
    expect(await manual).toBe(update);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("reports up to date as null only when a check actually completed", async () => {
    check.mockResolvedValue(null);
    expect(await runUpdateCheck()).toBeNull();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("propagates a shared failure to a joiner that asked to rethrow", async () => {
    let rejectCheck!: (e: unknown) => void;
    check.mockImplementation(() => new Promise((_r, reject) => { rejectCheck = reject; }));

    const startup = runUpdateCheck();
    const manual = runUpdateCheck({ rethrow: true });
    rejectCheck(new Error("offline"));

    await expect(startup).resolves.toBeNull();
    await expect(manual).rejects.toThrow("offline");
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh check once the previous one has settled", async () => {
    check.mockResolvedValue(null);
    await runUpdateCheck();
    await runUpdateCheck();
    expect(check).toHaveBeenCalledTimes(2);
  });
});

describe("installUpdate stall detection", () => {
  it("fails a download that produces no progress instead of hanging forever", async () => {
    vi.useFakeTimers();
    try {
      const update = {
        downloadAndInstall: vi.fn(() => new Promise<void>(() => {})),
      };
      // biome-ignore lint/suspicious/noExplicitAny: test double for the Update type
      const installing = installUpdate(update as any);
      const assertion = expect(installing).rejects.toBeInstanceOf(UpdateDownloadStalledError);
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
      expect(relaunch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps waiting while chunks are still arriving", async () => {
    vi.useFakeTimers();
    try {
      let emit!: (e: unknown) => void;
      let finish!: () => void;
      const update = {
        downloadAndInstall: vi.fn((cb: (e: unknown) => void) => {
          emit = cb;
          return new Promise<void>((resolve) => { finish = resolve; });
        }),
      };
      // biome-ignore lint/suspicious/noExplicitAny: test double for the Update type
      const installing = installUpdate(update as any);

      emit({ event: "Started", data: { contentLength: 100 } });
      for (let i = 0; i < 4; i += 1) {
        await vi.advanceTimersByTimeAsync(50_000);
        emit({ event: "Progress", data: { chunkLength: 10 } });
      }
      emit({ event: "Finished", data: {} });
      finish();

      await installing;
      expect(relaunch).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("updater endpoints configuration", () => {
  const endpoints = tauriConfig.plugins.updater.endpoints;

  it("asks the Oleafly feed first and keeps GitHub as the fallback", () => {
    expect(endpoints).toHaveLength(2);
    expect(endpoints[0]).toContain("updates.oleafly.com");
    expect(endpoints[1]).toContain("github.com/Oleafly/Oleafly/releases");
  });

  it("spells the placeholders the way the plugin interpolates them", () => {
    expect(endpoints[0]).toBe(
      "https://updates.oleafly.com/{{target}}/{{arch}}/{{current_version}}",
    );
  });

  it("keeps every endpoint on https", () => {
    for (const endpoint of endpoints) expect(endpoint.startsWith("https://")).toBe(true);
  });
});
