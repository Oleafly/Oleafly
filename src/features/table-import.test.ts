import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readPickedFileBase64: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  readPickedFileBase64: mocks.readPickedFileBase64,
}));

import { emitTable, readTableRows } from "./table-import";

function csvBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readTableRows", () => {
  it("parses CSV with quoted commas through the backend read", async () => {
    mocks.readPickedFileBase64.mockResolvedValue(
      csvBase64('Method,Note\nours,"beats, the rest"\n'),
    );
    const rows = await readTableRows("/tmp/results.csv");
    expect(rows).toEqual([
      ["Method", "Note"],
      ["ours", "beats, the rest"],
    ]);
  });

  it("throws the backend error for oversized files", async () => {
    mocks.readPickedFileBase64.mockRejectedValue(
      new Error("that file is larger than the 16 MB table-import limit"),
    );
    await expect(readTableRows("/tmp/huge.csv")).rejects.toThrow(/16 MB/);
  });
});

describe("emitTable", () => {
  it("routes to the typst emitter and keeps escapes", () => {
    const source = emitTable(
      [
        ["A", "B"],
        ["x&y", "50%"],
      ],
      { header: true, target: "typst" },
    );
    expect(source).toContain("#table(");
    expect(source).toContain("[x&y]"); // & is not special in Typst markup
    expect(source).toContain("[50%]"); // % is not special in Typst markup
  });

  it("routes to the latex emitter with escaping", () => {
    const source = emitTable(
      [
        ["A", "B"],
        ["x&y", "50%"],
      ],
      { header: true, target: "latex", label: "tab:x" },
    );
    expect(source).toContain("\\begin{tabular}{lr}"); // 50% infers as numeric
    expect(source).toContain("x\\&y & 50\\%");
    expect(source).toContain("\\label{tab:x}");
  });
});
