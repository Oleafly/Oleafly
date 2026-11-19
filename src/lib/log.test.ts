import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { logError, logInfo, logWarning } from "./log";

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(undefined);
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
});
