import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };

const getConnectorKey = vi.hoisted(() => vi.fn(async (_id: string): Promise<string | null> => null));
vi.mock("@/lib/tauri", () => ({ getConnectorKey, literatureSearch: vi.fn() }));

import {
  LITERATURE_SOURCES,
  bibtexForLiteratureRecord,
  literatureIdentity,
  mergeLiteratureRecords,
  parseArxivLiterature,
  parseCrossrefLiterature,
  parseGoogleScholarLiterature,
  parseOpenAlexLiterature,
  parsePubMedLiterature,
  parseSemanticScholarLiterature,
  searchLiterature,
  type LiteratureRecord,
} from "./literature-search";

const CACHE_KEY = "oleafly.literature-search.cache.v1";

function record(overrides: Partial<LiteratureRecord>): LiteratureRecord {
  return {
    id: "crossref:x",
    sourceIds: { crossref: "x" },
    sources: ["crossref"],
    title: "A Title",
    authors: [],
    year: null,
    publicationDate: null,
    venue: null,
    type: null,
    doi: null,
    url: null,
    pdfUrl: null,
    abstract: null,
    citationCount: null,
    openAccess: null,
    ...overrides,
  };
}

describe("LITERATURE_SOURCES", () => {
  it("describes each source in the interface language and marks USPTO unavailable", () => {
    const sources = enCore.literatureSources;
    expect(LITERATURE_SOURCES.map((source) => [source.id, source.description, source.available])).toEqual([
      ["arxiv", sources.arxiv, true],
      ["semantic-scholar", sources.semanticScholar, true],
      ["crossref", sources.crossref, true],
      ["pubmed", sources.pubmed, true],
      ["openalex", sources.openalex, true],
      ["google-scholar", sources.googleScholar, true],
      ["uspto", sources.uspto, false],
    ]);
  });
});

describe("parsers with sparse or malformed input", () => {
  it("returns no records for unparsable payloads", () => {
    for (const parse of [
      parseCrossrefLiterature,
      parseOpenAlexLiterature,
      parseSemanticScholarLiterature,
      parseGoogleScholarLiterature,
      parsePubMedLiterature,
    ]) {
      expect(parse("not json").records).toEqual([]);
    }
    expect(parseArxivLiterature("<feed/>").records).toEqual([]);
  });

  it("reads Crossref titles, names and identifiers in every accepted form", () => {
    const parsed = parseCrossrefLiterature(
      JSON.stringify({
        message: {
          "total-results": "many",
          items: [
            { title: [] },
            {
              title: "Plain title",
              DOI: "doi: 10.1/abc",
              author: [{ name: "Consortium" }, { given: "Ada" }, {}],
              issued: { "date-parts": [["published 1999"]] },
              "container-title": "Venue",
            },
            { title: ["Second"], DOI: "11.2/not-a-doi", URL: "ftp://example.org/x" },
            { title: ["Third"], URL: "https://example.org/third" },
            { title: ["Fourth"], URL: "not a url" },
          ],
        },
      }),
    );
    expect(parsed.total).toBeNull();
    expect(parsed.records.map((entry) => [entry.id, entry.authors, entry.year, entry.venue, entry.doi, entry.url])).toEqual([
      ["crossref:10.1/abc", ["Consortium", "Ada"], 1999, "Venue", "10.1/abc", "https://doi.org/10.1/abc"],
      ["crossref:result-2", [], null, null, null, null],
      ["crossref:result-3", [], null, null, null, "https://example.org/third"],
      ["crossref:result-4", [], null, null, null, null],
    ]);
  });

  it("falls back through OpenAlex locations and ids", () => {
    const parsed = parseOpenAlexLiterature(
      JSON.stringify({
        results: [
          { title: "" },
          {
            title: "Landing only",
            primary_location: { landing_page_url: "https://example.org/landing", pdf_url: "https://example.org/a.pdf" },
            open_access: { is_oa: false },
          },
          { id: "https://openalex.org/W9", title: "Id only", authorships: [{ author: {} }] },
        ],
      }),
    );
    expect(parsed.total).toBeNull();
    expect(parsed.records.map((entry) => [entry.id, entry.url, entry.pdfUrl, entry.openAccess, entry.authors])).toEqual([
      ["openalex:result-1", "https://example.org/landing", "https://example.org/a.pdf", false, []],
      ["openalex:W9", "https://openalex.org/W9", null, null, []],
    ]);
  });

  it("keeps Semantic Scholar records without identifiers or PDFs", () => {
    const parsed = parseSemanticScholarLiterature(
      JSON.stringify({ data: [{ title: "No ids", url: "https://s2.org/p", authors: [{}] }, { title: null }] }),
    );
    expect(parsed.records).toEqual([
      expect.objectContaining({ id: "semantic-scholar:result-0", url: "https://s2.org/p", openAccess: null, pdfUrl: null, authors: [] }),
    ]);
  });

  it("treats non-arXiv Scholar hits as articles and arXiv PDF links as preprints", () => {
    const parsed = parseGoogleScholarLiterature(
      JSON.stringify({
        organic: [
          { title: "Journal hit", link: "https://journal.org/paper", year: "2019" },
          { title: "PDF hit", link: "https://arxiv.org/pdf/1901.00001v3.pdf" },
          { title: "No link" },
          { link: "https://journal.org/untitled" },
        ],
      }),
    );
    expect(parsed.total).toBe(3);
    expect(parsed.records.map((entry) => [entry.id, entry.type, entry.pdfUrl, entry.openAccess, entry.year])).toEqual([
      ["google-scholar:https://journal.org/paper", "article", null, null, 2019],
      ["google-scholar:1901.00001", "preprint", "https://arxiv.org/pdf/1901.00001", true, null],
      ["google-scholar:result-2", "article", null, null, null],
    ]);
  });

  it("skips PubMed summaries that are missing, malformed or untitled", () => {
    const parsed = parsePubMedLiterature(
      JSON.stringify({
        summary: {
          result: {
            uids: ["1", "2", "3", 4, "5"],
            "1": { title: "Has epub date", epubdate: "2020 Mar 1", authors: [{}] },
            "2": ["not", "a", "summary"],
            "3": { title: "" },
          },
        },
      }),
    );
    expect(parsed.total).toBeNull();
    expect(parsed.records).toEqual([
      expect.objectContaining({
        id: "pubmed:1",
        year: 2020,
        publicationDate: "2020 Mar 1",
        openAccess: null,
        doi: null,
        authors: [],
        url: "https://pubmed.ncbi.nlm.nih.gov/1/",
      }),
    ]);
    expect(parsePubMedLiterature(JSON.stringify({ summary: { result: { uids: "x" } } })).records).toEqual([]);
  });

  it("finds arXiv PDF links by type, derives them from the abstract URL, and keeps the journal reference", () => {
    const parsed = parseArxivLiterature(`
      <entry><title>No id</title></entry>
      <entry><id>https://arxiv.org/abs/1</id></entry>
      <entry>
        <id>https://arxiv.org/abs/2101.00002v1</id>
        <title>Typed link</title>
        <arxiv:journal_ref>Phys. Rev. 1 (2021)</arxiv:journal_ref>
        <link href='https://arxiv.org/pdf/2101.00002v1' type='application/pdf'/>
      </entry>
      <entry>
        <id>https://arxiv.org/abs/2101.00003</id>
        <title>Derived link</title>
        <link href="https://arxiv.org/abs/2101.00003" rel="alternate"/>
      </entry>`);
    expect(parsed.records.map((entry) => [entry.id, entry.url, entry.pdfUrl, entry.venue])).toEqual([
      ["arxiv:result-0", null, null, "arXiv"],
      ["arxiv:2101.00002", "https://arxiv.org/abs/2101.00002v1", "https://arxiv.org/pdf/2101.00002v1", "Phys. Rev. 1 (2021)"],
      ["arxiv:2101.00003", "https://arxiv.org/abs/2101.00003", "https://arxiv.org/pdf/2101.00003", "arXiv"],
    ]);
  });
});

describe("merging and identity", () => {
  it("merges records without a DOI by their normalized title", () => {
    const first = record({ title: "Deep Learning!", venue: "J", openAccess: false, citationCount: null });
    const second = record({
      id: "openalex:y",
      sourceIds: { openalex: "y" },
      sources: ["openalex"],
      title: "deep learning",
      venue: "Journal of Things",
      authors: ["A B"],
      year: 2020,
      doi: "10.9/x",
      abstract: "Longer abstract",
      openAccess: null,
    });
    expect(literatureIdentity(first)).toBe("title:deeplearning");
    expect(literatureIdentity(second)).toBe("doi:10.9/x");
    const merged = mergeLiteratureRecords([[first], [{ ...second, doi: null }]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      title: "Deep Learning!",
      venue: "Journal of Things",
      authors: ["A B"],
      year: 2020,
      abstract: "Longer abstract",
      citationCount: null,
      openAccess: false,
      sources: ["crossref", "openalex"],
    });
  });

  it("keeps the first title when the second is shorter and interleaves sources by rank", () => {
    const merged = mergeLiteratureRecords([
      [record({ id: "a:1", title: "First paper" }), record({ id: "a:2", title: "Third paper" })],
      [record({ id: "b:1", title: "Second paper" })],
      [],
    ]);
    expect(merged.map((entry) => entry.id)).toEqual(["a:1", "b:1", "a:2"]);
    expect(mergeLiteratureRecords([])).toEqual([]);
  });
});

describe("BibTeX export", () => {
  it.each([
    [{ type: "proceedings-article", venue: "ICML" }, "@inproceedings{", "booktitle = {ICML}"],
    [{ type: "Conference" }, "@inproceedings{", null],
    [{ type: "book-chapter" }, "@book{", null],
    [{ type: "PhD thesis" }, "@phdthesis{", null],
    [{ type: null, venue: "Nature" }, "@article{", "journal = {Nature}"],
    [{ type: "preprint", venue: "Nature" }, "@misc{", null],
    [{ type: null, venue: "arXiv" }, "@misc{", null],
  ])("picks the entry type for %j", (overrides, prefix, field) => {
    const bibtex = bibtexForLiteratureRecord(record({ authors: ["Ada Lovelace"], year: 1843, ...overrides }));
    expect(bibtex.startsWith(prefix)).toBe(true);
    if (field) expect(bibtex).toContain(field);
  });

  it("adds the arXiv eprint, URL and omits an unknown year", () => {
    const bibtex = bibtexForLiteratureRecord(
      record({
        sources: ["arxiv"],
        sourceIds: { arxiv: "2101.00002" },
        url: "https://arxiv.org/abs/2101.00002",
        title: "Graphs",
      }),
    );
    expect(bibtex).toContain("eprint = {2101.00002}");
    expect(bibtex).toContain("archiveprefix = {arXiv}");
    expect(bibtex).toContain("url = {https://arxiv.org/abs/2101.00002}");
    expect(bibtex).not.toContain("year =");
    expect(bibtexForLiteratureRecord(record({ sources: ["arxiv"], sourceIds: {} }))).not.toContain("eprint");
  });
});

describe("searchLiterature", () => {
  const crossref = JSON.stringify({
    message: {
      items: [
        { title: ["Old"], DOI: "10.1/old", issued: { "date-parts": [[1990]] } },
        { title: ["New"], DOI: "10.1/new", issued: { "date-parts": [[2020]] } },
        { title: ["Undated"], DOI: "10.1/undated" },
      ],
    },
  });

  beforeEach(() => {
    localStorage.clear();
    getConnectorKey.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves a repeated search from the cache until it expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const transport = vi.fn(async () => crossref);
    const options = { query: " Graphs ", sources: ["crossref" as const] };
    const first = await searchLiterature(options, transport);
    expect(first.cached).toBe(false);
    const second = await searchLiterature({ ...options, query: "graphs" }, transport);
    expect(second.cached).toBe(true);
    expect(second.results).toEqual(first.results);
    expect(transport).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-01-01T07:00:00Z"));
    await searchLiterature(options, transport);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]")).toHaveLength(1);
  });

  it("ignores a corrupt or non-list cache", async () => {
    const transport = vi.fn(async () => crossref);
    localStorage.setItem(CACHE_KEY, "{oops");
    await searchLiterature({ query: "q", sources: ["crossref"] }, transport);
    localStorage.setItem(CACHE_KEY, JSON.stringify({ not: "a list" }));
    await searchLiterature({ query: "q", sources: ["crossref"] }, transport);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("still answers when the cache cannot be written", async () => {
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const response = await searchLiterature({ query: "q", sources: ["crossref"] }, vi.fn(async () => crossref));
    expect(response.results).toHaveLength(3);
    setItem.mockRestore();
  });

  it("filters by year range and open access and clamps the limit", async () => {
    const transport = vi.fn(async () => crossref);
    const ranged = await searchLiterature(
      { query: "q", sources: ["crossref"], yearFrom: 2000, yearTo: 2010, limit: 100, ignoreCache: true },
      transport,
    );
    expect(ranged.results.map((entry) => entry.title)).toEqual(["Undated"]);
    expect(transport).toHaveBeenLastCalledWith("crossref", "q", { limit: 25, yearFrom: 2000, yearTo: 2010, openAccessOnly: undefined });

    const later = await searchLiterature({ query: "q", sources: ["crossref"], yearTo: 2010, limit: 0, ignoreCache: true }, transport);
    expect(later.results.map((entry) => entry.title)).toEqual(["Old", "Undated"]);
    expect(transport).toHaveBeenLastCalledWith("crossref", "q", expect.objectContaining({ limit: 1 }));

    const open = await searchLiterature({ query: "q", sources: ["crossref"], openAccessOnly: true, ignoreCache: true }, transport);
    expect(open.results).toEqual([]);
    expect(open.runs[0]).toMatchObject({ status: "ok", count: 0 });
  });

  it("reports the paused USPTO source and non-Error failures as failed runs", async () => {
    const transport = vi.fn(async (source: string): Promise<string> => {
      if (source === "pubmed") throw "PubMed is down";
      if (source === "openalex") throw { code: 500 };
      return crossref;
    });
    const response = await searchLiterature(
      { query: "q", sources: ["uspto", "pubmed", "openalex"], ignoreCache: true },
      transport,
    );
    expect(response.runs.map((run) => [run.source, run.status, run.error])).toEqual([
      ["uspto", "error", enCore.literatureSources.usptoPaused],
      ["pubmed", "error", "PubMed is down"],
      ["openalex", "error", "[object Object]"],
    ]);
    expect(transport).not.toHaveBeenCalledWith("uspto", expect.anything(), expect.anything());
  });

  it("uses a saved Serper key to decide whether Google Scholar runs", async () => {
    const transport = vi.fn(async () => JSON.stringify({ organic: [] }));
    getConnectorKey.mockResolvedValueOnce("   ");
    const skipped = await searchLiterature({ query: "q", sources: ["google-scholar"], ignoreCache: true }, transport);
    expect(skipped.runs).toEqual([]);
    expect(getConnectorKey).toHaveBeenCalledWith("serper");

    getConnectorKey.mockResolvedValueOnce("secret");
    const searched = await searchLiterature({ query: "q", sources: ["google-scholar"], ignoreCache: true }, transport);
    expect(searched.runs.map((run) => run.source)).toEqual(["google-scholar"]);

    getConnectorKey.mockRejectedValueOnce(new Error("keychain locked"));
    const attempted = await searchLiterature({ query: "q", sources: ["google-scholar"], ignoreCache: true }, transport);
    expect(attempted.runs.map((run) => run.source)).toEqual(["google-scholar"]);
  });
});
