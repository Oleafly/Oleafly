import { describe, expect, it } from "vitest";
import {
  heuristicScore,
} from "./debate-ranker";
import type { LiteratureRecord } from "@/lib/literature-search";

const paper = (title: string, cites: number): LiteratureRecord => ({
  id: title,
  sourceIds: {},
  sources: ["openalex"],
  title,
  authors: ["A"],
  year: 2021,
  publicationDate: null,
  venue: null,
  type: "article",
  doi: null,
  url: null,
  pdfUrl: null,
  abstract: "Abstract about graphs.",
  citationCount: cites,
  openAccess: null,
});

describe("heuristicScore", () => {
  it("blends rank position and citations", () => {
    const s0 = heuristicScore(paper("A", 1000), 0, 2, 1000);
    const s1 = heuristicScore(paper("B", 0), 1, 2, 1000);
    expect(s0).toBeGreaterThan(s1);
  });
});

describe("debate ranking edge inputs", () => {
  it("scores position alone when nothing has citations", () => {
    const bare = { ...paper("Bare", 0), citationCount: null };
    expect(heuristicScore(bare, 0, 0, 0)).toBe(70);
    expect(heuristicScore(bare, 1, 2, 0)).toBe(35);
  });
});
