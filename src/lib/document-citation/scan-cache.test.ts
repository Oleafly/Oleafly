import { afterEach, describe, expect, it } from "vitest";
import {
  clearDocumentScanCache,
  documentScanCacheKey,
  loadDocumentScanCache,
  saveDocumentScanCache,
} from "./scan-cache";
import { DEFAULT_DOCUMENT_CITATION_SETTINGS } from "./settings";

afterEach(() => {
  clearDocumentScanCache();
  localStorage.clear();
});

describe("document scan cache", () => {
  it("round-trips a scan result", () => {
    const key = documentScanCacheKey({
      sourceText: "Graph neural networks are useful for molecules.",
      bibText: "",
      settings: DEFAULT_DOCUMENT_CITATION_SETTINGS,
      rankMode: "heuristic",
    });
    const result = {
      totalParagraphs: 1,
      paragraphs: [
        {
          paragraphIndex: 0,
          paragraphPreview: "Graph neural…",
          query: "graph neural networks",
          suggestions: [],
          sourceErrors: [],
        },
      ],
    };
    saveDocumentScanCache(key, result);
    expect(loadDocumentScanCache(key)).toEqual(result);
  });

  it("misses when source text changes", () => {
    const settings = DEFAULT_DOCUMENT_CITATION_SETTINGS;
    const a = documentScanCacheKey({
      sourceText: "A",
      bibText: "",
      settings,
      rankMode: "heuristic",
    });
    const b = documentScanCacheKey({
      sourceText: "B",
      bibText: "",
      settings,
      rankMode: "heuristic",
    });
    saveDocumentScanCache(a, { totalParagraphs: 0, paragraphs: [] });
    expect(loadDocumentScanCache(b)).toBeNull();
  });
});
