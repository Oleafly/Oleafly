import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  open: vi.fn(async (_url: string) => {}),
  platform: vi.fn(() => "macos"),
  arch: vi.fn(() => "aarch64"),
  version: vi.fn(() => "15.1"),
  appVersion: vi.fn(async () => "0.4.4"),
  readAppLog: vi.fn(async (_max: number) => "line one\nline two\n"),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/plugin-os", () => ({
  platform: mocks.platform,
  arch: mocks.arch,
  version: mocks.version,
}));
vi.mock("@/lib/tauri", () => ({ appVersion: mocks.appVersion, readAppLog: mocks.readAppLog }));

import { reportCrashToGithub } from "./crash-report";

function openedUrl(): URL {
  expect(mocks.open).toHaveBeenCalledOnce();
  return new URL(mocks.open.mock.calls[0][0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isTauri.mockReturnValue(true);
  mocks.platform.mockReturnValue("macos");
  mocks.appVersion.mockResolvedValue("0.4.4");
  mocks.readAppLog.mockResolvedValue("line one\nline two\n");
  mocks.open.mockResolvedValue(undefined);
});

describe("reportCrashToGithub", () => {
  it("opens a pre-filled crash issue with system details, the error and the log", async () => {
    await reportCrashToGithub("TypeError: x is undefined");
    const url = openedUrl();
    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/Oleafly/Oleafly/issues/new");
    expect(url.searchParams.get("title")).toBe("Crash: TypeError: x is undefined");
    expect(url.searchParams.get("labels")).toBe("crash");
    const body = url.searchParams.get("body") ?? "";
    expect(body).toContain("<!-- Please review the details below, then click Submit. -->");
    expect(body).toContain("- Oleafly: v0.4.4");
    expect(body).toContain("- OS: macos aarch64 (15.1)");
    expect(body).toMatch(/- Time: \d{4}-\d{2}-\d{2}T/);
    expect(body).toContain("### Error\n```\nTypeError: x is undefined\n```");
    expect(body).toContain("### Recent log (app.log)\n```\nline one\nline two\n```");
    expect(mocks.readAppLog).toHaveBeenCalledWith(5000);
  });

  it("uses a generic title and leaves out the error and empty log sections", async () => {
    mocks.readAppLog.mockResolvedValue("   \n");
    await reportCrashToGithub();
    const url = openedUrl();
    expect(url.searchParams.get("title")).toBe("Crash report");
    const body = url.searchParams.get("body") ?? "";
    expect(body).not.toContain("### Error");
    expect(body).not.toContain("### Recent log");
  });

  it("skips system lines it cannot read and still opens the issue", async () => {
    mocks.appVersion.mockRejectedValue(new Error("no ipc"));
    mocks.platform.mockImplementation(() => {
      throw new Error("no os plugin");
    });
    mocks.readAppLog.mockRejectedValue(new Error("unreadable"));
    await reportCrashToGithub("boom");
    const body = openedUrl().searchParams.get("body") ?? "";
    expect(body).not.toContain("- Oleafly:");
    expect(body).not.toContain("- OS:");
    expect(body).toContain("- Time:");
    expect(body).not.toContain("### Recent log");
  });

  it("omits OS details outside the desktop shell", async () => {
    mocks.isTauri.mockReturnValue(false);
    await reportCrashToGithub("boom");
    const body = openedUrl().searchParams.get("body") ?? "";
    expect(body).not.toContain("- OS:");
    expect(mocks.platform).not.toHaveBeenCalled();
  });

  it("truncates the log head so the encoded body stays under the URL budget", async () => {
    const log = Array.from({ length: 400 }, (_, i) => `entry ${i} with spaces & symbols/é`).join("\n");
    mocks.readAppLog.mockResolvedValue(log);
    await reportCrashToGithub("boom");
    const url = openedUrl();
    const body = url.searchParams.get("body") ?? "";
    expect(encodeURIComponent(body).length).toBeLessThanOrEqual(7000);
    expect(body).toContain("entry 0 with spaces");
    expect(body).not.toContain("entry 399 with spaces");
    expect(body).toContain("…(truncated, attach ~/.oleafly/app.log for the full log)\n```");
    expect(body).toContain("### Error\n```\nboom\n```");
  });

  it("swallows a failure to open the browser", async () => {
    mocks.open.mockRejectedValue(new Error("no shell"));
    await expect(reportCrashToGithub("boom")).resolves.toBeUndefined();
  });
});
