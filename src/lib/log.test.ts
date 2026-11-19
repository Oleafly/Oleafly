import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { installErrorLogging, logError, logInfo, logWarning } from "./log";

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
});
