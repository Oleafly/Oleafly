import { describe, expect, it, vi } from "vitest";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
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

  it("splits and cleans a Typst document when the format is typst", async () => {
    const queries: string[] = [];
    const result = await scanDocumentForCitations({
      sourceText: [
        "#set page(paper: \"a4\")",
        "#show: doc => conf(title: [A title that is long enough to look like prose], doc)",
        "= Introduction",
        "",
        "Graph neural networks enable molecule generation with high fidelity @kipf2017.",
        "",
        "// Transformers for protein folding are discussed in a long comment here.",
      ].join("\n"),
      bibText: "",
      format: "typst",
      rankMode: "heuristic",
      settings: {
        scoreThreshold: 0,
        maxResultsPerSource: 5,
        maxResultsPerParagraph: 3,
        maxParagraphs: 20,
      },
      search: async ({ query }) => {
        queries.push(query);
        return searchOk([paper()]);
      },
      completeChat: async () => "",
    });
    expect(queries).toEqual(["Graph neural networks enable molecule generation with high fidelity."]);
    expect(result.totalParagraphs).toBe(1);
    expect(result.paragraphs[0].paragraphPreview).toMatch(/^Graph neural networks/);
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

describe("scanDocumentForCitations progress and failures", () => {
  const settings = {
    scoreThreshold: 0,
    maxResultsPerSource: 5,
    maxResultsPerParagraph: 2,
    maxParagraphs: 20,
  };
  const copy = enCore.documentScan;

  it("reports every step and skips a paragraph with no searchable words", async () => {
    const progress: string[] = [];
    const long = `Graph neural networks ${"enable molecule generation ".repeat(5)}with high fidelity.`;
    const sourceText = [
      "\\begin{document}",
      "$$\\int_0^1 f(x)\\,dx = \\sum_{k=0}^{\\infty} a_k b_k c_k d_k$$",
      "",
      long,
      "\\end{document}",
    ].join("\n");
    const result = await scanDocumentForCitations({
      sourceText,
      bibText: "",
      rankMode: "heuristic",
      settings,
      search: async () => searchOk([paper({ citationCount: null }), paper({ id: "openalex:2", doi: "10.1/b", title: "B", citationCount: 3 }), paper({ id: "openalex:3", doi: "10.1/c", title: "C", citationCount: 9 })]),
      onProgress: (step) => progress.push(`${step.phase}:${step.completedParagraphs}/${step.totalParagraphs}:${step.message}`),
    });
    expect(progress).toEqual([
      `splitting:0/0:${copy.splitting}`,
      "paragraph:1/2:Skipped empty query (1/2)",
      "paragraph:1/2:Processing 2/2 paragraphs\u2026",
      "paragraph:2/2:Processed 2/2 paragraphs\u2026",
      `complete:2/2:${copy.complete}`,
    ]);
    expect(result.paragraphs).toHaveLength(1);
    expect(result.paragraphs[0].paragraphPreview).toBe(`${long.slice(0, 100)}\u2026`);
    const scores = result.paragraphs[0].suggestions.map((suggestion) => suggestion.score);
    expect(scores).toHaveLength(2);
    expect(scores[0]).toBeGreaterThanOrEqual(scores[1]);
  });

  it.each(["heuristic", "llm"] as const)("ranks an empty result list without asking the model (%s)", async (rankMode) => {
    const completeChat = vi.fn(async () => "");
    const result = await scanDocumentForCitations({
      sourceText: source,
      bibText: "",
      rankMode,
      settings,
      search: async () => searchOk([], [{ source: "arxiv", status: "error", count: 0, total: null, durationMs: 1 }]),
      completeChat,
    });
    expect(result.paragraphs.map((paragraph) => paragraph.suggestions)).toEqual([[], []]);
    expect(result.paragraphs[0].sourceErrors).toEqual([]);
    expect(completeChat).not.toHaveBeenCalled();
  });

  it("reports a failed search and rethrows it", async () => {
    const progress: Array<{ phase: string; message?: string }> = [];
    await expect(
      scanDocumentForCitations({
        sourceText: source,
        bibText: "",
        settings,
        search: async () => {
          throw new Error("search offline");
        },
        onProgress: (step) => progress.push(step),
      }),
    ).rejects.toThrow("search offline");
    expect(progress.at(-1)).toMatchObject({ phase: "error", message: "search offline" });
  });

  it("uses the catalog message for a failure that is not an error object", async () => {
    const progress: Array<{ phase: string; message?: string }> = [];
    await expect(
      scanDocumentForCitations({
        sourceText: source,
        bibText: "",
        settings,
        search: async () => {
          throw "offline";
        },
        onProgress: (step) => progress.push(step),
      }),
    ).rejects.toBe("offline");
    expect(progress.at(-1)).toMatchObject({ phase: "error", message: copy.failed });
  });
});
