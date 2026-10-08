import { findLatexPackage } from "./bib-text";

export interface HandBibItem {
  readonly key: string;
  readonly text: string;
}

export interface HandBibliography {
  readonly from: number;
  readonly to: number;
  readonly closed: boolean;
  readonly convertible: boolean;
  readonly items: readonly HandBibItem[];
}

const BEGIN = /\\begin\s*\{thebibliography\}/g;
const END = /\\end\s*\{thebibliography\}/g;
const BIBITEM = /\\bibitem(?![A-Za-z@])/g;
const KEY = /^[^\s,{}()"#%\\]+$/;
const STYLE = /\\bibliographystyle\s*\{/;

export function maskComments(source: string): string {
  return source.replace(/\\[\s\S]|%[^\n]*/g, (match) => (match.startsWith("%") ? " ".repeat(match.length) : match));
}

function stripComments(text: string): string {
  return text.replace(/\\[\s\S]|%[^\n]*(?:\n[ \t]*)?/g, (match) => (match.startsWith("%") ? "" : match));
}

function skipSpace(text: string, index: number): number {
  let at = index;
  while (at < text.length && /\s/.test(text[at])) at++;
  return at;
}

function closing(text: string, open: number, closer: "}" | "]"): number {
  let depth = 0;
  for (let index = open + 1; index < text.length; index++) {
    const character = text[index];
    if (character === "\\") {
      index++;
    } else if (character === "{") {
      depth++;
    } else if (character === "}") {
      if (depth === 0) return closer === "}" ? index : -1;
      depth--;
    } else if (character === closer && depth === 0) {
      return index;
    }
  }
  return -1;
}

function bibtexBalanced(text: string): boolean {
  let depth = 0;
  for (const character of text) {
    if (character === "{") depth++;
    else if (character === "}" && --depth < 0) return false;
  }
  return depth === 0;
}

function endAfter(masked: string, from: number): { index: number; length: number } | null {
  const pattern = new RegExp(END.source, "g");
  pattern.lastIndex = from;
  const match = pattern.exec(masked);
  return match ? { index: match.index, length: match[0].length } : null;
}

function bodyStart(masked: string, from: number): number {
  const at = skipSpace(masked, from);
  if (masked[at] !== "{") return from;
  const close = closing(masked, at, "}");
  return close < 0 ? -1 : close + 1;
}

function parseItems(source: string, masked: string, from: number, to: number): HandBibItem[] | null {
  const starts: number[] = [];
  const pattern = new RegExp(BIBITEM.source, "g");
  pattern.lastIndex = from;
  for (let match = pattern.exec(masked); match && match.index < to; match = pattern.exec(masked)) {
    starts.push(match.index);
  }
  const items: HandBibItem[] = [];
  for (let position = 0; position < starts.length; position++) {
    const limit = starts[position + 1] ?? to;
    let at = skipSpace(masked, starts[position] + "\\bibitem".length);
    if (masked[at] === "[") {
      const label = closing(masked, at, "]");
      if (label < 0 || label >= limit) return null;
      at = skipSpace(masked, label + 1);
    }
    if (masked[at] !== "{") return null;
    const close = closing(masked, at, "}");
    if (close < 0 || close >= limit) return null;
    const key = source.slice(at + 1, close).trim();
    if (!KEY.test(key)) return null;
    const text = stripComments(source.slice(close + 1, limit)).replace(/\s+/g, " ").trim();
    if (!bibtexBalanced(text)) return null;
    items.push({ key, text });
  }
  return items;
}

export function findHandBibliographies(source: string): HandBibliography[] {
  const masked = maskComments(source);
  const found: HandBibliography[] = [];
  for (const begin of masked.matchAll(BEGIN)) {
    const from = begin.index;
    const afterBegin = from + begin[0].length;
    const end = endAfter(masked, afterBegin);
    if (!end) {
      found.push({ from, to: source.length, closed: false, convertible: false, items: [] });
      continue;
    }
    const start = bodyStart(masked, afterBegin);
    const items = start < 0 || start > end.index ? null : parseItems(source, masked, start, end.index);
    found.push({ from, to: end.index + end.length, closed: true, convertible: items !== null, items: items ?? [] });
  }
  return found;
}

export function handBibEntry(item: HandBibItem): string {
  return `@misc{${item.key},\n  note = {${item.text}}\n}`;
}

export function handBibEntries(items: readonly HandBibItem[], skip: ReadonlySet<string>): string[] {
  const seen = new Set(skip);
  const entries: string[] = [];
  for (const item of items) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    entries.push(handBibEntry(item));
  }
  return entries;
}

export function handListDeclaration(bibliography: string, sources: readonly string[]): string {
  const stem = bibliography.replaceAll("\\", "/").replace(/\.bib$/i, "");
  const masked = sources.map(maskComments);
  if (masked.some((text) => STYLE.test(text))) return `\\bibliography{${stem}}`;
  const style = masked.some((text) => findLatexPackage(text, "natbib")) ? "unsrtnat" : "unsrt";
  return `\\bibliographystyle{${style}}\n\\bibliography{${stem}}`;
}

export function replaceHandBibliography(source: string, list: HandBibliography, replacement: string): string {
  return `${source.slice(0, list.from)}${replacement}${source.slice(list.to)}`;
}
