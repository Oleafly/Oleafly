import type { SyncTexIndex } from "@oleafly/compile-port";
import { describe, expect, it, vi } from "vitest";
import { forwardSync, type SyncView } from "./sync";

function view(line: number) {
  const shown: unknown[] = [];
  const sync: SyncView = {
    cursor: () => ({ line, word: null }),
    pageText: async () => null,
    show: (rect) => shown.push(rect),
  };
  return { sync, shown };
}

function index(): SyncTexIndex & { forward: ReturnType<typeof vi.fn> } {
  return {
    forward: vi.fn(async (_file: string, line: number) => ({ page: 1, x: 10, y: line, width: 5, height: 5 })),
    inverse: vi.fn(async () => null),
    dispose: vi.fn(),
  };
}

describe("forward search", () => {
  it("searches for the line the cursor's line had when the PDF was compiled", async () => {
    const searched = index();
    const { sync, shown } = view(12);
    expect(await forwardSync(searched, "main.tex", sync, async (line) => line - 10)).toBe(true);
    expect(searched.forward).toHaveBeenCalledWith("main.tex", 2);
    expect(shown).toHaveLength(1);
  });

  it("does not jump when the line has no place in the compiled source", async () => {
    const searched = index();
    const { sync, shown } = view(12);
    expect(await forwardSync(searched, "main.tex", sync, async () => null)).toBe(false);
    expect(searched.forward).not.toHaveBeenCalled();
    expect(shown).toEqual([]);
  });
});
