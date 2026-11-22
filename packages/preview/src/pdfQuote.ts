import type { PdfTextRun, SynctexRect } from "./pdfController";

export interface PdfQuote {
  text: string;
  before?: string;
  after?: string;
}

interface KeyCharacter {
  run: number;
  from: number;
  to: number;
}

const WHITESPACE = /\s/u;

function keyOf(text: string): string {
  let key = "";
  for (const character of text) {
    for (const piece of character.normalize("NFKC")) {
      if (!WHITESPACE.test(piece)) key += piece;
    }
  }
  return key;
}

function indexRuns(runs: readonly PdfTextRun[]): { key: string; map: KeyCharacter[] } {
  let key = "";
  const map: KeyCharacter[] = [];
  runs.forEach((run, index) => {
    let offset = 0;
    for (const character of run.str) {
      const from = offset;
      offset += character.length;
      for (const piece of character.normalize("NFKC")) {
        if (WHITESPACE.test(piece)) continue;
        key += piece;
        for (let unit = 0; unit < piece.length; unit++) map.push({ run: index, from, to: offset });
      }
    }
  });
  return { key, map };
}

function matchingBefore(key: string, start: number, before: string): number {
  let length = 0;
  while (length < start && length < before.length && key[start - 1 - length] === before[before.length - 1 - length]) {
    length++;
  }
  return length;
}

function matchingAfter(key: string, end: number, after: string): number {
  let length = 0;
  while (end + length < key.length && length < after.length && key[end + length] === after[length]) length++;
  return length;
}

function boxesFor(runs: readonly PdfTextRun[], map: KeyCharacter[], page: number, start: number, end: number) {
  const spans = new Map<number, { from: number; to: number }>();
  for (let index = start; index < end; index++) {
    const { run, from, to } = map[index];
    const span = spans.get(run);
    if (span) {
      span.from = Math.min(span.from, from);
      span.to = Math.max(span.to, to);
    } else {
      spans.set(run, { from, to });
    }
  }
  const boxes: SynctexRect[] = [];
  for (const [index, { from, to }] of spans) {
    const run = runs[index];
    const length = run.str.length;
    if (length === 0) continue;
    const x = run.x + (run.width * from) / length;
    const width = (run.width * (to - from)) / length;
    if (![x, run.top, width, run.height].every(Number.isFinite)) continue;
    boxes.push({ page, x, y: run.top, width, height: run.height });
  }
  return boxes;
}

export function findQuoteBoxes(
  page: number,
  runs: readonly PdfTextRun[],
  quote: PdfQuote,
  near?: { y: number },
): SynctexRect[] | null {
  const needle = keyOf(quote.text);
  if (!needle) return null;
  const { key, map } = indexRuns(runs);
  const before = keyOf(quote.before ?? "");
  const after = keyOf(quote.after ?? "");
  let best: { start: number; context: number; distance: number } | null = null;
  for (let start = key.indexOf(needle); start >= 0; start = key.indexOf(needle, start + 1)) {
    const end = start + needle.length;
    const context = matchingBefore(key, start, before) + matchingAfter(key, end, after);
    const run = runs[map[start].run];
    const distance = near ? Math.abs(run.top + run.height / 2 - near.y) : 0;
    if (
      !best ||
      context > best.context ||
      (context === best.context && distance < best.distance)
    ) {
      best = { start, context, distance };
    }
  }
  if (!best) return null;
  const boxes = boxesFor(runs, map, page, best.start, best.start + needle.length);
  return boxes.length > 0 ? boxes : null;
}

interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Piece {
  text: string;
  top: number;
  height: number;
  left: number;
  right: number;
}

const CONTEXT_CHARACTERS = 32;
const WORD_GAP = 0.15;

function usable(run: PdfTextRun): boolean {
  return run.str.length > 0 && run.width > 0 && run.height > 0 && [run.x, run.top, run.width, run.height].every(Number.isFinite);
}

function middleOf(run: PdfTextRun): number {
  return run.top + run.height / 2;
}

function sameLine(a: { top: number; height: number }, b: { top: number; height: number }): boolean {
  return Math.abs(a.top - b.top) < Math.max(a.height, b.height) / 2;
}

function joinPieces(pieces: readonly Piece[]): string {
  const lines: string[] = [];
  let line = "";
  let previous: Piece | null = null;
  for (const piece of pieces) {
    if (previous && !sameLine(previous, piece)) {
      lines.push(line);
      line = "";
    } else if (previous && piece.left - previous.right > piece.height * WORD_GAP && !/\s$/u.test(line) && !/^\s/u.test(piece.text)) {
      line += " ";
    }
    line += piece.text;
    previous = piece;
  }
  lines.push(line);
  return lines
    .map((text) => text.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function wholeLine(runs: readonly PdfTextRun[], at: PdfTextRun): string {
  const pieces = runs
    .filter((run) => usable(run) && sameLine(run, at))
    .map((run) => ({ text: run.str, top: run.top, height: run.height, left: run.x, right: run.x + run.width }));
  return joinPieces(pieces).replace(/\n/gu, " ");
}

function nearestLine(runs: readonly PdfTextRun[], box: PageBox, side: "above" | "below"): PdfTextRun | null {
  let best: PdfTextRun | null = null;
  for (const run of runs) {
    if (!usable(run) || run.x >= box.x + box.width || run.x + run.width <= box.x) continue;
    const middle = middleOf(run);
    if (side === "above" ? middle >= box.y : middle <= box.y + box.height) continue;
    if (!best || (side === "above" ? middle > middleOf(best) : middle < middleOf(best))) best = run;
  }
  return best;
}

export function quoteInBox(runs: readonly PdfTextRun[], box: PageBox): Required<PdfQuote> {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const pieces: Piece[] = [];
  for (const run of runs) {
    if (!usable(run)) continue;
    const middle = middleOf(run);
    if (middle < box.y || middle > bottom) continue;
    const step = run.width / run.str.length;
    const from = Math.max(0, Math.ceil((box.x - run.x) / step - 0.5));
    const to = Math.min(run.str.length, Math.floor((right - run.x) / step - 0.5) + 1);
    if (to <= from) continue;
    pieces.push({
      text: run.str.slice(from, to),
      top: run.top,
      height: run.height,
      left: run.x + from * step,
      right: run.x + to * step,
    });
  }
  const above = nearestLine(runs, box, "above");
  const below = nearestLine(runs, box, "below");
  return {
    text: joinPieces(pieces),
    before: above ? Array.from(wholeLine(runs, above)).slice(-CONTEXT_CHARACTERS).join("").trimStart() : "",
    after: below ? Array.from(wholeLine(runs, below)).slice(0, CONTEXT_CHARACTERS).join("").trimEnd() : "",
  };
}
