import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiteratureRecord } from "@/lib/literature-search";
import {
  clearArxivLookupCache,
  enrichAuthorlessRecords,
} from "./enrich";

function record(
  overrides: Partial<LiteratureRecord> & { id: string },
): LiteratureRecord {
  return {
    sourceIds: {},
    sources: ["google-scholar"],
    title: "Some Paper",
    authors: [],
    year: null,
    publicationDate: null,
    venue: null,
    type: "article",
    doi: null,
    url: null,
    pdfUrl: null,
    abstract: null,
    citationCount: null,
    openAccess: null,
    ...overrides,
  } as LiteratureRecord;
}

beforeEach(() => {
  clearArxivLookupCache();
});

describe("enrichAuthorlessRecords", () => {
  it("backfills authors, year, venue and doi from the lookup", async () => {
    const lookup = vi.fn().mockResolvedValue({
      authors: ["Ada Lovelace", "Alan Turing"],
      year: 2021,
      venue: "NeurIPS",
      doi: "10.1000/x",
    });
    const input = [
      record({ id: "a", sourceIds: { arxiv: "2101.00001" } }),
    ];
    const result = await enrichAuthorlessRecords(input, lookup);
    expect(result[0].authors).toEqual(["Ada Lovelace", "Alan Turing"]);
    expect(result[0].year).toBe(2021);
    expect(result[0].venue).toBe("NeurIPS");
    expect(result[0].doi).toBe("10.1000/x");
    expect(lookup).toHaveBeenCalledWith("2101.00001");
  });

  it("never overwrites fields the record already has", async () => {
    const lookup = vi.fn().mockResolvedValue({
      authors: ["Backfilled"],
      year: 1999,
      venue: "Wrong Venue",
      doi: "10.1000/other",
    });
    const input = [
      record({
        id: "a",
        sourceIds: { arxiv: "2101.00002" },
        year: 2024,
        venue: "ICML",
        doi: "10.1000/mine",
      }),
    ];
    const result = await enrichAuthorlessRecords(input, lookup);
    expect(result[0].authors).toEqual(["Backfilled"]);
    expect(result[0].year).toBe(2024);
    expect(result[0].venue).toBe("ICML");
    expect(result[0].doi).toBe("10.1000/mine");
  });

  it("skips records with authors or without an arXiv id", async () => {
    const lookup = vi.fn();
    const input = [
      record({ id: "authored", authors: ["Someone"] }),
      record({ id: "no-arxiv" }),
    ];
    const result = await enrichAuthorlessRecords(input, lookup);
    expect(result).toEqual(input);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("caches lookups across calls and tolerates failures", async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const input = [
      record({ id: "a", sourceIds: { arxiv: "2101.00003" } }),
    ];
    const first = await enrichAuthorlessRecords(input, lookup);
    const second = await enrichAuthorlessRecords(input, lookup);
    expect(first[0].authors).toEqual([]);
    expect(second[0].authors).toEqual([]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
