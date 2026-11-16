import { describe, expect, it, vi } from "vitest";
import type { PdfAnnotation } from "@/lib/tauri";
import { placeAnnotation, placeAnnotations, type PlaceDeps } from "./place";

function note(patch: Partial<PdfAnnotation> = {}): PdfAnnotation {
  return {
    id: "a",
    number: 1,
    kind: "comment",
    comment: "",
    quote: { text: "holds", before: "the result ", after: " here" },
    page: 2,
    source: { path: "main.tex", startLine: 2, endLine: 2, excerpt: "the result holds here" },
    boxes: [{ page: 2, x: 1, y: 1, width: 1, height: 1 }],
    build: "old",
    origin: "pdf",
    status: "sent",
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

const line = { page: 3, x: 72, y: 100, width: 400, height: 10 };

function deps(patch: Partial<PlaceDeps> = {}): PlaceDeps {
  return {
    textOf: () => "% added\nintro\nthe result holds here\n",
    linesOf: vi.fn(async () => [line]),
    runsOf: vi.fn(async () => [{ str: "the result holds here", x: 72, top: 100, width: 400, height: 10 }]),
    findQuote: vi.fn(() => [{ page: 3, x: 140, y: 100, width: 30, height: 10 }]),
    ...patch,
  };
}

describe("placeAnnotation", () => {
  it("follows the source lines, finds the typeset lines and narrows them with the quote", async () => {
    const d = deps();
    const update = await placeAnnotation(note(), "new", d);
    expect(d.linesOf).toHaveBeenCalledWith("main.tex", 3, 3);
    expect(d.findQuote).toHaveBeenCalledWith(3, expect.any(Array), note().quote, { y: 100 });
    expect(update).toEqual({
      id: "a",
      build: "new",
      page: 3,
      boxes: [{ page: 3, x: 140, y: 100, width: 30, height: 10 }],
      source: { path: "main.tex", startLine: 3, endLine: 3, excerpt: "the result holds here" },
      status: "sent",
    });
  });

  it("needs placing only when the lines are gone or nothing is typeset from them", async () => {
    expect(await placeAnnotation(note(), "new", deps({ textOf: () => "other\n" }))).toMatchObject({ status: "needsPlacing", boxes: [] });
    expect(await placeAnnotation(note(), "new", deps({ linesOf: async () => [] }))).toMatchObject({ status: "needsPlacing" });
    expect(await placeAnnotation(note({ source: null }), "new", deps())).toMatchObject({ status: "needsPlacing" });
  });

  it("falls back to the typeset lines when the quote is not found or the page text is not ready", async () => {
    const onLines = { status: "sent", page: 3, boxes: [line] };
    expect(await placeAnnotation(note(), "new", deps({ findQuote: () => null }))).toMatchObject(onLines);
    expect(await placeAnnotation(note(), "new", deps({ runsOf: async () => null }))).toMatchObject(onLines);
  });

  it("uses the stored lines when the file is not loaded", async () => {
    const d = deps({ textOf: () => null });
    await placeAnnotation(note(), "new", d);
    expect(d.linesOf).toHaveBeenCalledWith("main.tex", 2, 2);
  });

  it("covers the typeset lines for a region and brings a note back once it is found", async () => {
    const d = deps({ linesOf: async () => [line, { ...line, y: 112 }, { ...line, page: 4 }] });
    const update = await placeAnnotation(note({ kind: "region", quote: { text: "", before: "", after: "" }, status: "needsPlacing" }), "new", d);
    expect(update).toMatchObject({ status: "draft", page: 3, boxes: [{ page: 3, x: 72, y: 100, width: 400, height: 22 }] });
  });
});

describe("placeAnnotations", () => {
  it("places notes from another build or still needing placing, reading each page once", async () => {
    const d = deps();
    const updates = await placeAnnotations(
      [note({ id: "a" }), note({ id: "b" }), note({ id: "c", build: "new" }), note({ id: "d", build: "new", status: "needsPlacing" })],
      "new",
      d,
    );
    expect(updates.map((update) => update.id)).toEqual(["a", "b", "d"]);
    expect(d.runsOf).toHaveBeenCalledTimes(1);
  });
});
