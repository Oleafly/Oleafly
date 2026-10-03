import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  readCompiledPdf: vi.fn(),
  readProjectBytes: vi.fn(),
  readFileContent: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/tauri", () => ({
  readCompiledPdf: mocks.readCompiledPdf,
  readProjectBytes: mocks.readProjectBytes,
  readFileContent: mocks.readFileContent,
}));

import { loadPresentationNotes, loadPresentationPdf } from "./load";
import type { PresentationParams } from "./navigation";

const COMPILED: PresentationParams = {
  session: "s",
  projectId: "deck",
  source: { kind: "compiled" },
  start: 1,
  presenter: true,
  main: "slides/main.typ",
  typst: true,
};

const PDFPC = JSON.stringify({ pdfpcFormat: 2, pages: [{ idx: 1, label: "2", note: "From the pdfpc file" }] });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.readFileContent.mockResolvedValue("");
});

describe("loadPresentationPdf", () => {
  it("reads the compiled PDF or the chosen project file", async () => {
    mocks.readCompiledPdf.mockResolvedValue(new Uint8Array([1, 2]).buffer);
    mocks.readProjectBytes.mockResolvedValue(new Uint8Array([3]).buffer);
    expect([...(await loadPresentationPdf(COMPILED))]).toEqual([1, 2]);
    expect([...(await loadPresentationPdf({ ...COMPILED, source: { kind: "file", path: "talk.pdf" } }))]).toEqual([3]);
    expect(mocks.readProjectBytes).toHaveBeenCalledWith("deck", "talk.pdf");
  });
});

describe("loadPresentationNotes", () => {
  it("reads Typst speaker notes through typst", async () => {
    mocks.invoke.mockResolvedValue({ located: true, notes: [{ page: 2, value: { notes: "From Typst" } }], files: [] });
    mocks.readFileContent.mockResolvedValue(PDFPC);
    const notes = await loadPresentationNotes(COMPILED);
    expect(mocks.invoke).toHaveBeenCalledWith("typst_slide_notes", { projectId: "deck", offline: false });
    expect([...notes.entries()]).toEqual([[2, "From Typst"]]);
  });

  it("reads the notes of the variant and offline mode the slides were compiled with", async () => {
    mocks.invoke.mockResolvedValue({ located: true, notes: [], files: [] });
    await loadPresentationNotes({ ...COMPILED, variant: "review", offline: true });
    expect(mocks.invoke).toHaveBeenCalledWith("typst_slide_notes", {
      projectId: "deck",
      offline: true,
      typstVariant: "review",
    });
  });

  it("falls back to the pdfpc file next to the main document", async () => {
    mocks.invoke.mockRejectedValue(new Error("typst failed"));
    mocks.readFileContent.mockResolvedValue(PDFPC);
    const notes = await loadPresentationNotes(COMPILED);
    expect(mocks.readFileContent).toHaveBeenCalledWith("deck", "slides/main.pdfpc", true);
    expect([...notes.entries()]).toEqual([[2, "From the pdfpc file"]]);
  });

  it("reads only the pdfpc file for LaTeX decks and project PDFs", async () => {
    mocks.readFileContent.mockResolvedValue(PDFPC);
    await loadPresentationNotes({ ...COMPILED, typst: false, main: "beamer.tex" });
    await loadPresentationNotes({ ...COMPILED, source: { kind: "file", path: "talks/old.pdf" } });
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.readFileContent.mock.calls.map((call) => call[1])).toEqual(["beamer.pdfpc", "talks/old.pdfpc"]);
  });

  it("has no notes when nothing provides them", async () => {
    mocks.invoke.mockResolvedValue(null);
    expect((await loadPresentationNotes(COMPILED)).size).toBe(0);
  });
});
