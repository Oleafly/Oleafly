import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  readText: vi.fn(async () => "from plugin"),
  writeText: vi.fn(async (_text: string) => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: mocks.readText,
  writeText: mocks.writeText,
}));

import { readClipboardText, writeClipboardText } from "./clipboard";

describe("clipboard text", () => {
  const browser = {
    readText: vi.fn(async () => "from browser"),
    writeText: vi.fn(async (_text: string) => {}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("navigator", { clipboard: browser });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("goes through the clipboard plugin inside Tauri", async () => {
    mocks.isTauri.mockReturnValue(true);

    await expect(readClipboardText()).resolves.toBe("from plugin");
    await writeClipboardText("copied");

    expect(mocks.writeText).toHaveBeenCalledWith("copied");
    expect(browser.readText).not.toHaveBeenCalled();
    expect(browser.writeText).not.toHaveBeenCalled();
  });

  it("falls back to the browser clipboard outside Tauri", async () => {
    mocks.isTauri.mockReturnValue(false);

    await expect(readClipboardText()).resolves.toBe("from browser");
    await writeClipboardText("copied");

    expect(browser.writeText).toHaveBeenCalledWith("copied");
    expect(mocks.readText).not.toHaveBeenCalled();
    expect(mocks.writeText).not.toHaveBeenCalled();
  });
});
