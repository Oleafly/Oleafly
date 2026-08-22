import {
  maskLatex,
  maskToProse,
  scanMathExpressions,
  spellcheckRanges,
} from "@oleafly/editor";

/**
 * The document summary shown in Project info.
 *
 * Word buckets partition the prose exactly once: `words === wordsInText +
 * wordsInHeaders + wordsOutsideText`. That invariant is ours, not texcount's —
 * texcount's headline "Sum count" folds in per-header and per-caption weights,
 * which makes its own three sub-counts fail to add up and confuses everyone who
 * checks the arithmetic.
 */
export interface DocumentStats {
  words: number;
  /** Body prose: everything that is not a heading, caption, or footnote. */
  wordsInText: number;
  wordsInHeaders: number;
  /** Captions, footnotes, and other float text that sits beside the body. */
  wordsOutsideText: number;
  headers: number;
  figures: number;
  mathInline: number;
  mathDisplayed: number;
  characters: number;
  lines: number;
}

export const EMPTY_DOCUMENT_STATS: DocumentStats = {
  words: 0,
  wordsInText: 0,
  wordsInHeaders: 0,
  wordsOutsideText: 0,
  headers: 0,
  figures: 0,
  mathInline: 0,
  mathDisplayed: 0,
  characters: 0,
  lines: 0,
};

const HEADING_CMDS = new Set([
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "subparagraph",
]);

// Prose that belongs to the document but not to its running text. texcount
// calls this "words outside text"; it is the bucket a reader skips when they
// read the argument straight through.
const OUTSIDE_TEXT_CMDS = new Set([
  "caption",
  "captionof",
  "footnote",
  "footnotetext",
  "thanks",
]);

const FIGURE_ENVS = new Set(["figure", "figure*", "wrapfigure", "SCfigure"]);

// Display-math environments a reader would count as one displayed equation.
// Helpers that only ever nest inside those (split, aligned, cases, array) are
// deliberately absent: counting them would double-count their parent.
const DISPLAY_MATH_ENVS = new Set([
  "displaymath",
  "equation",
  "equation*",
  "align",
  "align*",
  "alignat",
  "alignat*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "flalign",
  "flalign*",
  "eqnarray",
  "eqnarray*",
  "dmath",
  "dmath*",
]);

interface Span {
  from: number;
  to: number;
}

/** True when `offset` sits inside any span. Spans are sorted and disjoint. */
function inSpans(spans: readonly Span[], offset: number): boolean {
  let low = 0;
  let high = spans.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const span = spans[mid];
    if (offset < span.from) high = mid - 1;
    else if (offset >= span.to) low = mid + 1;
    else return true;
  }
  return false;
}

/**
 * End offset (exclusive) of the brace or bracket group opening at `open`, or
 * -1 when it never closes. Backslash escapes are skipped so `\{` inside an
 * argument cannot unbalance the scan.
 */
function groupEnd(text: string, open: number): number {
  const opener = text[open];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === opener) depth++;
    else if (ch === closer && --depth === 0) return i + 1;
  }
  return -1;
}

/** First non-whitespace offset at or after `from`, bounded by the text end. */
function skipSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

interface StructureScan {
  headerArgs: Span[];
  outsideArgs: Span[];
  headers: number;
  figures: number;
  displayMathEnvs: number;
}

/**
 * One linear pass over the source that finds heading and caption arguments and
 * counts headings, figures, and display-math environments.
 *
 * It walks the raw source rather than the spellchecker mask because the mask
 * blanks braces and command names — the very tokens this needs — while keeping
 * offsets aligned, so the spans produced here address the same coordinates the
 * mask's word ranges do.
 */
function scanStructure(text: string): StructureScan {
  const headerArgs: Span[] = [];
  const outsideArgs: Span[] = [];
  let headers = 0;
  let figures = 0;
  let displayMathEnvs = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === "%" && (i === 0 || text[i - 1] !== "\\")) {
      const lineEnd = text.indexOf("\n", i);
      i = lineEnd < 0 ? text.length : lineEnd;
      continue;
    }
    if (ch !== "\\") continue;

    const name = /^[a-zA-Z]+/.exec(text.slice(i + 1, i + 32))?.[0];
    if (!name) {
      i++; // An escaped character (\\, \{, \%) — never the start of a command.
      continue;
    }
    let cursor = i + 1 + name.length;

    if (name === "begin" || name === "end") {
      const open = skipSpace(text, cursor);
      if (text[open] !== "{") continue;
      const close = groupEnd(text, open);
      if (close < 0) continue;
      const env = text.slice(open + 1, close - 1).trim();
      if (name === "begin") {
        if (FIGURE_ENVS.has(env)) figures++;
        if (DISPLAY_MATH_ENVS.has(env)) displayMathEnvs++;
      }
      i = close - 1;
      continue;
    }

    const starred = text[cursor] === "*";
    if (starred) cursor++;
    const heading = HEADING_CMDS.has(name);
    const outside = OUTSIDE_TEXT_CMDS.has(name);
    if (!heading && !outside) continue;

    // \captionof{figure}{prose} names its float type first; the prose is the
    // second group. Every other command here takes prose in its first group.
    let groupsToSkip = name === "captionof" ? 1 : 0;
    for (;;) {
      const open = skipSpace(text, cursor);
      if (text[open] !== "{" && text[open] !== "[") break;
      const close = groupEnd(text, open);
      if (close < 0) break;
      // Optional arguments hold short-form titles, which are prose too, but
      // they duplicate the main argument; skipping them avoids counting the
      // same heading twice.
      if (text[open] === "[") {
        cursor = close;
        continue;
      }
      if (groupsToSkip > 0) {
        groupsToSkip--;
        cursor = close;
        continue;
      }
      (heading ? headerArgs : outsideArgs).push({ from: open + 1, to: close - 1 });
      if (heading) headers++;
      cursor = close;
      break;
    }
    i = cursor - 1;
  }

  headerArgs.sort((a, b) => a.from - b.from);
  outsideArgs.sort((a, b) => a.from - b.from);
  return { headerArgs, outsideArgs, headers, figures, displayMathEnvs };
}

/**
 * Summary counts for one source file.
 *
 * Words come from the spellchecker's LaTeX mask, so the total matches what a
 * reader perceives as prose: equation bodies, listings, comments, citation
 * keys, and dimension arguments never inflate it. When masking throws, every
 * count degrades to zero rather than reporting a number nobody can trust.
 */
export function documentStats(text: string): DocumentStats {
  let ranges: ReturnType<typeof spellcheckRanges>;
  let characters: number;
  let lines: number;
  try {
    ranges = spellcheckRanges(text);
    characters = maskToProse(text).prose.length;
    lines = maskLatex(text)
      .split("\n")
      .filter((line) => line.trim().length > 0).length;
  } catch {
    return { ...EMPTY_DOCUMENT_STATS };
  }

  const structure = scanStructure(text);
  let wordsInHeaders = 0;
  let wordsOutsideText = 0;
  for (const range of ranges) {
    if (inSpans(structure.headerArgs, range.from)) wordsInHeaders++;
    else if (inSpans(structure.outsideArgs, range.from)) wordsOutsideText++;
  }

  let mathInline = 0;
  let mathDisplayed = 0;
  try {
    for (const expression of scanMathExpressions(text, { format: "latex" })) {
      if (expression.display) mathDisplayed++;
      else mathInline++;
    }
  } catch {
    // Delimiter scanning is best-effort; environment counts below still hold.
  }

  return {
    words: ranges.length,
    wordsInText: ranges.length - wordsInHeaders - wordsOutsideText,
    wordsInHeaders,
    wordsOutsideText,
    headers: structure.headers,
    figures: structure.figures,
    mathInline,
    mathDisplayed: mathDisplayed + structure.displayMathEnvs,
    characters,
    lines,
  };
}

/** Adds per-file stats into one whole-document summary. */
export function sumDocumentStats(parts: readonly DocumentStats[]): DocumentStats {
  const total = { ...EMPTY_DOCUMENT_STATS };
  for (const part of parts) {
    total.words += part.words;
    total.wordsInText += part.wordsInText;
    total.wordsInHeaders += part.wordsInHeaders;
    total.wordsOutsideText += part.wordsOutsideText;
    total.headers += part.headers;
    total.figures += part.figures;
    total.mathInline += part.mathInline;
    total.mathDisplayed += part.mathDisplayed;
    total.characters += part.characters;
    total.lines += part.lines;
  }
  return total;
}
