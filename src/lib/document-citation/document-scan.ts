import {
  DEFAULT_LITERATURE_SOURCES,
  searchLiterature,
  type LiteratureRecord,
  type LiteratureSource,
} from "@/lib/literature-search";
import {
  filterNewLiteratureRecords,
  parseBibliographyIdentities,
} from "./bibliography-filter";
import { heuristicScore, rankLiteraturePapers } from "./debate-ranker";
import { enrichAuthorlessRecords, type ArxivLookupFn } from "./enrich";
import { extractKeywords, splitIntoParagraphs } from "./latex-paragraphs";
import { completeChatWithActiveModel } from "./llm-complete";
import {
  DEFAULT_DOCUMENT_CITATION_SETTINGS,
  type DocumentCitationSettings,
} from "./settings";
import type { CompleteChatFn, RankedLiteraturePaper } from "./types";

export interface DocumentScanProgress {
  phase: "splitting" | "paragraph" | "complete" | "error";
  completedParagraphs: number;
  totalParagraphs: number;
  message?: string;
}

export interface ParagraphCitationResult {
  paragraphIndex: number;
  paragraphPreview: string;
  query: string;
  suggestions: RankedLiteraturePaper[];
  sourceErrors: string[];
}

export interface DocumentScanResult {
  paragraphs: ParagraphCitationResult[];
  totalParagraphs: number;
}

export type DocumentScanRankMode = "llm" | "heuristic";

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  throw err;
}

function paragraphPreview(text: string): string {
  const head = text.slice(0, 100);
  return text.length > 100 ? `${head}…` : head;
}

function sourceErrorMessages(
  runs: Array<{ source: string; status: string; error?: string }>,
): string[] {
  const errors: string[] = [];
  for (const run of runs) {
    if (run.status === "error" && run.error) {
      errors.push(`${run.source}: ${run.error}`);
    }
  }
  return errors;
}

function rankHeuristic(papers: LiteratureRecord[]): RankedLiteraturePaper[] {
  if (!papers.length) return [];
  const maxCit = Math.max(1, ...papers.map((p) => p.citationCount ?? 0));
  const n = papers.length;
  return papers.map((record, i) => ({
    record,
    score: heuristicScore(record, i, n, maxCit),
    reasoning: null,
  }));
}

/**
 * Split a LaTeX document into paragraphs, search multi-source literature for
 * each, filter against the bibliography, rank candidates, and stream results.
 */
export async function scanDocumentForCitations(args: {
  sourceText: string;
  bibText: string;
  sources?: LiteratureSource[];
  settings?: DocumentCitationSettings;
  search?: typeof searchLiterature;
  completeChat?: CompleteChatFn;
  arxivLookup?: ArxivLookupFn;
  /** When `"heuristic"`, skip LLM and score with citation/rank heuristics. */
  rankMode?: DocumentScanRankMode;
  signal?: AbortSignal;
  onProgress?: (p: DocumentScanProgress) => void;
  onParagraph?: (result: ParagraphCitationResult) => void;
}): Promise<DocumentScanResult> {
  const settings = {
    ...DEFAULT_DOCUMENT_CITATION_SETTINGS,
    ...args.settings,
  };
  const sources = args.sources ?? DEFAULT_LITERATURE_SOURCES;
  const search = args.search ?? searchLiterature;
  const completeChat = args.completeChat ?? completeChatWithActiveModel;
  const rankMode: DocumentScanRankMode = args.rankMode ?? "llm";
  const { signal, onProgress, onParagraph } = args;

  onProgress?.({
    phase: "splitting",
    completedParagraphs: 0,
    totalParagraphs: 0,
    message: "Splitting document into paragraphs…",
  });

  const paragraphs = splitIntoParagraphs(args.sourceText, {
    maxParagraphs: settings.maxParagraphs,
  });
  const totalParagraphs = paragraphs.length;
  const bibIds = parseBibliographyIdentities(args.bibText);
  // Full-doc keyword context (built once) for the debate ranker.
  const fullDocContext = extractKeywords(args.sourceText.slice(0, 4000), 60);

  const results: ParagraphCitationResult[] = [];

  try {
    for (let i = 0; i < paragraphs.length; i++) {
      throwIfAborted(signal);

      const paragraph = paragraphs[i];
      const query = extractKeywords(paragraph.text);
      if (!query) {
        onProgress?.({
          phase: "paragraph",
          completedParagraphs: i + 1,
          totalParagraphs,
          message: `Skipped empty query (${i + 1}/${totalParagraphs})`,
        });
        continue;
      }

      onProgress?.({
        phase: "paragraph",
        completedParagraphs: i,
        totalParagraphs,
        message: `Processing ${i + 1}/${totalParagraphs} paragraphs…`,
      });

      const response = await search({
        query,
        sources,
        limit: settings.maxResultsPerSource,
      });

      throwIfAborted(signal);

      const filtered = filterNewLiteratureRecords(response.results, bibIds);
      // Backfill authors for title-only sources (Google Scholar via Serper).
      const papers = await enrichAuthorlessRecords(
        filtered,
        args.arxivLookup ?? undefined,
      );
      throwIfAborted(signal);
      const sourceErrors = sourceErrorMessages(response.runs);

      const ranked =
        rankMode === "heuristic"
          ? rankHeuristic(papers)
          : await rankLiteraturePapers({
              paragraphText: paragraph.text,
              papers,
              fullDocContext: fullDocContext || undefined,
              completeChat,
              signal,
            });

      const suggestions = ranked
        .filter((r) => r.score >= settings.scoreThreshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, settings.maxResultsPerParagraph);

      const paragraphResult: ParagraphCitationResult = {
        paragraphIndex: paragraph.index,
        paragraphPreview: paragraphPreview(paragraph.text),
        query,
        suggestions,
        sourceErrors,
      };

      onParagraph?.(paragraphResult);
      results.push(paragraphResult);

      onProgress?.({
        phase: "paragraph",
        completedParagraphs: i + 1,
        totalParagraphs,
        message: `Processed ${i + 1}/${totalParagraphs} paragraphs…`,
      });
    }

    onProgress?.({
      phase: "complete",
      completedParagraphs: totalParagraphs,
      totalParagraphs,
      message: "Scan complete",
    });

    return { paragraphs: results, totalParagraphs };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Document scan failed";
    onProgress?.({
      phase: "error",
      completedParagraphs: results.length,
      totalParagraphs,
      message,
    });
    throw err;
  }
}
