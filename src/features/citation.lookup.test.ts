import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  offline: false,
  fetchDoiBibtex: vi.fn(),
  fetchArxiv: vi.fn(),
  fetchIsbnBibtex: vi.fn(),
  fetchPmidBibtex: vi.fn(),
  crossrefSearch: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  fetchDoiBibtex: mocks.fetchDoiBibtex,
  fetchArxiv: mocks.fetchArxiv,
  fetchIsbnBibtex: mocks.fetchIsbnBibtex,
  fetchPmidBibtex: mocks.fetchPmidBibtex,
  crossrefSearch: mocks.crossrefSearch,
  readFileContent: vi.fn(),
}));
vi.mock("@/store/settings", () => ({
  useSettingsStore: { getState: () => ({ offline: mocks.offline }) },
}));
vi.mock("@/components/editor/cm/controller", () => ({
  getEditorView: vi.fn(),
  insertAtCursor: vi.fn(),
}));

import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { bibtexForHit, parseCitationFile, resolveCitation } from "./citation";

const ARXIV_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All You Need</title>
    <author><name>Ashish Vaswani</name></author>
  </entry>
</feed>`;

beforeEach(() => {
  mocks.offline = false;
  for (const mock of [mocks.fetchDoiBibtex, mocks.fetchArxiv, mocks.fetchIsbnBibtex, mocks.fetchPmidBibtex, mocks.crossrefSearch]) {
    mock.mockReset();
  }
});

describe("resolving a citation", () => {
  it("refuses to look anything up while offline", async () => {
    mocks.offline = true;

    await expect(resolveCitation("10.1000/xyz")).resolves.toEqual({ error: enCore.citation.offline });
    expect(mocks.fetchDoiBibtex).not.toHaveBeenCalled();
  });

  it("fetches BibTeX for a DOI, an ISBN and a PubMed id", async () => {
    mocks.fetchDoiBibtex.mockResolvedValue("  @article{doi}\n");
    mocks.fetchIsbnBibtex.mockResolvedValue("@book{isbn}\n");
    mocks.fetchPmidBibtex.mockResolvedValue("@article{pmid} ");

    await expect(resolveCitation("https://doi.org/10.1000/xyz.")).resolves.toEqual({ bibtex: "@article{doi}" });
    await expect(resolveCitation("978-0-13-468599-1")).resolves.toEqual({ bibtex: "@book{isbn}" });
    await expect(resolveCitation("PMID: 31452104")).resolves.toEqual({ bibtex: "@article{pmid}" });

    expect(mocks.fetchDoiBibtex).toHaveBeenCalledWith("10.1000/xyz");
    expect(mocks.fetchIsbnBibtex).toHaveBeenCalledWith("9780134685991");
    expect(mocks.fetchPmidBibtex).toHaveBeenCalledWith("31452104");
  });

  it("converts an arXiv entry and reports an id arXiv does not know", async () => {
    mocks.fetchArxiv.mockResolvedValueOnce(ARXIV_FEED);
    const found = await resolveCitation("arXiv:1706.03762");
    expect(found.bibtex).toContain("Attention Is All You Need");
    expect(mocks.fetchArxiv).toHaveBeenCalledWith("1706.03762");

    mocks.fetchArxiv.mockResolvedValueOnce('<feed xmlns="http://www.w3.org/2005/Atom"></feed>');
    await expect(resolveCitation("1706.99999")).resolves.toEqual({ error: enCore.citation.noArxivEntry });
  });

  it("searches Crossref for a free-text title", async () => {
    mocks.crossrefSearch.mockResolvedValue(
      JSON.stringify({
        message: {
          items: [
            {
              DOI: "10.1/abc",
              title: ["Deep Learning"],
              author: [{ family: "LeCun", given: "Yann" }],
              issued: { "date-parts": [[2015]] },
              "container-title": ["Nature"],
              type: "journal-article",
            },
          ],
        },
      }),
    );

    const result = await resolveCitation("deep learning review");

    expect(mocks.crossrefSearch).toHaveBeenCalledWith("deep learning review");
    expect(result.hits).toEqual([
      { doi: "10.1/abc", title: "Deep Learning", authors: ["LeCun, Yann"], year: "2015", venue: "Nature", type: "journal-article" },
    ]);
  });

  it("reports a failed lookup as an error", async () => {
    mocks.fetchDoiBibtex.mockRejectedValue("HTTP 404");

    await expect(resolveCitation("10.1000/missing")).resolves.toEqual({ error: "HTTP 404" });
  });
});

describe("BibTeX for a search hit", () => {
  const hit = {
    doi: "10.1/abc",
    title: "Deep Learning",
    authors: ["LeCun, Yann", "Bengio, Yoshua"],
    year: "2015",
    venue: "Nature",
    type: "journal-article",
  };

  it("uses the publisher's BibTeX when the DOI resolves", async () => {
    mocks.fetchDoiBibtex.mockResolvedValue("@article{lecun2015,}\n");

    await expect(bibtexForHit(hit)).resolves.toBe("@article{lecun2015,}");
  });

  it("builds an entry from the hit when the DOI lookup fails", async () => {
    mocks.fetchDoiBibtex.mockRejectedValue(new Error("timeout"));

    await expect(bibtexForHit(hit)).resolves.toBe(
      [
        "@article{ref,",
        "  title = {Deep Learning},",
        "  author = {LeCun, Yann and Bengio, Yoshua},",
        "  year = {2015},",
        "  journal = {Nature},",
        "  doi = {10.1/abc}",
        "}",
      ].join("\n"),
    );
  });

  it("leaves out fields the hit does not have", async () => {
    await expect(
      bibtexForHit({ doi: null, title: "Untitled note", authors: [], year: null, venue: null, type: null }),
    ).resolves.toBe("@article{ref,\n  title = {Untitled note}\n}");
    expect(mocks.fetchDoiBibtex).not.toHaveBeenCalled();
  });
});

describe("reading reference manager exports", () => {
  it("picks the parser from the file extension", () => {
    expect(parseCitationFile("refs.BIB", "@article{a, title={A}}")?.map((entry) => entry.key)).toEqual(["a"]);
    expect(parseCitationFile("library.ris", "TY  - JOUR\nTI  - Title\nER  - \n")).toHaveLength(1);
    expect(parseCitationFile("export.xml", "<xml><records></records></xml>")).toEqual([]);
    expect(parseCitationFile("zotero.rdf", '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF>')).toEqual([]);
  });

  it("does not recognize other files", () => {
    expect(parseCitationFile("notes.txt", "text")).toBeNull();
    expect(parseCitationFile("README", "text")).toBeNull();
  });
});
