import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { IMPORT_FAILURE_GRACE_MS, installErrorLogging, logError, logInfo, logWarning } from "./log";

beforeEach(() => {
  vi.useFakeTimers();
  mocks.invoke.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await vi.runAllTimersAsync();
  vi.useRealTimers();
});

describe("app log", () => {
  it("writes errors, warnings and notes to the app log with their scope", async () => {
    await logError("save file", "disk full");
    await logWarning("library thumbnail", new Error("Invalid PDF structure"));
    await logInfo("query", { reason: "not running" });
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "log_frontend_error", { message: "save file: disk full" });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "log_frontend_entry", {
      level: "warning",
      message: expect.stringMatching(/^library thumbnail: Error: Invalid PDF structure\n/u),
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "log_frontend_entry", {
      level: "info",
      message: 'query: {"reason":"not running"}',
    });
  });

  it("writes an error's headline once, whether or not its stack starts with it", async () => {
    const chromium = new Error("Invalid PDF structure");
    chromium.stack = "Error: Invalid PDF structure\n    at load (viewer.js:1:2)";
    const webkit = new TypeError("undefined is not an object");
    webkit.stack = "load@viewer.js:1:2";
    await logWarning("viewer", chromium);
    await logWarning("preview", webkit);
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "log_frontend_entry", {
      level: "warning",
      message: "viewer: Error: Invalid PDF structure\n    at load (viewer.js:1:2)",
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "log_frontend_entry", {
      level: "warning",
      message: "preview: TypeError: undefined is not an object\nload@viewer.js:1:2",
    });
  });

  it("never throws when the log can't be written", async () => {
    mocks.invoke.mockRejectedValue(new Error("not allowed"));
    await expect(logError("a", "b")).resolves.toBeUndefined();
    await expect(logWarning("a", "b")).resolves.toBeUndefined();
    await expect(logInfo("a", "b")).resolves.toBeUndefined();
  });

  it("never throws when the bridge itself is missing", async () => {
    mocks.invoke.mockImplementation(() => {
      throw new Error("no bridge");
    });
    await expect(logError("a", "b")).resolves.toBeUndefined();
    await expect(logWarning("a", "b")).resolves.toBeUndefined();
  });

  it("describes values that can't be turned into JSON", async () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    await logWarning("cycle", loop);
    expect(mocks.invoke).toHaveBeenCalledWith("log_frontend_entry", {
      level: "warning",
      message: "cycle: [object Object]",
    });
  });

  it("writes a burst of the same error once, then how many more came", async () => {
    for (let at = 0; at < 40; at += 1) {
      await logError("UI crash", new Error("removeChild failed"));
    }
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenLastCalledWith("log_frontend_error", {
      message: expect.stringMatching(/^UI crash: Error: removeChild failed\n/u),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenLastCalledWith("log_frontend_error", {
      message: "UI crash: Error: removeChild failed (repeated 39 more times within 10 s)",
    });
  });

  it("says nothing more when an error came only once", async () => {
    await logError("save file", "disk full");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("counts one repeat in the singular", async () => {
    await logWarning("thumbnail", "slow");
    await logWarning("thumbnail", "slow");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.invoke).toHaveBeenLastCalledWith("log_frontend_entry", {
      level: "warning",
      message: "thumbnail: slow (repeated 1 more time within 10 s)",
    });
  });

  it("keeps different errors and different levels apart", async () => {
    await logError("save file", "disk full");
    await logError("save file", "permission denied");
    await logWarning("save file", "disk full");
    await logInfo("save file", "disk full");
    expect(mocks.invoke).toHaveBeenCalledTimes(4);
  });

  it("writes the same error again once the window has passed", async () => {
    await logError("save file", "disk full");
    await vi.advanceTimersByTimeAsync(10_000);
    await logError("save file", "disk full");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("logs uncaught errors and rejections as errors, and the resize observer notice as a note", () => {
    const target = new EventTarget() as Window;
    installErrorLogging(target);
    target.dispatchEvent(
      Object.assign(new Event("error"), { message: "ResizeObserver loop completed with undelivered notifications." }),
    );
    target.dispatchEvent(Object.assign(new Event("error"), { message: "boom", error: new Error("boom") }));
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "no answer" }));
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "log_frontend_entry", {
      level: "info",
      message: "layout: ResizeObserver loop completed with undelivered notifications.",
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "log_frontend_error", {
      message: expect.stringMatching(/^Uncaught error: Error: boom\n/u),
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "log_frontend_error", {
      message: "Unhandled promise rejection: no answer",
    });
  });

  it("holds back an import a page reload cut off, and keeps a real one an error", async () => {
    const target = new EventTarget() as Window;
    installErrorLogging(target);
    const cutOff = new TypeError("Importing a module script failed.");
    const settled = async (logged: Promise<void>) => {
      await vi.advanceTimersByTimeAsync(IMPORT_FAILURE_GRACE_MS);
      await logged;
    };
    await settled(logError("start the MCP bridge", cutOff));
    const leaving = logError("collab live", cutOff);
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: cutOff }));
    target.dispatchEvent(new Event("pagehide"));
    await settled(leaving);
    await logError("save file", new Error("disk full"));
    target.dispatchEvent(new Event("pageshow"));
    await settled(logError("load a view", cutOff));
    const written = mocks.invoke.mock.calls.map(([command, args]) => [command, headline(args.message)]);
    expect(written).toEqual([
      ["log_frontend_error", "start the MCP bridge: TypeError: Importing a module script failed."],
      ["log_frontend_entry", "collab live: TypeError: Importing a module script failed."],
      ["log_frontend_entry", "Unhandled promise rejection: TypeError: Importing a module script failed."],
      ["log_frontend_error", "save file: Error: disk full"],
      ["log_frontend_error", "load a view: TypeError: Importing a module script failed."],
    ]);
  });
});

function headline(message: string): string {
  return message.split("\n")[0];
}
