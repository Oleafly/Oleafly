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
    placement: "placed",
    createdAt: 0,
    updatedAt: 7,
    ...patch,
  };
}

const line = { page: 3, x: 72, y: 100, width: 400, height: 10 };
const found = { page: 3, x: 140, y: 100, width: 30, height: 10 };

function deps(patch: Partial<PlaceDeps> = {}): PlaceDeps {
  return {
    compiledText: () => ({ path: "main.tex", text: "% added\nintro\nthe result holds here\n", current: true }),
    linesOf: vi.fn(async () => [line]),
    runsOf: vi.fn(async () => [{ str: "the result holds here", x: 72, top: 100, width: 400, height: 10 }]),
    findQuote: vi.fn(() => [found]),
    ...patch,
  };
}

describe("placeAnnotation", () => {
  it("follows the lines in the built text, finds them typeset and narrows them with the quote", async () => {
    const d = deps();
    const update = await placeAnnotation(note(), "new", d);
    expect(d.linesOf).toHaveBeenCalledWith("main.tex", 3, 3);
    expect(d.findQuote).toHaveBeenCalledWith(3, expect.any(Array), note().quote, { y: 100 });
    expect(update).toEqual({
      id: "a",
      expectedUpdatedAt: 7,
      build: "new",
      page: 3,
      boxes: [found],
      placement: "placed",
      source: { path: "main.tex", startLine: 3, endLine: 3, excerpt: "the result holds here" },
    });
  });

  it("never writes the review status", async () => {
    for (const patch of [{}, { source: null }, { placement: "needsPlacing" as const }]) {
      const update = await placeAnnotation(note({ status: "resolved", ...patch }), "new", deps());
      expect(update).not.toHaveProperty("status");
    }
    const lost = await placeAnnotation(note({ status: "resolved", source: null }), "new", deps({ findQuote: () => null }));
    expect(lost).toEqual({ id: "a", expectedUpdatedAt: 7, build: "new", boxes: [], placement: "needsPlacing" });
  });

  it("keeps the stored lines when the PDF was built from older text", async () => {
    const update = await placeAnnotation(
      note(),
      "new",
      deps({ compiledText: () => ({ path: "main.tex", text: "% added\nintro\nthe result holds here\n", current: false }) }),
    );
    expect(update).toMatchObject({ placement: "placed", boxes: [found] });
    expect(update).not.toHaveProperty("source");
  });

  it("looks for the quote on the stored page and its neighbours when sync gives nothing", async () => {
    const runsOf = vi.fn(async (_page: number) => [{ str: "the result holds here", x: 72, top: 100, width: 400, height: 10 }]);
    const findQuote = vi.fn((page: number) => (page === 3 ? [found] : null));
    const update = await placeAnnotation(note({ source: null }), "new", deps({ runsOf, findQuote }));
    expect(runsOf.mock.calls.map(([page]) => page)).toEqual([2, 1, 3]);
    expect(update).toMatchObject({ placement: "placed", page: 3, boxes: [found] });

    const noSync = await placeAnnotation(note(), "new", deps({ linesOf: async () => null, findQuote: () => [found] }));
    expect(noSync).toMatchObject({ placement: "placed", boxes: [found] });
    const noText = await placeAnnotation(note(), "new", deps({ compiledText: () => null, findQuote: () => [found] }));
    expect(noText).toMatchObject({ placement: "placed", boxes: [found] });
  });

  it("needs placing only when neither the lines nor the quote can be found", async () => {
    const nowhere = { findQuote: () => null };
    expect(
      await placeAnnotation(note(), "new", deps({ ...nowhere, compiledText: () => ({ path: "main.tex", text: "other\n", current: true }) })),
    ).toMatchObject({ placement: "needsPlacing", boxes: [] });
    expect(await placeAnnotation(note(), "new", deps({ ...nowhere, linesOf: async () => [] }))).toMatchObject({
      placement: "needsPlacing",
    });
  });

  it("falls back to the typeset lines when the quote isn't found or the page text fails", async () => {
    const onLines = { placement: "placed", page: 3, boxes: [line] };
    expect(await placeAnnotation(note(), "new", deps({ findQuote: () => null }))).toMatchObject(onLines);
    expect(await placeAnnotation(note(), "new", deps({ runsOf: async () => null }))).toMatchObject(onLines);
    const failing = deps({ runsOf: vi.fn(() => Promise.reject(new Error("timed out"))) });
    expect(await placeAnnotation(note(), "new", failing)).toMatchObject(onLines);
  });

  it("keeps a drawn region box while its lines are unchanged, and covers the new lines otherwise", async () => {
    const lines = [{ ...line, page: 2 }, { ...line, page: 2, y: 112 }, { ...line, page: 4 }];
    const region = note({
      kind: "region",
      quote: { text: "", before: "", after: "" },
      source: { path: "main.tex", startLine: 3, endLine: 3, excerpt: "the result holds here" },
    });
    const same = await placeAnnotation(region, "new", deps({ linesOf: async () => lines }));
    expect(same).toMatchObject({ placement: "placed", boxes: region.boxes });

    const shifted = { path: "main.tex", startLine: 9, endLine: 9, excerpt: "the result holds here" };
    const moved = await placeAnnotation({ ...region, source: shifted }, "new", deps({ linesOf: async () => lines }));
    expect(moved).toMatchObject({ placement: "placed", page: 2, boxes: [{ page: 2, x: 72, y: 100, width: 400, height: 22 }] });
  });
});

describe("placeAnnotations", () => {
  it("places every note it is given, in order, reading each page once", async () => {
    const d = deps();
    const updates = await placeAnnotations(
      [note({ id: "a" }), note({ id: "b" }), note({ id: "c" }), note({ id: "d" }), note({ id: "e" })],
      "new",
      d,
    );
    expect(updates.map((update) => update.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(d.runsOf).toHaveBeenCalledTimes(1);
  });
});
