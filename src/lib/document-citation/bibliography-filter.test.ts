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
