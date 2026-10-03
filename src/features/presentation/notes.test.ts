import { describe, expect, it } from "vitest";
import {
  contentToText,
  notesFromPdfpcFile,
  notesFromTypstQuery,
  parsePdfpcText,
  pdfpcPathFor,
} from "./notes";

const entries = (map: ReadonlyMap<number, string>) => [...map.entries()];

describe("contentToText", () => {
  it("reads strings and Typst content trees", () => {
    expect(contentToText("Plain note")).toBe("Plain note");
    expect(
      contentToText({
        func: "sequence",
        children: [
          { func: "text", text: "Content" },
          { func: "space" },
          { func: "strong", body: { func: "text", text: "notes" } },
          { func: "parbreak" },
          { func: "text", text: "Second" },
          { func: "linebreak" },
          { func: "smartquote", double: true },
          { func: "text", text: "line" },
          { func: "smartquote", double: false },
        ],
      }),
    ).toBe("Content notes\n\nSecond\n\"line'");
    expect(contentToText(null)).toBe("");
    expect(contentToText(42)).toBe("42");
  });
});

describe("notesFromPdfpcFile", () => {
  it("reads pdfpc pages and repeats a slide note on its overlay pages", () => {
    const notes = notesFromPdfpcFile({
      pdfpcFormat: 2,
      pages: [
        { idx: 0, label: "1", overlay: 0, note: "Welcome" },
        { idx: 1, label: "2", overlay: 0, note: "Build up" },
        { idx: 2, label: "2", overlay: 1 },
        { idx: 3, label: "3", overlay: 0, note: "" },
      ],
    });
    expect(entries(notes)).toEqual([
      [1, "Welcome"],
      [2, "Build up"],
      [3, "Build up"],
    ]);
  });

  it("ignores data that is not a pdfpc document", () => {
    expect(notesFromPdfpcFile("nope").size).toBe(0);
    expect(notesFromPdfpcFile({ pages: "x" }).size).toBe(0);
  });
});

describe("parsePdfpcText", () => {
  it("reads the JSON format", () => {
    expect(entries(parsePdfpcText('{"pdfpcFormat":2,"pages":[{"idx":4,"note":"Fifth"}]}'))).toEqual([[5, "Fifth"]]);
  });

  it("reads the older notes section format", () => {
    const text = ["[file]", "talk.pdf", "[notes]", "### 1", "Open with the question", "", "### 3", "Show the chart", "[end_user_slide]", "4"].join("\n");
    expect(entries(parsePdfpcText(text))).toEqual([
      [1, "Open with the question"],
      [3, "Show the chart"],
    ]);
  });

  it("returns nothing for empty or broken files", () => {
    expect(parsePdfpcText("").size).toBe(0);
    expect(parsePdfpcText("{ broken").size).toBe(0);
  });
});

describe("notesFromTypstQuery", () => {
  it("places located notes on their pages", () => {
    const notes = notesFromTypstQuery({
      located: true,
      notes: [
        { page: 1, value: { notes: "Say hello first" } },
        { page: 2, value: { t: "Note", v: "Polylux style" } },
        { page: 2, value: { t: "NewSlide" } },
        { page: 2, value: { note: { func: "text", text: "and more" } } },
        { page: 4, value: "Plain string" },
      ],
      files: [],
    });
    expect(entries(notes)).toEqual([
      [1, "Say hello first"],
      [2, "Polylux style\n\nand more"],
      [4, "Plain string"],
    ]);
  });

  it("prefers a complete pdfpc export such as the one touying writes", () => {
    const notes = notesFromTypstQuery({
      located: true,
      notes: [{ page: 1, value: { t: "Note", v: "Partial" } }],
      files: [{ pdfpcFormat: 2, pages: [{ idx: 0, label: "1", note: "From touying" }] }],
    });
    expect(entries(notes)).toEqual([[1, "From touying"]]);
  });

  it("follows polylux slide indexes when pages are unknown", () => {
    const notes = notesFromTypstQuery({
      located: false,
      notes: [
        { t: "NewSlide" },
        { t: "Idx", v: 0 },
        { t: "Note", v: "First" },
        { t: "NewSlide" },
        { t: "Idx", v: 2 },
        { t: "Note", v: "Third page" },
      ],
      files: [],
    });
    expect(entries(notes)).toEqual([
      [1, "First"],
      [3, "Third page"],
    ]);
  });

  it("numbers plain notes in order when pages are unknown", () => {
    const notes = notesFromTypstQuery({
      located: false,
      notes: [{ notes: "One" }, { notes: "Two" }, { notes: "Five", page: 5 }],
      files: [],
    });
    expect(entries(notes)).toEqual([
      [1, "One"],
      [2, "Two"],
      [5, "Five"],
    ]);
  });
});

describe("pdfpcPathFor", () => {
  it("puts the notes file next to the PDF or main document", () => {
    expect(pdfpcPathFor("slides/talk.pdf")).toBe("slides/talk.pdfpc");
    expect(pdfpcPathFor("main.typ")).toBe("main.pdfpc");
    expect(pdfpcPathFor("deck.tex")).toBe("deck.pdfpc");
  });
});
