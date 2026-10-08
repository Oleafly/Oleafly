import { maskTypstSource } from "../typst-syntax";
import type { PathReference, TextSpan } from "./types";

const CALL =
  /(?<![\p{L}\p{N}_.-])(image|read|json|csv|yaml|toml|xml|cbor|plugin|bibliography)\s*\(/gu;
const KEYWORD = /(?<![\p{L}\p{N}_.-])(include|import)\s+(?=")/gu;
const STYLE_ARGUMENT = /(?<![\p{L}\p{N}_-])style\s*:\s*(?=")/gu;

function stringSpan(text: string, quote: number): (TextSpan & { end: number }) | null {
  if (text[quote] !== '"') return null;
  for (let cursor = quote + 1; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (character === "\n") return null;
    if (character === "\\") {
      cursor += 1;
      continue;
    }
    if (character === '"') {
      return { from: quote + 1, to: cursor, raw: text.slice(quote + 1, cursor), end: cursor + 1 };
    }
  }
  return null;
}

function skipSpace(text: string, at: number): number {
  let cursor = at;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let cursor = open; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (character === '"') {
      const span = stringSpan(text, cursor);
      if (!span) return text.length;
      cursor = span.end - 1;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return text.length;
}

function reference(command: string, span: TextSpan): PathReference {
  return { language: "typst", kind: "typst", command, from: span.from, to: span.to, raw: span.raw };
}

function arrayStrings(text: string, open: number, command: string): PathReference[] {
  const close = closingParen(text, open);
  const references: PathReference[] = [];
  let cursor = skipSpace(text, open + 1);
  while (cursor < close) {
    const span = stringSpan(text, cursor);
    if (!span) break;
    references.push(reference(command, span));
    cursor = skipSpace(text, span.end);
    if (text[cursor] !== ",") break;
    cursor = skipSpace(text, cursor + 1);
  }
  return references;
}

function callReferences(text: string, command: string, open: number): PathReference[] {
  const first = skipSpace(text, open + 1);
  const references: PathReference[] = [];
  const span = stringSpan(text, first);
  if (span) references.push(reference(command, span));
  else if (command === "bibliography" && text[first] === "(") {
    references.push(...arrayStrings(text, first, command));
  }
  if (command === "bibliography") {
    const close = closingParen(text, open);
    const args = text.slice(open, close);
    for (const match of args.matchAll(STYLE_ARGUMENT)) {
      const style = stringSpan(text, open + match.index + match[0].length);
      if (style) references.push(reference(command, style));
    }
  }
  return references;
}

export function scanTypstReferences(source: string): PathReference[] {
  const visible = maskTypstSource(source).text;
  const references: PathReference[] = [];
  for (const match of visible.matchAll(CALL)) {
    references.push(...callReferences(visible, match[1], match.index + match[0].length - 1));
  }
  for (const match of visible.matchAll(KEYWORD)) {
    const span = stringSpan(visible, match.index + match[0].length);
    if (span) references.push(reference(match[1], span));
  }
  return references
    .filter((found) => found.raw === source.slice(found.from, found.to))
    .sort((left, right) => left.from - right.from);
}
