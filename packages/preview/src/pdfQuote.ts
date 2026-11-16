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
