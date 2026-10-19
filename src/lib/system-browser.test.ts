// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  open: vi.fn(async (_url: string) => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));

import { openInSystemBrowser, safeHttpUrl } from "./system-browser";

describe("system browser links", () => {
  beforeEach(() => {
    mocks.isTauri.mockReset().mockReturnValue(true);
    mocks.open.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts http and https with a host only", () => {
    expect(safeHttpUrl("https://doi.org/10.1/x")).toBe("https://doi.org/10.1/x");
    expect(safeHttpUrl("  http://localhost:8080/a  ")).toBe("http://localhost:8080/a");
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "https://", "mailto:a@b.c", "  "]) {
      expect(safeHttpUrl(bad), bad).toBeNull();
    }
  });

  it("opens through the shell plugin inside Tauri", async () => {
    mocks.isTauri.mockReturnValue(true);
    await expect(openInSystemBrowser("https://example.org/a b")).resolves.toBe(true);
    expect(mocks.open).toHaveBeenCalledWith("https://example.org/a%20b");
  });

  it("refuses unsafe URLs without calling the opener", async () => {
    await expect(openInSystemBrowser("file:///x")).resolves.toBe(false);
    await expect(openInSystemBrowser("javascript:alert(1)")).resolves.toBe(false);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("reports a failed opener as false", async () => {
    mocks.open.mockRejectedValueOnce(new Error("no handler"));
    await expect(openInSystemBrowser("https://example.org")).resolves.toBe(false);
  });

  it("uses window.open with noopener outside Tauri", async () => {
    mocks.isTauri.mockReturnValue(false);
    const opened = vi.spyOn(window, "open").mockReturnValue({} as Window);
    await expect(openInSystemBrowser("https://example.org")).resolves.toBe(true);
    expect(opened).toHaveBeenCalledWith("https://example.org/", "_blank", "noopener,noreferrer");
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
