import { describe, expect, it } from "vitest";
import {
  filterNewLiteratureRecords,
  isRecordInBibliography,
  parseBibliographyIdentities,
} from "./bibliography-filter";
import type { LiteratureRecord } from "@/lib/literature-search";

const sampleBib = `
@article{smith2020,
  title = {Graph Networks for Molecules},
  doi = {10.1000/xyz},
  eprint = {2001.12345},
  archivePrefix = {arXiv},
}
`;

function rec(partial: Partial<LiteratureRecord>): LiteratureRecord {
  return {
    id: "test:1",
    sourceIds: {},
    sources: ["crossref"],
    title: "Graph Networks for Molecules",
    authors: [],
    year: 2020,
    publicationDate: null,
    venue: null,
    type: "article",
    doi: "10.1000/xyz",
    url: null,
    pdfUrl: null,
    abstract: null,
    citationCount: null,
    openAccess: null,
    ...partial,
  };
}

describe("bibliography filter", () => {
  it("detects doi and arxiv from bib text", () => {
    const ids = parseBibliographyIdentities(sampleBib);
    expect(ids.dois.has("10.1000/xyz")).toBe(true);
    expect(ids.arxivIds.has("2001.12345")).toBe(true);
    expect(isRecordInBibliography(rec({}), ids)).toBe(true);
  });

  it("keeps unknown papers", () => {
    const ids = parseBibliographyIdentities(sampleBib);
    const kept = filterNewLiteratureRecords(
      [rec({ doi: "10.9999/other", title: "Completely Different Title Here" })],
      ids,
    );
    expect(kept).toHaveLength(1);
  });

  it("matches arxiv via pdfUrl when url is a non-arxiv DOI link", () => {
    const ids = parseBibliographyIdentities(sampleBib);
    expect(
      isRecordInBibliography(
        rec({
          doi: "10.9999/other",
          title: "Completely Different Title Here",
          url: "https://doi.org/10.9999/other",
          pdfUrl: "https://arxiv.org/pdf/2001.12345.pdf",
        }),
        ids,
      ),
    ).toBe(true);
  });

  it("matches arxiv from a pure pdf link", () => {
    const ids = parseBibliographyIdentities(sampleBib);
    expect(
      isRecordInBibliography(
        rec({
          doi: null,
          title: "Completely Different Title Here",
          url: null,
          pdfUrl: "https://arxiv.org/pdf/2001.12345v2.pdf",
        }),
        ids,
      ),
    ).toBe(true);
  });
});

describe("bibliography identities from varied fields", () => {
  const bib = `
@article{a,
  doi = {https://doi.org/10.1000/ABC},
  title = {Graph {Neural} Networks},
  url = {https://arxiv.org/abs/2001.00001v2},
  note = "preprint at arxiv.org/pdf/2002.00002v1.pdf",
}
@misc{b, doi = {not-a-doi}, title = {!!!}, eprint = {}, url = {https://example.com/paper}}
`;

  it("collects normalised DOIs, arXiv ids and titles and skips unusable values", () => {
    const ids = parseBibliographyIdentities(bib);
    expect([...ids.dois]).toEqual(["10.1000/abc"]);
    expect(ids.arxivIds.has("2001.00001")).toBe(true);
    expect(ids.arxivIds.has("2002.00002")).toBe(true);
    expect([...ids.titles]).toEqual(["graphneuralnetworks"]);
  });

  it("matches a record by its arXiv source id or its title", () => {
    const ids = parseBibliographyIdentities(bib);
    expect(isRecordInBibliography(rec({ doi: null, title: "Other", sourceIds: { arxiv: "2001.00001v3" } }), ids)).toBe(true);
    expect(isRecordInBibliography(rec({ doi: "doi:", title: "Graph Neural Networks!" }), ids)).toBe(true);
    expect(isRecordInBibliography(rec({ doi: "doi:", title: "Unrelated" }), ids)).toBe(false);
  });

  it("stops an arXiv id at the braces and commas of a LaTeX link around it", () => {
    const ids = parseBibliographyIdentities(String.raw`@misc{c,
  note = {\url{https://arxiv.org/abs/2003.00003}},
  howpublished = {\href{https://arxiv.org/abs/hep-th/9901001v2}{arXiv}},
}`);
    expect([...ids.arxivIds].sort()).toEqual(["2003.00003", "hep-th/9901001"]);
    expect(isRecordInBibliography(rec({ doi: null, title: "Other", sourceIds: { arxiv: "2003.00003" } }), ids)).toBe(true);
    expect(
      isRecordInBibliography(rec({ doi: null, title: "Other", url: String.raw`\url{https://arxiv.org/abs/hep-th/9901001}` }), ids),
    ).toBe(true);
  });
});
