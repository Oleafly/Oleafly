import { describe, expect, it, vi } from "vitest";
import { createPdfLoadAttempts } from "./pdfLoadStrategy";

describe("PDF load strategy", () => {
  it("falls back to the main-thread worker after one failed text-capable worker attempt", async () => {
    const open = vi.fn(async () => "open");
    const openAndProbe = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("worker unavailable"))
      .mockResolvedValueOnce("fallback");
    const enableMainThread = vi.fn(async () => {});
    const attempts = createPdfLoadAttempts(true, open, openAndProbe, enableMainThread);

    await expect(attempts[0]()).rejects.toThrow("worker unavailable");
    await expect(attempts[1]()).resolves.toBe("fallback");
    expect(open).not.toHaveBeenCalled();
    expect(enableMainThread).toHaveBeenCalledOnce();
    expect(openAndProbe).toHaveBeenCalledTimes(2);
  });

  it("uses the same fallback for PDFs that legitimately contain no text", async () => {
    const open = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("worker unavailable"))
      .mockResolvedValueOnce("fallback");
    const openAndProbe = vi.fn(async () => "probed");
    const enableMainThread = vi.fn(async () => {});
    const attempts = createPdfLoadAttempts(false, open, openAndProbe, enableMainThread);

    await expect(attempts[0]()).rejects.toThrow("worker unavailable");
    await expect(attempts[1]()).resolves.toBe("fallback");
    expect(openAndProbe).not.toHaveBeenCalled();
    expect(enableMainThread).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledTimes(2);
  });
});
