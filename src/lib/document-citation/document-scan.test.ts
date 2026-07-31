import { describe, expect, it, vi } from "vitest";
import { scanDocumentForCitations } from "./document-scan";
import type { LiteratureRecord, LiteratureSearchResponse } from "@/lib/literature-search";

const source = String.raw`
\begin{document}
Graph neural networks enable molecule generation with high fidelity in practice.

Another paragraph about transformers for protein folding is also important here.
\end{document}
`;

function paper(overrides: Partial<LiteratureRecord> = {}): LiteratureRecord {
  return {
    id: "openalex:1",
    sourceIds: { openalex: "W1" },
    sources: ["openalex"],
    title: "Graph Neural Networks",
    authors: ["X"],
    year: 2017,
    publicationDate: null,
    venue: "ICLR",
    type: "article",
    doi: "10.1/gcn",
    url: null,
    pdfUrl: null,
    abstract: "GNN intro",
    citationCount: 100,
    openAccess: true,
    ...overrides,
  };
}

function searchOk(
  results: LiteratureRecord[],
  runs: LiteratureSearchResponse["runs"] = [],
): LiteratureSearchResponse {
  return {
    results,
    runs,
    searchedAt: Date.now(),
    cached: false,
  };
}

describe("scanDocumentForCitations", () => {
  it("emits progressive paragraph results and filters by threshold", async () => {
    const onParagraph = vi.fn();
    const result = await scanDocumentForCitations({
      sourceText: source,
      bibText: "",
      settings: {
        scoreThreshold: 50,
        maxResultsPerSource: 5,
        maxResultsPerParagraph: 3,
        maxParagraphs: 20,
      },
      search: async () => searchOk([paper()]),
      completeChat: async () => `
1.
FOR: Core method paper.
AGAINST: Older work.
SCORE: 88
`,
      onParagraph,
    });
    expect(result.paragraphs.length).toBeGreaterThan(0);
    expect(onParagraph).toHaveBeenCalled();
    expect(result.paragraphs[0].suggestions[0].score).toBe(88);
  });

  it("skips paragraphs whose keyword query is empty", async () => {
    const result = await scanDocumentForCitations({
      sourceText: "\\begin{document}\n\\section{Only Heading}\n\\end{document}",
      bibText: "",
      search: async () => {
        throw new Error("should not search");
      },
      completeChat: async () => "",
    });
    expect(result.paragraphs).toEqual([]);
  });

  it("uses heuristic ranking when rankMode is heuristic", async () => {
    const completeChat = vi.fn(async () => {
      throw new Error("LLM should not be called");
    });
    const result = await scanDocumentForCitations({
      sourceText: source,
      bibText: "",
      rankMode: "heuristic",
      settings: {
        scoreThreshold: 0,
        maxResultsPerSource: 5,
        maxResultsPerParagraph: 3,
        maxParagraphs: 20,
      },
      search: async () => searchOk([paper({ citationCount: 50 })]),
      completeChat,
    });
    expect(completeChat).not.toHaveBeenCalled();
    expect(result.paragraphs.length).toBeGreaterThan(0);
    expect(result.paragraphs[0].suggestions.length).toBeGreaterThan(0);
    expect(result.paragraphs[0].suggestions[0].reasoning).toBeNull();
    expect(result.paragraphs[0].suggestions[0].score).toBeGreaterThan(0);
  });

  it("filters out low scores and surfaces source errors", async () => {
    const result = await scanDocumentForCitations({
      sourceText: source,
      bibText: "",
      settings: {
        scoreThreshold: 90,
        maxResultsPerSource: 5,
        maxResultsPerParagraph: 3,
        maxParagraphs: 20,
      },
      search: async () =>
        searchOk([paper()], [
          {
            source: "arxiv",
            status: "error",
            count: 0,
            total: null,
            durationMs: 1,
            error: "timeout",
          },
        ]),
      completeChat: async () => `
1.
FOR: Related.
AGAINST: Not primary.
SCORE: 40
`,
    });
    expect(result.paragraphs[0].suggestions).toEqual([]);
    expect(result.paragraphs[0].sourceErrors.some((e) => /timeout/i.test(e))).toBe(
      true,
    );
  });

  it("stops when signal is aborted between paragraphs", async () => {
    const controller = new AbortController();
    let searches = 0;
    await expect(
      scanDocumentForCitations({
        sourceText: source,
        bibText: "",
        signal: controller.signal,
        settings: {
          scoreThreshold: 0,
          maxResultsPerSource: 5,
          maxResultsPerParagraph: 3,
          maxParagraphs: 20,
        },
        search: async () => {
          searches += 1;
          controller.abort();
          return searchOk([paper()]);
        },
        completeChat: async () => `
1.
FOR: Ok.
AGAINST: None.
SCORE: 70
`,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(searches).toBe(1);
  });
});
