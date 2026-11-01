import {
  countedWordStarts,
  maskLatex,
  maskToProse,
  scanMathExpressions,
} from "@oleafly/editor";
import { typstDocumentCounts } from "@/lib/document-stats-typst";

export interface DocumentStats {
  words: number;
  wordsInText: number;
  wordsInHeaders: number;
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

const OUTSIDE_TEXT_CMDS = new Set([
  "caption",
  "captionof",
  "footnote",
  "footnotetext",
  "thanks",
]);

const FIGURE_ENVS = new Set(["figure", "figure*", "wrapfigure", "SCfigure"]);

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

function environmentStep(
  text: string,
  i: number,
  cursor: number,
  name: string,
  scan: StructureScan,
): number {
  const open = skipSpace(text, cursor);
  if (text[open] !== "{") return i + 1;
  const close = groupEnd(text, open);
  if (close < 0) return i + 1;
  const env = text.slice(open + 1, close - 1).trim();
  if (name === "begin") {
    if (FIGURE_ENVS.has(env)) scan.figures++;
    if (DISPLAY_MATH_ENVS.has(env)) scan.displayMathEnvs++;
  }
  return close;
}

function proseArgumentStep(
  text: string,
  start: number,
  name: string,
  heading: boolean,
  scan: StructureScan,
): number {
  let groupsToSkip = name === "captionof" ? 1 : 0;
  let cursor = start;
  for (;;) {
    const open = skipSpace(text, cursor);
    if (text[open] !== "{" && text[open] !== "[") break;
    const close = groupEnd(text, open);
    if (close < 0) break;
    if (text[open] === "[") {
      cursor = close;
      continue;
    }
    if (groupsToSkip > 0) {
      groupsToSkip--;
      cursor = close;
      continue;
    }
    if (heading) {
      scan.headerArgs.push({ from: open + 1, to: close - 1 });
      scan.headers++;
    } else {
      scan.outsideArgs.push({ from: open + 1, to: close - 1 });
    }
    cursor = close;
    break;
  }
  return cursor;
}

function scanStructureStep(
  text: string,
  i: number,
  scan: StructureScan,
): number {
  const ch = text[i];

  if (ch === "%" && (i === 0 || text[i - 1] !== "\\")) {
    const lineEnd = text.indexOf("\n", i);
    return (lineEnd < 0 ? text.length : lineEnd) + 1;
  }
  if (ch !== "\\") return i + 1;

  const name = /^[a-zA-Z]+/.exec(text.slice(i + 1, i + 32))?.[0];
  if (!name) return i + 2;
  const cursor = i + 1 + name.length;

  if (name === "begin" || name === "end") {
    return environmentStep(text, i, cursor, name, scan);
  }

  const afterStar = text[cursor] === "*" ? cursor + 1 : cursor;
  const heading = HEADING_CMDS.has(name);
  const outside = OUTSIDE_TEXT_CMDS.has(name);
  if (!heading && !outside) return i + 1;

  return proseArgumentStep(text, afterStar, name, heading, scan);
}

function scanStructure(text: string): StructureScan {
  const scan: StructureScan = {
    headerArgs: [],
    outsideArgs: [],
    headers: 0,
    figures: 0,
    displayMathEnvs: 0,
  };

  let i = 0;
  while (i < text.length) i = scanStructureStep(text, i, scan);

  scan.headerArgs.sort((a, b) => a.from - b.from);
  scan.outsideArgs.sort((a, b) => a.from - b.from);
  return scan;
}

export function isTypstPath(path: string | null | undefined): boolean {
  return typeof path === "string" && /\.typ$/i.test(path);
}

function typstDocumentStats(text: string): DocumentStats {
  try {
    const { summary, characters, lines } = typstDocumentCounts(text);
    return {
      words: summary.words,
      wordsInText: summary.wordsInText,
      wordsInHeaders: summary.wordsInHeaders,
      wordsOutsideText: summary.wordsOutsideText,
      headers: summary.headingsByLevel.reduce((total, count) => total + count, 0),
      figures: summary.figures,
      mathInline: summary.mathInline,
      mathDisplayed: summary.mathDisplayed,
      characters,
      lines,
    };
  } catch {
    return { ...EMPTY_DOCUMENT_STATS };
  }
}

export function documentStats(text: string, path?: string | null): DocumentStats {
  if (isTypstPath(path)) return typstDocumentStats(text);
  let starts: number[];
  let characters: number;
  let lines: number;
  try {
    const masked = maskLatex(text);
    starts = countedWordStarts(masked);
    characters = maskToProse(text).prose.length;
    lines = masked
      .split("\n")
      .filter((line) => line.trim().length > 0).length;
  } catch {
    return { ...EMPTY_DOCUMENT_STATS };
  }

  const structure = scanStructure(text);
  let wordsInHeaders = 0;
  let wordsOutsideText = 0;
  for (const start of starts) {
    if (inSpans(structure.headerArgs, start)) wordsInHeaders++;
    else if (inSpans(structure.outsideArgs, start)) wordsOutsideText++;
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
    words: starts.length,
    wordsInText: starts.length - wordsInHeaders - wordsOutsideText,
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
