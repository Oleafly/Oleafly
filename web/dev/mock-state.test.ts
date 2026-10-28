import { describe, expect, it } from "vitest";
import { TextOperation } from "../../src/features/collab/live/ot.ts";
import { mapPosition, minimalPdf, MockProject, Refusal, requestedByTheApp } from "./mock-state.ts";

function project(text = "Hello world") {
  const mock = new MockProject("p", "Demo", "olive");
  mock.addText("f", "main.tex", text);
  return mock;
}

describe("mock project", () => {
  it("maps positions through inserts and deletes", () => {
    const op = new TextOperation().retain(2).insert("XY").delete(3).retain(6);
    expect(mapPosition(op, 0, 1)).toBe(0);
    expect(mapPosition(op, 2, -1)).toBe(2);
    expect(mapPosition(op, 2, 1)).toBe(4);
    expect(mapPosition(op, 4, 1)).toBe(4);
    expect(mapPosition(op, 8, 1)).toBe(7);
  });

  it("transforms a change made on an older revision", () => {
    const mock = project("abc");
    mock.change("f", 0, ["X", 3], "olive", false);
    const result = mock.change("f", 0, [3, "!"], "eddie", false);
    expect(mock.text("f").text).toBe("Xabc!");
    expect(result.rev).toBe(2);
    expect(result.op.toWire()).toEqual([4, "!"]);
  });

  it("records suggestions, coalesces typing and shrinks own insertions", () => {
    const mock = project("Hello world");
    mock.change("f", 0, [5, " big", 6], "rita", true);
    mock.change("f", 1, [9, "!", 6], "rita", true);
    expect(mock.fileSuggestions("f")).toEqual([
      expect.objectContaining({ kind: "insert", author: "rita", from: 5, to: 10, text: " big!" }),
    ]);
    mock.change("f", 2, [9, -1, 6], "rita", true);
    expect(mock.fileSuggestions("f")).toEqual([expect.objectContaining({ kind: "insert", from: 5, to: 9, text: " big" })]);
    mock.change("f", 3, [10, -5], "rita", true);
    expect(mock.text("f").text).toBe("Hello big ");
    expect(mock.fileSuggestions("f")).toContainEqual(
      expect.objectContaining({ kind: "delete", from: 10, to: 10, text: "world" }),
    );
  });

  it("puts text back when a suggestion is rejected and keeps it when accepted", () => {
    const mock = project("Hello world");
    mock.change("f", 0, [6, -5], "rita", true);
    const [deletion] = mock.fileSuggestions("f");
    expect(mock.text("f").text).toBe("Hello ");
    const result = mock.resolveSuggestion(deletion.id, false);
    expect(result?.op.toWire()).toEqual([6, "world"]);
    expect(mock.text("f").text).toBe("Hello world");
    mock.change("f", mock.text("f").rev, [11, "!"], "rita", true);
    const [insertion] = mock.fileSuggestions("f");
    expect(mock.resolveSuggestion(insertion.id, true)).toBeNull();
    expect(mock.text("f").text).toBe("Hello world!");
    expect(mock.fileSuggestions("f")).toEqual([]);
    expect(() => mock.resolveSuggestion("missing", true)).toThrow(Refusal);
  });

  it("keeps comment anchors on their text and moves comment positions forward", () => {
    const mock = project("Hello world");
    const thread = mock.addThread("f", 6, 11, "cora", "Nice");
    mock.change("f", 0, [">> ", 11], "olive", false);
    expect(thread.anchor.range).toEqual({ from: 9, to: 14 });
    expect(mock.moveToCurrent("f", 0, 6, 1)).toBe(9);
    expect(() => mock.addThread("f", 3, 3, "cora", "x")).toThrow(Refusal);
    expect(() => mock.message("cora", "  ")).toThrow(Refusal);
  });

  it("lists every text file sorted by path", () => {
    const mock = project("Main");
    mock.addText("b", "chapters/b.tex", "B");
    mock.addText("a", "abstract.tex", "A");
    mock.addBlob("fig", "figures/plot.png", "hash");
    expect(mock.texts()).toEqual([
      { fileId: "a", path: "abstract.tex", text: "A" },
      { fileId: "b", path: "chapters/b.tex", text: "B" },
      { fileId: "f", path: "main.tex", text: "Main" },
    ]);
  });

  it("stores a PDF and a gzipped SyncTeX and refuses anything else", () => {
    const mock = project();
    const pdf = minimalPdf(["Hi"]);
    const synctex = new Uint8Array([0x1f, 0x8b, 8, 0, 1]);
    expect(mock.storeOutput("synctex", synctex, "eddie", "main.tex").kind).toBe("synctex");
    expect(mock.storeOutput("pdf", pdf, "eddie", " main.tex ").mainFile).toBe("main.tex");
    expect(mock.outputItems()).toEqual([
      expect.objectContaining({ kind: "pdf", size: pdf.length, compiledBy: "eddie", mainFile: "main.tex" }),
      expect.objectContaining({ kind: "synctex", size: synctex.length }),
    ]);
    const text = new TextEncoder().encode("<html>");
    expect(() => mock.storeOutput("pdf", text, "eddie", "main.tex")).toThrow(Refusal);
    expect(() => mock.storeOutput("synctex", text, "eddie", "main.tex")).toThrow(Refusal);
    expect(() => mock.storeOutput("html", pdf, "eddie", "main.tex")).toThrow(Refusal);
    expect(() => mock.storeOutput("pdf", pdf, "eddie", null)).toThrow(Refusal);
    expect(mock.outputs.get("pdf")?.bytes).toBe(pdf);
  });

  it("takes a change only from the web app on the same origin", () => {
    const host = "localhost:1430";
    const marked = { host, origin: `http://${host}`, "x-requested-with": "oleafly-web" };
    expect(requestedByTheApp(marked)).toBe(true);
    expect(requestedByTheApp({ ...marked, "x-requested-with": undefined })).toBe(false);
    expect(requestedByTheApp({ ...marked, origin: "https://evil.example" })).toBe(false);
    expect(requestedByTheApp({ ...marked, origin: undefined })).toBe(false);
  });

  it("writes a PDF with a valid cross-reference table", () => {
    const text = new TextDecoder().decode(minimalPdf(["Title (draft)"]));
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("(Title \\(draft\\)) Tj");
    const startxref = Number(/startxref\n(\d+)/u.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const firstObject = Number(/0000000000 65535 f \n(\d{10})/u.exec(text)?.[1]);
    expect(text.slice(firstObject, firstObject + 7)).toBe("1 0 obj");
  });
});
