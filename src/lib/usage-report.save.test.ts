// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tauri: false,
  pickSavePath: vi.fn(async (_options: unknown): Promise<string | null> => null),
  writeBytesFile: vi.fn(async (_path: string, _base64: string) => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.tauri, invoke: vi.fn() }));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: mocks.pickSavePath }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  writeBytesFile: mocks.writeBytesFile,
}));

import { msFromIsoDay, saveUsageReportCsv, usageReportCsv, type UsageReport } from "./usage-report";

const DAY = 86_400_000;

function emptyReport(): UsageReport {
  return {
    startMs: 0,
    endMs: 2 * DAY,
    timezone: "UTC",
    generatedAtMs: 0,
    totals: {} as UsageReport["totals"],
    daily: [],
    heatmap: [],
    byProject: [],
    byRuntime: [],
    byProvider: [],
    byModel: [],
    sessions: { page: 0, pageSize: 25, total: 0, items: [] },
  };
}

beforeEach(() => {
  mocks.tauri = false;
  mocks.pickSavePath.mockReset().mockResolvedValue(null);
  mocks.writeBytesFile.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("saveUsageReportCsv", () => {
  it("downloads the CSV through the browser outside the desktop shell", async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn((_blob: Blob) => "blob:usage");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("oleafly-usage-1970-01-01-1970-01-02.csv");
      expect(this.href).toBe("blob:usage");
      expect(this.rel).toBe("noopener");
    });
    const report = emptyReport();
    await expect(saveUsageReportCsv(report)).resolves.toBeNull();
    expect(click).toHaveBeenCalledOnce();
    expect(await createObjectURL.mock.calls[0][0].text()).toBe(usageReportCsv(report));
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:usage");
    expect(mocks.pickSavePath).not.toHaveBeenCalled();
  });

  it("writes the CSV where the user chose in the desktop shell", async () => {
    mocks.tauri = true;
    mocks.pickSavePath.mockResolvedValue("/reports/usage.csv");
    const report = emptyReport();
    await expect(saveUsageReportCsv(report)).resolves.toBe("/reports/usage.csv");
    expect(mocks.pickSavePath).toHaveBeenCalledWith({
      defaultPath: "oleafly-usage-1970-01-01-1970-01-02.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    const [path, base64] = mocks.writeBytesFile.mock.calls[0];
    expect(path).toBe("/reports/usage.csv");
    expect(new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)))).toBe(usageReportCsv(report));
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    mocks.tauri = true;
    await expect(saveUsageReportCsv(emptyReport())).resolves.toBeNull();
    expect(mocks.writeBytesFile).not.toHaveBeenCalled();
  });
});

describe("msFromIsoDay", () => {
  it("parses a day and rejects text that is not one", () => {
    expect(msFromIsoDay("1970-01-02")).toBe(DAY);
    expect(msFromIsoDay("not-a-day")).toBeNull();
  });
});
