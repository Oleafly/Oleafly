import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bibtexForLiteratureRecord,
  mergeLiteratureRecords,
  parseArxivLiterature,
  parseCrossrefLiterature,
  parseGoogleScholarLiterature,
  parseOpenAlexLiterature,
  parsePubMedLiterature,
  parseSemanticScholarLiterature,
  searchLiterature,
} from "./literature-search";

const CROSSREF_FIXTURE = JSON.stringify({
  message: {
    "total-results": 120,
    items: [
      {
        DOI: "10.1000/example",
        title: ["A Unified View of Useful Models"],
        author: [{ given: "Jane", family: "Smith" }],
        issued: { "date-parts": [[2021, 4, 2]] },
        "container-title": ["Journal of Useful Models"],
        type: "journal-article",
        URL: "https://doi.org/10.1000/example",
        "is-referenced-by-count": 37,
        abstract: "<jats:p>A short &amp; useful abstract.</jats:p>",
      },
    ],
  },
});

const OPENALEX_FIXTURE = JSON.stringify({
  meta: { count: 99 },
  results: [
    {
      id: "https://openalex.org/W123",
      doi: "https://doi.org/10.1000/example",
      title: "A Unified View of Useful Models",
      publication_year: 2021,
      publication_date: "2021-04-02",
      type: "article",
      authorships: [
        { author: { id: "https://openalex.org/A1", display_name: "Jane Smith" } },
        { author: { id: "https://openalex.org/A2", display_name: "Ravi Rao" } },
      ],
      primary_location: {
        landing_page_url: "https://example.test/paper",
        source: { display_name: "Journal of Useful Models" },
      },
      best_oa_location: {
        landing_page_url: "https://example.test/paper",
        pdf_url: "https://example.test/paper.pdf",
      },
      cited_by_count: 42,
      open_access: { is_oa: true },
    },
  ],
});

describe("literature source parsers", () => {
  it("normalizes Crossref and strips metadata markup", () => {
    const parsed = parseCrossrefLiterature(CROSSREF_FIXTURE);
    expect(parsed.total).toBe(120);
    expect(parsed.records[0]).toMatchObject({
      title: "A Unified View of Useful Models",
      authors: ["Jane Smith"],
      year: 2021,
      doi: "10.1000/example",
      venue: "Journal of Useful Models",
      citationCount: 37,
      abstract: "A short & useful abstract.",
      sources: ["crossref"],
    });
  });

  it("normalizes OpenAlex open-access metadata", () => {
    const parsed = parseOpenAlexLiterature(OPENALEX_FIXTURE);
    expect(parsed.total).toBe(99);
    expect(parsed.records[0]).toMatchObject({
      id: "openalex:W123",
      authors: ["Jane Smith", "Ravi Rao"],
      pdfUrl: "https://example.test/paper.pdf",
      citationCount: 42,
      openAccess: true,
    });
  });

  it("normalizes Semantic Scholar external identifiers", () => {
    const parsed = parseSemanticScholarLiterature(
      JSON.stringify({
        total: 8,
        data: [
          {
            paperId: "s2-paper",
            title: "Verified Paper",
            authors: [{ name: "Ada Lovelace" }],
            year: 2022,
            venue: "ExampleConf",
            externalIds: { DOI: "10.2000/verified" },
            url: "https://semanticscholar.org/paper/s2-paper",
            openAccessPdf: { url: "https://example.test/verified.pdf" },
            citationCount: 5,
            publicationTypes: ["Conference"],
          },
        ],
      }),
    );
    expect(parsed.total).toBe(8);
    expect(parsed.records[0]).toMatchObject({
      doi: "10.2000/verified",
      authors: ["Ada Lovelace"],
      openAccess: true,
      type: "Conference",
    });
  });

  it("normalizes PubMed ESearch plus ESummary output", () => {
    const parsed = parsePubMedLiterature(
      JSON.stringify({
        total: "250",
        summary: {
          result: {
            uids: ["12345"],
            "12345": {
              uid: "12345",
              pubdate: "2024 Jan",
              source: "Nature Medicine",
              authors: [{ name: "Ng A" }],
              title: "Clinical evidence &amp; outcomes.",
              pubtype: ["Journal Article"],
              articleids: [
                { idtype: "pubmed", value: "12345" },
                { idtype: "doi", value: "10.3000/clinical" },
                { idtype: "pmc", value: "PMC12345" },
              ],
            },
          },
        },
      }),
    );
    expect(parsed.total).toBe(250);
    expect(parsed.records[0]).toMatchObject({
      id: "pubmed:12345",
      title: "Clinical evidence & outcomes.",
      year: 2024,
      doi: "10.3000/clinical",
      openAccess: true,
    });
  });

  it("normalizes arXiv Atom entries and their PDF links", () => {
    const parsed = parseArxivLiterature(`
      <feed xmlns="http://www.w3.org/2005/Atom"
            xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
            xmlns:arxiv="http://arxiv.org/schemas/atom">
        <opensearch:totalResults>42</opensearch:totalResults>
        <entry>
          <id>https://arxiv.org/abs/2401.01234v2</id>
          <published>2024-01-03T00:00:00Z</published>
          <title>An Open &amp; Reproducible Result</title>
          <summary>Full details of the result.</summary>
          <author><name>Ada Lovelace</name></author>
          <arxiv:doi>10.4000/open</arxiv:doi>
          <link title="pdf" href="https://arxiv.org/pdf/2401.01234" type="application/pdf"/>
        </entry>
      </feed>
    `);
    expect(parsed.total).toBe(42);
    expect(parsed.records[0]).toMatchObject({
      id: "arxiv:2401.01234",
      title: "An Open & Reproducible Result",
      year: 2024,
      doi: "10.4000/open",
      pdfUrl: "https://arxiv.org/pdf/2401.01234",
      openAccess: true,
    });
  });
});

describe("Google Scholar (Serper) parser", () => {
  it("normalizes organic hits and extracts arXiv ids from links", () => {
    const parsed = parseGoogleScholarLiterature(
      JSON.stringify({
        organic: [
          {
            title: "A Scholar Graph Paper",
            link: "https://arxiv.org/abs/2001.12345v2",
            snippet: "About graphs.",
            year: 2020,
            citedBy: 12,
            publication: "arXiv",
          },
        ],
      }),
    );
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0].sources).toEqual(["google-scholar"]);
    expect(parsed.records[0].sourceIds.arxiv).toBe("2001.12345");
    expect(parsed.records[0].citationCount).toBe(12);
  });
});

describe("literature result processing", () => {
  beforeEach(() => localStorage.clear());

  it("deduplicates by DOI and keeps the richest fields from every source", () => {
    const crossref = parseCrossrefLiterature(CROSSREF_FIXTURE).records;
    const openalex = parseOpenAlexLiterature(OPENALEX_FIXTURE).records;
    const merged = mergeLiteratureRecords([crossref, openalex]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources).toEqual(["crossref", "openalex"]);
    expect(merged[0].authors).toEqual(["Jane Smith", "Ravi Rao"]);
    expect(merged[0].citationCount).toBe(42);
    expect(merged[0].pdfUrl).toBe("https://example.test/paper.pdf");
    expect(merged[0].abstract).toBe("A short & useful abstract.");
  });

  it("generates deterministic, valid BibTeX from normalized metadata", () => {
    const record = parseCrossrefLiterature(CROSSREF_FIXTURE).records[0];
    const bibtex = bibtexForLiteratureRecord(record);
    expect(bibtex).toContain("@article{smith2021unified,");
    expect(bibtex).toContain("author = {Smith, Jane}");
    expect(bibtex).toContain("doi = {10.1000/example}");
    expect(bibtex).toContain("journal = {Journal of Useful Models}");
  });

  it("keeps successful sources when another source is rate-limited", async () => {
    const transport = vi.fn(
      async (source: string): Promise<string> => {
        if (source === "semantic-scholar") {
          throw new Error("Semantic Scholar is rate-limiting this search.");
        }
        return CROSSREF_FIXTURE;
      },
    );
    const response = await searchLiterature(
      {
        query: "useful models",
        sources: ["crossref", "semantic-scholar"],
        ignoreCache: true,
      },
      transport,
    );
    expect(response.results).toHaveLength(1);
    expect(response.runs).toMatchObject([
      { source: "crossref", status: "ok", count: 1 },
      {
        source: "semantic-scholar",
        status: "error",
        count: 0,
      },
    ]);
  });
});
