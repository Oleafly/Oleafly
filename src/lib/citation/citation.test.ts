import { describe, it, expect } from "vitest";
import { detectInput } from "./detect";
import { parseEntry, generateCiteKey, setKey } from "./bibtex";
import { parseCrossrefSearch } from "./crossref";
import { arxivXmlToBibtex } from "./arxiv";
import { findKeyByDoi } from "./dedup";

describe("detectInput", () => {
  it("detects a bare DOI", () => {
    expect(detectInput("10.1145/3292500")).toEqual({ kind: "doi", value: "10.1145/3292500" });
  });
  it("extracts a DOI from a doi.org URL", () => {
    expect(detectInput("https://doi.org/10.1000/xyz123")).toEqual({ kind: "doi", value: "10.1000/xyz123" });
  });
  it("detects a modern arXiv id (with version stripped)", () => {
    expect(detectInput("arXiv:1706.03762v5")).toEqual({ kind: "arxiv", value: "1706.03762" });
  });
  it("extracts an arXiv id from an abs URL", () => {
    expect(detectInput("https://arxiv.org/abs/1706.03762")).toEqual({ kind: "arxiv", value: "1706.03762" });
  });
  it("falls back to a title search for free text", () => {
    expect(detectInput("Attention is all you need")).toEqual({ kind: "title", value: "Attention is all you need" });
  });
});

describe("parseEntry", () => {
  const bib = "@article{smith21, title = {A {Great} Paper}, author = {Smith, Jane and Doe, John}, year = {2021}, doi = {10.1/x}}";
  it("parses type, key, and fields (including nested braces)", () => {
    const p = parseEntry(bib)!;
    expect(p.type).toBe("article");
    expect(p.key).toBe("smith21");
    expect(p.fields.title).toBe("A {Great} Paper");
    expect(p.fields.year).toBe("2021");
    expect(p.fields.doi).toBe("10.1/x");
  });
  it("returns null for non-bibtex", () => {
    expect(parseEntry("not bibtex")).toBeNull();
  });
});

describe("generateCiteKey", () => {
  it("builds authorYEARword from the first author, year, and first title word", () => {
    const fields = { author: "Smith, Jane and Doe, John", year: "2021", title: "Deep learning of things" };
    expect(generateCiteKey(fields, new Set())).toBe("smith2021deep");
  });
  it("dedupes against existing keys with a letter suffix", () => {
    const fields = { author: "Smith, Jane", year: "2021", title: "Deep nets" };
    expect(generateCiteKey(fields, new Set(["smith2021deep"]))).toBe("smith2021deepa");
  });
  it("handles 'First Last' author format", () => {
    const fields = { author: "Jane Smith", year: "2020", title: "Vision" };
    expect(generateCiteKey(fields, new Set())).toBe("smith2020vision");
  });
});

describe("setKey", () => {
  it("replaces the citation key", () => {
    const out = setKey("@article{OLD, title={x}}", "newkey");
    expect(out).toContain("@article{newkey,");
    expect(out).not.toContain("OLD");
  });
});

describe("parseCrossrefSearch", () => {
  const json = JSON.stringify({
    message: {
      items: [
        {
          DOI: "10.1/a",
          title: ["A Title"],
          author: [{ family: "Smith", given: "Jane" }],
          issued: { "date-parts": [[2019]] },
          "container-title": ["Journal X"],
          type: "journal-article",
        },
      ],
    },
  });
  it("maps items to hits", () => {
    const hits = parseCrossrefSearch(json);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ doi: "10.1/a", title: "A Title", year: "2019", venue: "Journal X" });
    expect(hits[0].authors[0]).toContain("Smith");
  });
  it("returns [] for empty/garbage", () => {
    expect(parseCrossrefSearch("{}")).toEqual([]);
  });
});

describe("arxivXmlToBibtex", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <id>http://arxiv.org/abs/1706.03762v5</id>
      <published>2017-06-12T00:00:00Z</published>
      <title>Attention Is All You Need</title>
      <author><name>Ashish Vaswani</name></author>
      <author><name>Noam Shazeer</name></author>
    </entry></feed>`;
  it("builds a bibtex entry with title, authors, year, and eprint", () => {
    const bib = arxivXmlToBibtex(xml);
    const p = parseEntry(bib)!;
    expect(p.fields.title).toContain("Attention Is All You Need");
    expect(p.fields.author).toContain("Vaswani");
    expect(p.fields.author).toContain(" and ");
    expect(p.fields.year).toBe("2017");
    expect(p.fields.eprint).toBe("1706.03762");
  });
  it("returns empty string when there is no entry", () => {
    expect(arxivXmlToBibtex("<feed></feed>")).toBe("");
  });
});

describe("findKeyByDoi", () => {
  const bib = "@article{a2020, doi={10.1/AA}, title={x}}\n@book{b2019, title={y}}";
  it("finds an existing entry by DOI (case-insensitive)", () => {
    expect(findKeyByDoi(bib, "10.1/aa")).toBe("a2020");
  });
  it("returns null when the DOI is not present", () => {
    expect(findKeyByDoi(bib, "10.9/zz")).toBeNull();
  });
});
