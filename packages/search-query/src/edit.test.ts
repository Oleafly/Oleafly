import { describe, expect, it } from "vitest";
import {
  appendTerm,
  clearQualifiers,
  formatTerm,
  formatValue,
  readFacet,
  removeSpans,
  writeFacet,
  type Facet,
} from "./edit";
import { query } from "./testing";

const ENGINE: Facet = {
  keys: ["engine"],
  options: [
    { id: "typst", term: { key: "engine", values: ["typst"] } },
    { id: "markdown", term: { key: "engine", values: ["markdown"] } },
  ],
};

const STARRED: Facet = {
  keys: ["is"],
  values: ["starred"],
  options: [
    { id: "yes", term: { key: "is", values: ["starred"] } },
    { id: "no", term: { key: "is", values: ["starred"], negated: true } },
  ],
};

const PREVIEW: Facet = {
  keys: ["has", "no"],
  values: ["preview"],
  options: [
    { id: "yes", term: { key: "has", values: ["preview"] } },
    { id: "no", term: { key: "no", values: ["preview"] } },
  ],
};

const SORT: Facet = {
  keys: ["sort"],
  options: [{ id: "title-desc", term: { key: "sort", values: ["title-desc"] } }],
};

const CREATED: Facet = {
  keys: ["created"],
  options: [{ id: "week", term: { key: "created", values: [">=@today-7d"] } }],
};

function write(source: string, facet: Facet, id: string | null): string {
  return writeFacet(source, query(source), facet, id);
}

describe("formatting", () => {
  it("quotes values only when needed", () => {
    expect(formatValue("typst")).toBe("typst");
    expect(formatValue("Needs Testing")).toBe('"Needs Testing"');
    expect(formatValue("a,b")).toBe('"a,b"');
    expect(formatValue('say "hi"')).toBe('"say hi"');
    expect(formatValue("")).toBe('""');
  });

  it("formats whole terms", () => {
    expect(formatTerm({ key: "label", values: ["bug", "Needs Testing"], negated: true })).toBe(
      '-label:bug,"Needs Testing"',
    );
  });
});

describe("removeSpans and appendTerm", () => {
  it("removes spans with their trailing space", () => {
    expect(removeSpans("a engine:typst b", [{ start: 2, end: 14 }])).toBe("a b");
    expect(removeSpans("a engine:typst", [{ start: 2, end: 14 }])).toBe("a");
    expect(removeSpans("x y z", [{ start: 0, end: 1 }, { start: 4, end: 5 }])).toBe("y");
  });

  it("appends after the query and wraps a top-level OR", () => {
    expect(appendTerm("", query(""), "is:starred")).toBe("is:starred");
    expect(appendTerm("draft  ", query("draft  "), "is:starred")).toBe("draft is:starred");
    expect(appendTerm("a OR b", query("a OR b"), "is:starred")).toBe("(a OR b) is:starred");
    expect(appendTerm("(a OR b) c", query("(a OR b) c"), "is:starred")).toBe("(a OR b) c is:starred");
  });
});

describe("facets", () => {
  it("reads the option a single top-level term selects", () => {
    expect(readFacet(query("draft"), ENGINE)).toEqual({ kind: "none" });
    expect(readFacet(query("draft engine:Typst"), ENGINE)).toEqual({ kind: "option", id: "typst" });
    expect(readFacet(query("engine:md"), ENGINE)).toEqual({ kind: "option", id: "markdown" });
    expect(readFacet(query("-is:starred"), STARRED)).toEqual({ kind: "option", id: "no" });
    expect(readFacet(query("no:pdf"), PREVIEW)).toEqual({ kind: "option", id: "no" });
    expect(readFacet(query("created:>=@TODAY-7d"), CREATED)).toEqual({ kind: "option", id: "week" });
    expect(readFacet(query("sort:name"), SORT)).toEqual({ kind: "option", id: "title-desc" });
  });

  it("calls anything it cannot represent custom", () => {
    expect(readFacet(query("engine:typst,markdown"), ENGINE)).toEqual({ kind: "custom" });
    expect(readFacet(query("engine:typst engine:markdown"), ENGINE)).toEqual({ kind: "custom" });
    expect(readFacet(query("-engine:typst"), ENGINE)).toEqual({ kind: "custom" });
    expect(readFacet(query("engine:typst OR is:starred"), ENGINE)).toEqual({ kind: "custom" });
    expect(readFacet(query("created:>2026-01-01"), CREATED)).toEqual({ kind: "custom" });
  });

  it("only owns the flag values a facet lists", () => {
    expect(readFacet(query("has:tags"), PREVIEW)).toEqual({ kind: "none" });
    expect(write("has:tags has:preview", PREVIEW, null)).toBe("has:tags");
  });

  it("replaces, adds and removes the facet's top-level terms", () => {
    expect(write("draft", ENGINE, "typst")).toBe("draft engine:typst");
    expect(write("engine:typst draft", ENGINE, "markdown")).toBe("draft engine:markdown");
    expect(write("engine:typst draft", ENGINE, null)).toBe("draft");
    expect(write("is:starred", STARRED, "no")).toBe("-is:starred");
    expect(write("a OR b", ENGINE, "typst")).toBe("(a OR b) engine:typst");
  });

  it("leaves nested terms alone when writing", () => {
    expect(write("(engine:typst OR is:starred)", ENGINE, "markdown")).toBe(
      "(engine:typst OR is:starred) engine:markdown",
    );
  });
});

describe("clearQualifiers", () => {
  it("keeps free text and drops every qualifier", () => {
    expect(clearQualifiers("draft engine:typst -is:starred sort:title", query("draft engine:typst -is:starred sort:title"))).toBe("draft");
    expect(clearQualifiers("(a OR engine:typst) notes", query("(a OR engine:typst) notes"))).toBe("notes");
    expect(clearQualifiers("a OR engine:typst", query("a OR engine:typst"))).toBe("");
    expect(clearQualifiers("thesis", query("thesis"))).toBe("thesis");
  });
});
