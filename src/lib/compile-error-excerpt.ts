import type { CompileError } from "@/lib/tauri";

export interface CompileErrorExcerpt {
  line: number;
  before: string;
  span: string;
  after: string;
  clippedStart: boolean;
  clippedEnd: boolean;
}

const CONTEXT = 60;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isLowSurrogate(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff;
}

function nextCharacterEnd(text: string, index: number): number {
  const codePoint = text.codePointAt(index);
  if (codePoint === undefined) return index;
  return index + (codePoint > 0xffff ? 2 : 1);
}

export function compileErrorExcerpt(error: CompileError): CompileErrorExcerpt | null {
  const text = error.source_line;
  if (text == null || error.line == null || error.column == null) return null;
  const start = clamp(error.column - 1, 0, text.length);
  const end =
    error.end_column == null
      ? nextCharacterEnd(text, start)
      : clamp(error.end_column - 1, start, text.length);
  let from = start > CONTEXT ? start - CONTEXT : 0;
  if (from > 0 && isLowSurrogate(text, from)) from -= 1;
  let to = text.length - end > CONTEXT ? end + CONTEXT : text.length;
  if (to < text.length && isLowSurrogate(text, to)) to += 1;
  return {
    line: error.line,
    before: text.slice(from, start),
    span: text.slice(start, end),
    after: text.slice(end, to),
    clippedStart: from > 0,
    clippedEnd: to < text.length,
  };
}

export function formatCompileErrorExcerpt(excerpt: CompileErrorExcerpt): string {
  const gutter = String(excerpt.line);
  const before = `${excerpt.clippedStart ? "…" : ""}${excerpt.before}`;
  const after = `${excerpt.after}${excerpt.clippedEnd ? "…" : ""}`;
  const caretPad = Array.from(before, (character) => (character === "\t" ? "\t" : " ")).join("");
  const caret = "^".repeat(Math.max(1, Array.from(excerpt.span).length));
  return `${gutter} | ${before}${excerpt.span}${after}\n${" ".repeat(gutter.length)} | ${caretPad}${caret}`;
}

export function formatCompileErrorDetails(error: CompileError, hintLabel: string): string {
  const excerpt = compileErrorExcerpt(error);
  return [
    ...(excerpt ? [formatCompileErrorExcerpt(excerpt)] : []),
    ...(error.hints ?? []).map((hint) => `${hintLabel}: ${hint}`),
  ].join("\n");
}
