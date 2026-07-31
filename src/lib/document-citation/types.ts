import type { LiteratureRecord } from "@/lib/literature-search";

/** A prose chunk extracted from a LaTeX source for document-driven citation scan. */
export interface DocumentParagraph {
  index: number;
  text: string;
}

/** A literature candidate scored for relevance to a paragraph. */
export interface RankedLiteraturePaper {
  record: LiteratureRecord;
  /** Relevance score clamped to 0–100. */
  score: number;
  /** LLM FOR/AGAINST reasoning, or null when heuristic fallback was used. */
  reasoning: { for: string; against: string } | null;
}

/** Injectable chat completion used by the debate ranker (no real network in unit tests). */
export type CompleteChatFn = (args: {
  system: string;
  user: string;
  temperature: number;
  signal?: AbortSignal;
}) => Promise<string>;

