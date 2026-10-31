import {
  CANDIDATE_WORDS,
  CONTEXT_WORDS,
  compareContexts,
  contextWords,
  convincingFarMatch,
  type ContextMatch,
  type WordContext,
} from "./word-context";

export interface PdfTextRun {
  str: string;
  x: number;
  top: number;
  width: number;
  height: number;
  hasEOL?: boolean;
}

export interface PageRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SyncTexLine extends PageRect {
  from: number;
  to: number;
}

export interface SourceWord extends WordContext {
  word: string;
}

const WORD = /[\p{L}\p{M}\p{N}]/u;
const TEXT_AROUND = 300;
/**
 * Score added when an occurrence sits in the stretch SyncTeX gives for the
 * source line. A wrapped source line shares its typeset lines with the lines
 * around it, and the same phrase often repeats in them.
 */
const STRETCH_BONUS = 2;
const STRETCH_SLACK = 3;

interface Spot {
  page: number;
  run: number;
}

interface FlowText {
  text: string;
  spots: Spot[];
  offsets: number[];
}

/**
 * The pages' text as one string, the way it reads, so the words around an
 * occurrence carry on across a page break. Ligatures are spelled out (Tectonic
 * output keeps "ﬀ" as one character), and a word LaTeX hyphenated at a line
 * end is joined back so it matches the source.
 */
function flowText(pages: readonly number[], runsByPage: ReadonlyMap<number, readonly PdfTextRun[]>): FlowText {
  let text = "";
  const spots: Spot[] = [];
  const offsets: number[] = [];
  const push = (piece: string, spot: Spot, offset: number) => {
    text += piece;
    spots.push(...new Array<Spot>(piece.length).fill(spot));
    offsets.push(...new Array<number>(piece.length).fill(offset));
  };
  for (const page of pages) {
    const runs = runsByPage.get(page) ?? [];
    runs.forEach((run, index) => {
      const spot = { page, run: index };
      Array.from(run.str).forEach((character, offset) => push(character.normalize("NFKC"), spot, offset));
      const last = index === runs.length - 1;
      if (!run.hasEOL && !last) return;
      const next = (last ? runsByPage.get(pages[pages.indexOf(page) + 1] ?? -1)?.[0] : runs[index + 1])?.str ?? "";
      if (/\p{L}-$/u.test(text) && /^\p{Ll}/u.test(next)) {
        text = text.slice(0, -1);
        spots.pop();
        offsets.pop();
      } else {
        push(" ", spot, Array.from(run.str).length);
      }
    });
  }
  return { text, spots, offsets };
}

interface Occurrence {
  spot: Spot;
  middle: number;
  match: ContextMatch;
}

function occurrences(
  pages: readonly number[],
  runsByPage: ReadonlyMap<number, readonly PdfTextRun[]>,
  spot: SourceWord,
): Occurrence[] {
  const needle = spot.word.normalize("NFKC");
  if (!needle) return [];
  const query = contextWords(spot, CONTEXT_WORDS);
  const { text, spots, offsets } = flowText(pages, runsByPage);
  const found: Occurrence[] = [];
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    const end = at + needle.length;
    if (WORD.test(text[at - 1] ?? "") || WORD.test(text[end] ?? "")) continue;
    const where = spots[at];
    const run = runsByPage.get(where.page)?.[where.run];
    if (!run) continue;
    const characters = Math.max(1, Array.from(run.str).length);
    found.push({
      spot: where,
      middle: run.x + ((offsets[at] + Array.from(needle).length / 2) / characters) * run.width,
      match: compareContexts(
        query,
        contextWords(
          { before: text.slice(Math.max(0, at - TEXT_AROUND), at), after: text.slice(end, end + TEXT_AROUND) },
          CANDIDATE_WORDS,
        ),
      ),
    });
  }
  return found;
}

function holds(line: PageRect, run: PdfTextRun): boolean {
  const middle = run.top + run.height / 2;
  return (
    middle >= line.y - 1 &&
    middle <= line.y + line.height + 1 &&
    run.x < line.x + line.width &&
    run.x + run.width > line.x
  );
}

/**
 * The typeset line that holds the word under the cursor, out of the lines
 * SyncTeX gives for its source line.
 *
 * SyncTeX maps a source line to every typeset line it fills. When one source
 * line holds a whole paragraph, the first of them is usually lines away from
 * the cursor. Every occurrence of the cursor's word in those lines is scored on
 * how well the PDF words around it match the source words around the cursor,
 * the same comparison the PDF-to-source direction uses. Null when the word is
 * not in any of them, so the caller keeps SyncTeX's first line.
 */
export function pickForwardLine(
  lines: readonly SyncTexLine[],
  runsByPage: ReadonlyMap<number, readonly PdfTextRun[]>,
  spot: SourceWord,
): SyncTexLine | null {
  const pages = [...new Set(lines.map((line) => line.page))].sort((a, b) => a - b);
  let chosen: SyncTexLine | null = null;
  let chosenScore = Number.NEGATIVE_INFINITY;
  for (const occurrence of occurrences(pages, runsByPage, spot)) {
    const run = runsByPage.get(occurrence.spot.page)?.[occurrence.spot.run];
    const line = run && lines.find((candidate) => candidate.page === occurrence.spot.page && holds(candidate, run));
    if (!line) continue;
    const inStretch =
      occurrence.middle >= line.from - STRETCH_SLACK && occurrence.middle <= line.to + STRETCH_SLACK;
    const score = occurrence.match.score + (inStretch ? STRETCH_BONUS : 0);
    if (score > chosenScore + 1e-9) {
      chosen = line;
      chosenScore = score;
    }
  }
  return chosen;
}

const TYPST_LINES_AFTER = 60;
const TYPST_LINES_BEFORE = 20;

/**
 * The typeset lines around a Typst forward jump, as candidates for the line
 * with the cursor's word.
 *
 * Typst's preview server answers a forward jump with the start of the block
 * that holds the cursor, usually its paragraph, whichever word the cursor is
 * on. The word is mostly in the lines from that point on. When a paragraph
 * runs over a page break the server can name the part on the next page, so the
 * lines before the anchor, back onto the previous page, are candidates too;
 * only the lines from the anchor on count as the block's own stretch.
 */
export function linesFromAnchor(
  anchor: PageRect,
  runsByPage: ReadonlyMap<number, readonly PdfTextRun[]>,
): SyncTexLine[] {
  const { placed, anchorIndex } = runsAround(anchor, runsByPage);
  if (anchorIndex < 0) return [];
  const first = Math.max(0, anchorIndex - TYPST_LINES_BEFORE);
  const lines: SyncTexLine[] = [];
  placed.slice(first, anchorIndex + TYPST_LINES_AFTER).forEach(({ page, run }, index) => {
    const own = first + index >= anchorIndex;
    const previous = lines.at(-1);
    if (previous?.page === page && sameBaseline(previous, run)) {
      widenLine(previous, run, own);
      return;
    }
    lines.push({
      page,
      x: run.x,
      y: run.top,
      width: run.width,
      height: run.height,
      from: own ? run.x : Number.POSITIVE_INFINITY,
      to: own ? run.x + run.width : Number.NEGATIVE_INFINITY,
    });
  });
  return lines;
}

function runsAround(
  anchor: PageRect,
  runsByPage: ReadonlyMap<number, readonly PdfTextRun[]>,
): { placed: { page: number; run: PdfTextRun }[]; anchorIndex: number } {
  const placed: { page: number; run: PdfTextRun }[] = [];
  let anchorIndex = -1;
  for (const page of [anchor.page - 1, anchor.page, anchor.page + 1]) {
    for (const run of runsByPage.get(page) ?? []) {
      if (run.str.trim() === "" || run.width <= 0) continue;
      if (page === anchor.page && anchorIndex < 0 && pointsAt(anchor, run)) anchorIndex = placed.length;
      placed.push({ page, run });
    }
  }
  return { placed, anchorIndex };
}

function pointsAt(anchor: PageRect, run: PdfTextRun): boolean {
  const x = anchor.x + 1;
  const y = anchor.y + anchor.height / 2;
  const under = x >= run.x - 1 && x <= run.x + run.width + 1 && y >= run.top - 2 && y <= run.top + run.height + 2;
  return under || run.top >= anchor.y + anchor.height;
}

function widenLine(line: SyncTexLine, run: PdfTextRun, own: boolean) {
  const right = Math.max(line.x + line.width, run.x + run.width);
  const bottom = Math.max(line.y + line.height, run.top + run.height);
  line.x = Math.min(line.x, run.x);
  line.y = Math.min(line.y, run.top);
  line.width = right - line.x;
  line.height = bottom - line.y;
  if (own) {
    line.from = Math.min(line.from, run.x);
    line.to = Math.max(line.to, run.x + run.width);
  }
}

function sameBaseline(line: PageRect, run: PdfTextRun): boolean {
  return Math.abs(line.y + line.height / 2 - (run.top + run.height / 2)) <= Math.min(line.height, run.height) / 2;
}

/**
 * Where the cursor's word is on `pages` when SyncTeX has nothing for its line,
 * such as `\title` text, typeset at `\maketitle`. Only a match with the evidence
 * `convincingFarMatch` asks for counts; otherwise null.
 */
export function findWordOnPages(
  pages: readonly number[],
  runsByPage: ReadonlyMap<number, readonly PdfTextRun[]>,
  spot: SourceWord,
): PageRect | null {
  const ranked = occurrences(pages, runsByPage, spot).sort((a, b) => b.match.score - a.match.score);
  const [first, second] = ranked;
  if (!first || !convincingFarMatch(first.match, second?.match)) return null;
  const run = runsByPage.get(first.spot.page)?.[first.spot.run];
  return run ? { page: first.spot.page, x: run.x, y: run.top, width: run.width, height: run.height } : null;
}
