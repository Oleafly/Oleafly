import type { Text } from "@codemirror/state";
import { renderedTex, sourceOffset } from "./tex-text";

export interface WordContext {
  before: string;
  after: string;
}

export interface WordRange {
  from: number;
  to: number;
}

interface Token {
  word: string;
  from: number;
  to: number;
}

/** Words compared on each side of the spot being looked up. */
export const CONTEXT_WORDS = 8;
const SOURCE_SLACK_WORDS = 4;
/**
 * Words taken on each side of a candidate: a few more than the lookup side, for
 * text only one side has, such as `\cite` keys in the source or "[1]" in the PDF.
 */
export const CANDIDATE_WORDS = CONTEXT_WORDS + SOURCE_SLACK_WORDS;
const SOURCE_WINDOW = 400;
const TOKEN = /[\p{L}\p{M}\p{N}\u200C\u200D]+/gu;

function tokens(text: string, offset = 0): Token[] {
  const rendered = renderedTex(text);
  const found: Token[] = [];
  for (const match of rendered.text.matchAll(TOKEN)) {
    const from = sourceOffset(rendered, match.index, false);
    if (text[from - 1] === "\\") continue;
    found.push({
      word: match[0].normalize("NFC").toLowerCase(),
      from: offset + from,
      to: offset + sourceOffset(rendered, match.index + match[0].length, true),
    });
  }
  return found;
}

function firstIndex(source: readonly Token[], accept: (token: Token) => boolean): number {
  let low = 0;
  let high = source.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (accept(source[middle])) high = middle;
    else low = middle + 1;
  }
  return low;
}

function alignment(query: readonly string[], candidate: readonly string[]): number {
  let previous = new Array<number>(candidate.length + 1).fill(0);
  for (let i = 0; i < query.length; i++) {
    const current = [0];
    for (let j = 0; j < candidate.length; j++) {
      const skip = Math.max(previous[j + 1], current[j]);
      current.push(query[i] === candidate[j] ? Math.max(skip, previous[j] + 1 / (1 + Math.abs(i - j))) : skip);
    }
    previous = current;
  }
  return previous[candidate.length];
}

/** Words on each side of a spot, nearest first, as `contextScore` compares them. */
export interface ContextWords {
  before: readonly string[];
  after: readonly string[];
}

/**
 * Up to `count` words on each side of a spot, from the text before and after
 * it. Words right after a backslash are command names and never reach the PDF,
 * so they are left out.
 */
export function contextWords(context: WordContext, count: number): ContextWords {
  return {
    before: tokens(context.before)
      .slice(-count)
      .reverse()
      .map((token) => token.word),
    after: tokens(context.after)
      .slice(0, count)
      .map((token) => token.word),
  };
}

/**
 * How well the words around one spot line up with the words around another,
 * nearest first on each side. A matching word scores 1 at the same distance
 * from the spot and less the further its position shifts, so a few words that
 * only one side has (a `\cite` key, a "[1]") cost little.
 */
export function contextScore(query: ContextWords, candidate: ContextWords): number {
  return alignment(query.before, candidate.before) + alignment(query.after, candidate.after);
}

/** Words right next to the spot that `ContextMatch.neighbours` compares. */
const NEIGHBOURS = 2;

export interface ContextMatch {
  score: number;
  /** How many of the words right next to the spot agree, position for position. */
  neighbours: number;
  /** How many of them both sides have. */
  compared: number;
}

function neighbourAgreement(query: readonly string[], candidate: readonly string[]): [number, number] {
  const compared = Math.min(NEIGHBOURS, query.length, candidate.length);
  let agreeing = 0;
  for (let index = 0; index < compared; index++) agreeing += Number(query[index] === candidate[index]);
  return [agreeing, compared];
}

/** `contextScore` plus how the words right next to the spot agree. */
export function compareContexts(query: ContextWords, candidate: ContextWords): ContextMatch {
  const [beforeAgreeing, beforeCompared] = neighbourAgreement(query.before, candidate.before);
  const [afterAgreeing, afterCompared] = neighbourAgreement(query.after, candidate.after);
  return {
    score: contextScore(query, candidate),
    neighbours: beforeAgreeing + afterAgreeing,
    compared: beforeCompared + afterCompared,
  };
}

/** Evidence a match away from where SyncTeX points has to show before it is taken. */
export const FAR_EVIDENCE = 6;
/** The lead a far match needs over the next best one. */
export const FAR_LEAD = 2;

/**
 * Whether the best of some far matches (sorted best first) is convincing: most
 * of the words around the spot in order, the words right next to it the same,
 * and a clear lead over the runner-up.
 */
export function convincingFarMatch(first: ContextMatch | undefined, second: ContextMatch | undefined): boolean {
  return (
    !!first &&
    first.score >= FAR_EVIDENCE &&
    first.compared >= 2 &&
    first.neighbours >= first.compared - 1 &&
    (!second || first.score - second.score >= FAR_LEAD)
  );
}

/**
 * How each candidate range in `doc` compares with the PDF text around the
 * click, in candidate order. All zero when there is no usable context.
 */
export function contextMatches(
  doc: Text,
  candidates: readonly WordRange[],
  context: WordContext | undefined,
): ContextMatch[] {
  const none = () => candidates.map(() => ({ score: 0, neighbours: 0, compared: 0 }));
  if (!candidates.length || !context) return none();
  const pdf = contextWords(context, CONTEXT_WORDS);
  if (!pdf.before.length && !pdf.after.length) return none();
  const ordered = [...candidates].sort((a, b) => a.from - b.from);
  const start = Math.max(0, ordered[0].from - SOURCE_WINDOW);
  const end = Math.min(doc.length, (ordered.at(-1) as WordRange).to + SOURCE_WINDOW);
  const source = tokens(doc.sliceString(start, end), start);
  return candidates.map((candidate) => {
    const beforeEnd = firstIndex(source, (token) => token.to > candidate.from);
    const afterStart = firstIndex(source, (token) => token.from >= candidate.to);
    return compareContexts(pdf, {
      before: source
        .slice(Math.max(0, beforeEnd - CANDIDATE_WORDS), beforeEnd)
        .reverse()
        .map((token) => token.word),
      after: source.slice(afterStart, afterStart + CANDIDATE_WORDS).map((token) => token.word),
    });
  });
}

/** The context score of each candidate, as `contextMatches` reports it. */
export function contextScores(
  doc: Text,
  candidates: readonly WordRange[],
  context: WordContext | undefined,
): number[] {
  return contextMatches(doc, candidates, context).map((match) => match.score);
}

export function closestToContext(
  doc: Text,
  candidates: readonly WordRange[],
  context: WordContext | undefined,
): WordRange | undefined {
  if (candidates.length < 2 || !context) return candidates[0];
  const scores = contextScores(doc, candidates, context);
  let best = 0;
  for (let index = 1; index < candidates.length; index++) {
    if (scores[index] > scores[best] + 1e-9) best = index;
  }
  return candidates[best];
}
