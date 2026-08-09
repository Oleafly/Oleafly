import type { LiteratureRecord } from "@/lib/literature-search";
import type { CompleteChatFn, RankedLiteraturePaper } from "./types";

export type { CompleteChatFn, RankedLiteraturePaper };

const DEFAULT_BATCH_SIZE = 10;
const ABSTRACT_MAX = 300;
const FULL_DOC_CONTEXT_MAX = 4000;
const LLM_TEMPERATURE = 0.2;

/**
 * System prompt for citation-candidate debate scoring.
 * Structure matches OpenLeaf (NEEDS + numbered FOR/AGAINST/SCORE); voice is Oleafly.
 */
const SYSTEM_PROMPT = `You are Oleafly's research assistant. Score academic papers as citation candidates for one paragraph in a manuscript.

Score guide:
- 80-100: Paper directly introduces or presents the cited method, result, dataset, or concept
- 60-79: Paper is clearly relevant and expected in this context
- 40-59: Paper is related but not the most appropriate citation here
- 0-39: Paper is tangential or from a different domain

First, write one sentence identifying what specific claims or methods in the paragraph need citations (the NEEDS line). Then evaluate each paper using its actual number.

Output exactly this structure with no preamble or extra text. Use the actual paper numbers (1, 2, 3, ...):

NEEDS: The paragraph introduces graph neural networks for molecule generation and needs citations for the GNN architecture and the generation task itself.

1.
FOR: Introduces the graph convolutional network used as the backbone in this work.
AGAINST: Focuses on node classification, not molecular generation specifically.
SCORE: 78

2.
FOR: Pioneering work on molecule generation that this paper directly builds upon.
AGAINST: Uses a VAE approach rather than the GNN method described here.
SCORE: 65

3.
FOR: ...
AGAINST: ...
SCORE: ...

Evaluate every paper in order using its number. Do not skip any paper.`;

// Matches numbered entries (1., 2., …) with FOR/AGAINST on single lines and a bare SCORE
const SCORE_REGEX =
  /^(\d+)\.[^\n]*\nFOR:\s*([^\n]+)\nAGAINST:\s*([^\n]+)\nSCORE:\s*(\d+)/gm;

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Blend search rank position (70%) with log-normalized citation count (30%).
 * Formula: round(0.7 * (1 - i/(n||1)) * 100 + 0.3 * citNorm * 100)
 * where citNorm = log10(c+1)/log10(maxC+1).
 */
export function heuristicScore(
  record: LiteratureRecord,
  rankIndex: number,
  groupSize: number,
  maxCitations: number,
): number {
  const n = groupSize || 1;
  const pos = 1 - rankIndex / n;
  const cites = record.citationCount ?? 0;
  const denom = Math.log10(Math.max(maxCitations, 0) + 1);
  const citNorm =
    denom > 0 ? Math.log10(Math.max(cites, 0) + 1) / denom : 0;
  return clampScore(0.7 * pos * 100 + 0.3 * citNorm * 100);
}

/**
 * Parse an LLM debate response into 0-based paper indices with score + reasoning.
 */
export function parseDebateResponse(
  text: string,
): Map<number, { score: number; for: string; against: string }> {
  const results = new Map<
    number,
    { score: number; for: string; against: string }
  >();
  const regex = new RegExp(SCORE_REGEX.source, SCORE_REGEX.flags);
  let match = regex.exec(text);
  while (match !== null) {
    const localIdx = Number.parseInt(match[1], 10) - 1; // 1-based → 0-based
    const forArg = match[2].trim();
    const againstArg = match[3].trim();
    const score = Number.parseInt(match[4], 10);
    if (!Number.isNaN(score) && localIdx >= 0) {
      results.set(localIdx, {
        score: clampScore(score),
        for: forArg,
        against: againstArg,
      });
    }
    match = regex.exec(text);
  }
  return results;
}

function buildUserPrompt(
  paragraphText: string,
  papers: LiteratureRecord[],
  fullDocContext?: string,
): string {
  const candidates = papers
    .map((p, i) => {
      const authors = (p.authors || []).slice(0, 3).join(", ");
      const abstract = (p.abstract || "").slice(0, ABSTRACT_MAX);
      return `${i + 1}. Title: ${p.title}\n   Authors: ${authors}\n   Abstract: ${abstract}`;
    })
    .join("\n\n");

  let prompt = "";
  if (fullDocContext) {
    const truncated = fullDocContext.slice(0, FULL_DOC_CONTEXT_MAX);
    prompt += `## Paper context:\n${truncated}\n\n`;
  }
  prompt += `## Paragraph needing citations:\n${paragraphText}\n\n## Candidate papers:\n${candidates}`;
  return prompt;
}

async function rankBatch(args: {
  paragraphText: string;
  batch: LiteratureRecord[];
  batchOffset: number;
  fullDocContext?: string;
  completeChat: CompleteChatFn;
  signal?: AbortSignal;
}): Promise<Map<number, { score: number; for: string; against: string }>> {
  const { paragraphText, batch, batchOffset, fullDocContext, completeChat, signal } =
    args;
  const user = buildUserPrompt(paragraphText, batch, fullDocContext);
  const content = await completeChat({
    system: SYSTEM_PROMPT,
    user,
    temperature: LLM_TEMPERATURE,
    signal,
  });

  const batchMap = parseDebateResponse(content || "");
  const globalMap = new Map<
    number,
    { score: number; for: string; against: string }
  >();
  for (const [localIdx, val] of batchMap) {
    globalMap.set(batchOffset + localIdx, val);
  }
  return globalMap;
}

/**
 * Rank literature candidates for a paragraph via LLM debate scoring,
 * falling back to heuristic scores (no throw) when the model fails or
 * omits a paper.
 */
export async function rankLiteraturePapers(args: {
  paragraphText: string;
  papers: LiteratureRecord[];
  fullDocContext?: string;
  completeChat: CompleteChatFn;
  batchSize?: number;
  signal?: AbortSignal;
}): Promise<RankedLiteraturePaper[]> {
  const {
    paragraphText,
    papers,
    fullDocContext,
    completeChat,
    batchSize = DEFAULT_BATCH_SIZE,
    signal,
  } = args;

  if (!papers.length) return [];

  const size = Math.max(1, batchSize);
  const maxCit = Math.max(
    1,
    ...papers.map((p) => p.citationCount ?? 0),
  );
  const n = papers.length;

  const scoreMap = new Map<
    number,
    { score: number; for: string; against: string }
  >();

  for (let i = 0; i < papers.length; i += size) {
    const batch = papers.slice(i, i + size);
    try {
      const batchMap = await rankBatch({
        paragraphText,
        batch,
        batchOffset: i,
        fullDocContext,
        completeChat,
        signal,
      });
      for (const [k, v] of batchMap) {
        scoreMap.set(k, v);
      }
    } catch (err) {
      // Abort must propagate so callers can cancel ranking mid-scan.
      if (
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        throw err;
      }
      // Non-abort batch failure: leave entries missing → heuristic below.
    }
  }

  return papers.map((record, i) => {
    const result = scoreMap.get(i);
    if (result) {
      return {
        record,
        score: result.score,
        reasoning: { for: result.for, against: result.against },
      };
    }
    return {
      record,
      score: heuristicScore(record, i, n, maxCit),
      reasoning: null,
    };
  });
}
