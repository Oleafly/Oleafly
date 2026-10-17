import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { cachedSystemFonts, listSystemFonts, resetSystemFontsCache } from "./system-fonts";

const FAMILIES = [
  { name: "Fira Code", monospace: true },
  { name: "iA Writer Quattro S", monospace: false },
];

afterEach(() => {
  resetSystemFontsCache();
  mocks.invoke.mockReset();
});

describe("system fonts", () => {
  it("shares one request between callers and keeps the answer", async () => {
    mocks.invoke.mockResolvedValue(FAMILIES);
    expect(cachedSystemFonts()).toBeNull();
    const [first, second] = await Promise.all([listSystemFonts(), listSystemFonts()]);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("list_system_fonts");
    expect(first).toBe(second);
    expect(cachedSystemFonts()).toEqual(FAMILIES);
  });

  it("asks again once the earlier request has finished", async () => {
    mocks.invoke.mockResolvedValueOnce(FAMILIES).mockResolvedValueOnce([FAMILIES[0]]);
    await listSystemFonts();
    await expect(listSystemFonts()).resolves.toEqual([FAMILIES[0]]);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(cachedSystemFonts()).toEqual([FAMILIES[0]]);
  });

  it("keeps the last good list when a request fails", async () => {
    mocks.invoke.mockResolvedValueOnce(FAMILIES).mockRejectedValueOnce(new Error("scan failed"));
    await listSystemFonts();
    await expect(listSystemFonts()).rejects.toThrow("scan failed");
    expect(cachedSystemFonts()).toEqual(FAMILIES);
    mocks.invoke.mockResolvedValueOnce([]);
    await expect(listSystemFonts()).resolves.toEqual([]);
  });
});
