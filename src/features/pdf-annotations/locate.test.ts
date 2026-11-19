import { describe, expect, it, vi } from "vitest";
import { locateSource, regionProbePoints } from "./locate";

const text = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n");

describe("locateSource", () => {
  it("spans the lines between both ends of a selection in one file", async () => {
    const lineAt = vi
      .fn()
      .mockResolvedValueOnce({ path: "main.tex", line: 9 })
      .mockResolvedValueOnce({ path: "main.tex", line: 7 });
    const source = await locateSource(
      { page: 1, x: 10, y: 20 },
      { page: 1, x: 90, y: 40 },
      null,
      lineAt,
      () => text,
    );
    expect(lineAt).toHaveBeenNthCalledWith(1, 1, 10, 20, null);
    expect(lineAt).toHaveBeenNthCalledWith(2, 1, 90, 40, null);
    expect(source).toEqual({ path: "main.tex", startLine: 7, endLine: 9, excerpt: "line 7\nline 8\nline 9" });
  });

  it("stays in the first file when the ends land in different files", async () => {
    const lineAt = vi
      .fn()
      .mockResolvedValueOnce({ path: "a.tex", line: 5 })
      .mockResolvedValueOnce({ path: "b.tex", line: 1 });
    const source = await locateSource({ page: 1, x: 0, y: 0 }, { page: 2, x: 0, y: 0 }, null, lineAt, () => text);
    expect(source).toEqual({ path: "a.tex", startLine: 5, endLine: 5, excerpt: "line 5" });
  });

  it("uses whichever end resolves, and keeps the place without the text", async () => {
    const lineAt = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ path: "b.tex", line: 4 });
    const source = await locateSource({ page: 1, x: 0, y: 0 }, { page: 1, x: 0, y: 0 }, null, lineAt, () => null);
    expect(source).toEqual({ path: "b.tex", startLine: 4, endLine: 4, excerpt: "" });
  });

  it("gives up without a file", async () => {
    const lineAt = vi.fn().mockResolvedValue({ path: null, line: 3 });
    expect(await locateSource({ page: 1, x: 0, y: 0 }, { page: 1, x: 0, y: 0 }, null, lineAt, () => text)).toBeNull();
    lineAt.mockResolvedValue(null);
    expect(await locateSource({ page: 1, x: 0, y: 0 }, { page: 1, x: 0, y: 0 }, null, lineAt, () => text)).toBeNull();
  });
});

describe("regionProbePoints", () => {
  it("probes the middle of a box's top and bottom edges, just inside", () => {
    expect(regionProbePoints({ page: 4, x: 100, y: 200, width: 50, height: 40 })).toEqual([
      { page: 4, x: 125, y: 202 },
      { page: 4, x: 125, y: 238 },
    ]);
  });
});
