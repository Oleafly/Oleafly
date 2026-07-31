import { describe, expect, it } from "vitest";
import {
  heuristicScore,
  parseDebateResponse,
  rankLiteraturePapers,
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

describe("parseDebateResponse", () => {
  it("parses FOR/AGAINST/SCORE blocks", () => {
    const text = `
NEEDS: citations for GNN backbone.

1.
FOR: Introduces the graph convolutional network used as backbone.
AGAINST: Focuses on node classification.
SCORE: 78

2.
FOR: Related survey only.
AGAINST: Not a primary method paper.
SCORE: 41
`;
    const map = parseDebateResponse(text);
    expect(map.get(0)?.score).toBe(78);
    expect(map.get(0)?.for).toMatch(/graph convolutional/i);
    expect(map.get(1)?.score).toBe(41);
  });
});

describe("rankLiteraturePapers", () => {
  it("uses LLM scores when parse succeeds", async () => {
    const ranked = await rankLiteraturePapers({
      paragraphText: "We use graph neural networks.",
      papers: [paper("GCN", 1000), paper("Other", 2)],
      completeChat: async () => `
1.
FOR: Direct method citation.
AGAINST: None major.
SCORE: 90

2.
FOR: Weak link.
AGAINST: Different domain.
SCORE: 20
`,
    });
    expect(ranked[0].score).toBe(90);
    expect(ranked[0].reasoning?.for).toMatch(/Direct/i);
    expect(ranked[1].score).toBe(20);
  });

  it("falls back to heuristic when LLM throws", async () => {
    const ranked = await rankLiteraturePapers({
      paragraphText: "x",
      papers: [paper("A", 100), paper("B", 0)],
      completeChat: async () => {
        throw new Error("LLM down");
      },
    });
    expect(ranked).toHaveLength(2);
    expect(ranked.every((r) => r.reasoning === null)).toBe(true);
    expect(ranked[0].score).toBeGreaterThan(0);
  });

  it("rethrows AbortError instead of falling back to heuristic", async () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    await expect(
      rankLiteraturePapers({
        paragraphText: "x",
        papers: [paper("A", 100), paper("B", 0)],
        completeChat: async () => {
          throw abortErr;
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("remaps batch-local indices across multiple batches", async () => {
    const papers = Array.from({ length: 11 }, (_, i) =>
      paper(`P${i}`, 10 + i),
    );
    let calls = 0;
    const ranked = await rankLiteraturePapers({
      paragraphText: "multi batch",
      papers,
      batchSize: 10,
      completeChat: async ({ user }) => {
        calls += 1;
        // Second batch has only paper 11 (local 1. → global index 10)
        if (calls === 1) {
          return `
1.
FOR: First batch paper zero.
AGAINST: None.
SCORE: 91

10.
FOR: First batch paper nine.
AGAINST: Weak.
SCORE: 55
`;
        }
        expect(user).toMatch(/1\. Title: P10/);
        return `
1.
FOR: Second batch only paper.
AGAINST: Sparse.
SCORE: 72
`;
      },
    });
    expect(calls).toBe(2);
    expect(ranked).toHaveLength(11);
    expect(ranked[0].score).toBe(91);
    expect(ranked[0].reasoning?.for).toMatch(/First batch paper zero/i);
    expect(ranked[9].score).toBe(55);
    expect(ranked[10].score).toBe(72);
    expect(ranked[10].reasoning?.for).toMatch(/Second batch only paper/i);
    // Unparsed papers in batch 1 fall back to heuristic with null reasoning
    expect(ranked[1].reasoning).toBeNull();
  });
});

describe("heuristicScore", () => {
  it("blends rank position and citations", () => {
    const s0 = heuristicScore(paper("A", 1000), 0, 2, 1000);
    const s1 = heuristicScore(paper("B", 0), 1, 2, 1000);
    expect(s0).toBeGreaterThan(s1);
  });
});
