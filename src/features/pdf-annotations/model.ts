import type { PdfAnnotation, PdfAnnotationKind, PdfAnnotationSource } from "@/lib/tauri";
import { lineSpan } from "./label";

export { annotationLabel, lineSpan } from "./label";

const MAX_EXCERPT_LINES = 60;
const MAX_EXCERPT_CHARS = 6_000;
const HEADING_SCAN_LINES = 2_000;

export function sourceExcerpt(text: string, startLine: number, endLine: number): string {
  const lines = text.split(/\r?\n/u);
  const from = Math.max(1, Math.min(startLine, endLine));
  const to = Math.min(lines.length, Math.max(startLine, endLine), from + MAX_EXCERPT_LINES - 1);
  if (from > lines.length) return "";
  return lines.slice(from - 1, to).join("\n").slice(0, MAX_EXCERPT_CHARS);
}

const FOLLOW_WINDOW = 400;
const FOLLOW_NEAR = 20;
const MIN_ANCHOR_CHARS = 4;
const MIN_SIMILARITY = 0.5;

function normalized(line: string): string {
  return line.trim().replace(/\s+/gu, " ");
}

function words(line: string): Set<string> {
  return new Set(line.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function alignedPairs(
  wanted: readonly string[],
  lines: readonly string[],
  from: number,
  uniqueOnly: boolean,
): [number, number][] {
  const rows = wanted.length;
  const cols = lines.length - from;
  const table = Array.from({ length: rows + 1 }, () => new Uint16Array(cols + 1));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i][j] =
        wanted[i] === lines[from + j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (wanted[i] === lines[from + j]) {
      pairs.push([i, from + j]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  const counts = new Map<string, number>();
  for (let index = from; index < lines.length; index += 1) {
    counts.set(lines[index], (counts.get(lines[index]) ?? 0) + 1);
  }
  return pairs.filter(
    ([index]) => wanted[index].length >= MIN_ANCHOR_CHARS && (!uniqueOnly || counts.get(wanted[index]) === 1),
  );
}

function mostSimilar(wanted: readonly string[], lines: readonly string[], near: number, from: number, to: number) {
  const target = words(wanted.join(" "));
  let best = -1;
  let score = MIN_SIMILARITY;
  for (let index = from; index < to; index += 1) {
    const value = similarity(target, words(lines[index]));
    if (value > score || (value === score && best >= 0 && Math.abs(index - near) < Math.abs(best - near))) {
      best = index;
      score = value;
    }
  }
  return best;
}

function exactCopy(wanted: readonly string[], lines: readonly string[], near: number): number {
  let best = -1;
  for (let at = 0; at + wanted.length <= lines.length; at += 1) {
    let same = true;
    for (let offset = 0; offset < wanted.length && same; offset += 1) {
      const want = wanted[offset];
      const line = lines[at + offset];
      same = offset === wanted.length - 1 ? line.startsWith(want) : line === want;
    }
    if (!same) continue;
    if (best < 0 || Math.abs(at - near) < Math.abs(best - near)) best = at;
    if (at >= near) break;
  }
  return best;
}

interface PreparedText {
  text: string;
  raw: string[];
  lines: string[];
}

const PREPARED_LIMIT = 4;
const prepared: PreparedText[] = [];

function prepare(text: string): PreparedText {
  const found = prepared.find((entry) => entry.text === text);
  if (found) return found;
  const raw = text.split(/\r?\n/u);
  const entry = { text, raw, lines: raw.map(normalized) };
  prepared.unshift(entry);
  prepared.length = Math.min(prepared.length, PREPARED_LIMIT);
  return entry;
}

export function followSource(source: PdfAnnotationSource, text: string): PdfAnnotationSource | null {
  const { raw, lines } = prepare(text);
  const span = Math.max(0, source.endLine - source.startLine);
  const moved = (start: number, end = start + span): PdfAnnotationSource | null => {
    if (start < 1 || start > raw.length) return null;
    end = Math.min(raw.length, Math.max(start, end));
    return { ...source, startLine: start, endLine: end, excerpt: sourceExcerpt(text, start, end) };
  };
  if (!source.excerpt.trim()) return source.startLine > raw.length ? null : moved(source.startLine);
  const wanted = source.excerpt.split("\n").map(normalized);
  const old = source.startLine - 1;
  const copy = exactCopy(wanted, lines, old);
  if (copy >= 0) return moved(copy + 1);
  const from = Math.max(0, old - FOLLOW_WINDOW);
  const to = Math.min(lines.length, old + span + FOLLOW_WINDOW + 1);
  const near = alignedPairs(
    wanted,
    lines.slice(0, Math.min(lines.length, old + span + FOLLOW_NEAR + 1)),
    Math.max(0, old - FOLLOW_NEAR),
    false,
  );
  const pairs = near.length > 0 ? near : alignedPairs(wanted, lines.slice(0, to), from, true);
  if (pairs.length > 0) {
    const [firstIndex, firstLine] = pairs[0];
    const [lastIndex, lastLine] = pairs[pairs.length - 1];
    return moved(firstLine - firstIndex + 1, lastLine + 1 + span - lastIndex);
  }
  const similar = mostSimilar(wanted, lines, old, from, to);
  return similar < 0 ? null : moved(similar + 1);
}

const LATEX_HEADING = /\\(?:part|chapter|section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{([^}]*)\}/u;
const TYPST_HEADING = /^\s*=+\s+(.+?)\s*$/u;
const MARKDOWN_HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u;

function headingPattern(path: string): RegExp | null {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (["tex", "ltx", "sty", "cls"].includes(extension)) return LATEX_HEADING;
  if (extension === "typ") return TYPST_HEADING;
  if (["md", "markdown", "qmd", "rmd"].includes(extension)) return MARKDOWN_HEADING;
  return null;
}

export function sectionHeading(path: string, text: string, line: number): string | null {
  const pattern = headingPattern(path);
  if (!pattern) return null;
  const lines = text.split(/\r?\n/u);
  const stop = Math.max(0, line - HEADING_SCAN_LINES);
  for (let index = Math.min(line, lines.length) - 1; index >= stop; index -= 1) {
    const found = lines[index]?.match(pattern);
    const title = found?.[1]?.trim();
    if (title) return title;
  }
  return null;
}

function fenceLanguage(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (extension === "bib") return "bibtex";
  if (["tex", "sty", "cls", "ltx"].includes(extension)) return "latex";
  if (extension === "typ") return "typst";
  if (["md", "markdown", "qmd", "rmd"].includes(extension)) return "markdown";
  return "";
}

function fence(text: string, language: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${language}\n${text}\n${ticks}`;
}

const ASKS: Record<PdfAnnotationKind, string> = {
  comment: "The comment is about the selected text.",
  delete: "Delete only the selected text. Keep the words around it.",
  replace: "Replace only the selected text with the replacement. Keep the words around it.",
  insert: "Insert the new text right after the selected text. Change nothing else.",
  region: "The comment is about the marked region of the page: the text, equation, figure or table inside it.",
};

const EXACT_TEXT: Partial<Record<PdfAnnotationKind, string>> = {
  replace: "Replacement",
  insert: "New text",
};

export interface CurrentSource {
  source: PdfAnnotationSource | null;
  checked: boolean;
  heading: string | null;
}

export function currentSource(annotation: PdfAnnotation, text: string | null): CurrentSource {
  const stored = annotation.source;
  if (!stored) return { source: null, checked: false, heading: null };
  if (text === null) return { source: stored, checked: false, heading: null };
  const followed = followSource(stored, text);
  return {
    source: followed,
    checked: true,
    heading: followed ? sectionHeading(followed.path, text, followed.startLine) : null,
  };
}

function locationLine(annotation: PdfAnnotation, current: CurrentSource): string {
  const page = `page ${annotation.page}`;
  const stored = annotation.source;
  if (!stored) return `Location: ${page}. No source location was found.`;
  if (!current.source) {
    return `Location: ${stored.path}. The lines this note was made on (${lineSpan(stored)}, ${page}) are no longer in the file. Look for the passage nearby.`;
  }
  const where = `${current.source.path}:${lineSpan(current.source)} (${page})`;
  const section = current.heading ? `, in "${current.heading}"` : "";
  const unchecked = current.checked ? "" : ". The file was not open, so the lines were not checked again";
  return `Location: ${where}${section}${unchecked}.`;
}

function points(value: number): number {
  return Math.round(value);
}

function regionLines(annotation: PdfAnnotation): string[] {
  const lines: string[] = [];
  const box = annotation.boxes[0];
  if (box) {
    lines.push(
      `Region: page ${box.page}, x ${points(box.x)} to ${points(box.x + box.width)} pt and y ${points(box.y)} to ${points(box.y + box.height)} pt from the top-left corner of the page.`,
    );
  }
  const { text, before, after } = annotation.quote;
  if (before.trim()) lines.push(`Just above the region on the PDF: ${JSON.stringify(before.trim())}`);
  if (text.trim()) lines.push("Text inside the region on the PDF:", fence(text, ""));
  else lines.push("No text was read from inside the region.");
  if (after.trim()) lines.push(`Just below the region on the PDF: ${JSON.stringify(after.trim())}`);
  return lines;
}

function quoteLines(annotation: PdfAnnotation): string[] {
  if (annotation.kind === "region") return regionLines(annotation);
  const { text, before, after } = annotation.quote;
  if (!text.trim()) return [];
  const lead = before.trim() ? `…${before.trimStart()}` : "";
  const tail = after.trim() ? `${after.trimEnd()}…` : "";
  return [`Selected text: ${JSON.stringify(text)}`, `On the PDF, in brackets: ${lead}[${text}]${tail}`];
}

function commentLine(annotation: PdfAnnotation): string | null {
  const label = EXACT_TEXT[annotation.kind];
  if (label) return `${label}: ${JSON.stringify(annotation.comment)}`;
  const comment = annotation.comment.trim();
  return comment ? `Comment: ${comment}` : null;
}

function sourceLabel(annotation: PdfAnnotation): string {
  if (!annotation.quote.text.trim()) return "Source:";
  const what = annotation.kind === "region" ? "the region's text" : "the selected text";
  return `Source lines that hold ${what}, which may carry markup the PDF hides:`;
}

export function annotationPrompt(annotation: PdfAnnotation, current: CurrentSource): string {
  const quote = quoteLines(annotation);
  const lines = [
    `Note ${annotation.number} on the compiled PDF`,
    locationLine(annotation, current),
    ...quote,
    `Asked: ${ASKS[annotation.kind]}`,
  ];
  const comment = commentLine(annotation);
  if (comment) lines.push(comment);
  const excerpt = current.source?.excerpt ?? "";
  if (current.source && excerpt) {
    lines.push(sourceLabel(annotation), fence(excerpt, fenceLanguage(current.source.path)));
  }
  return lines.join("\n");
}
