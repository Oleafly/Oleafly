import { hayagrivaEntries, looksLikeHayagriva } from "@/lib/citation/hayagriva";
import { keywordQuery, type SplitParagraphOptions } from "./latex-paragraphs";
import type { DocumentParagraph } from "./types";

export type ScanFormat = "latex" | "typst";

const DEFAULT_MIN_LENGTH = 30;
const DEFAULT_MAX_PARAGRAPHS = 20;
const DEFAULT_MAX_TERMS = 15;

const STATEMENTS = new Set([
  "set",
  "show",
  "import",
  "include",
  "let",
  "bibliography",
  "outline",
  "pagebreak",
  "colbreak",
  "figure",
  "table",
  "image",
  "v",
  "h",
  "place",
  "grid",
  "metadata",
  "counter",
  "state",
  "context",
]);

const CLOSERS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };

function lineEnd(source: string, index: number): number {
  const newline = source.indexOf("\n", index);
  return newline < 0 ? source.length : newline;
}

function blockCommentEnd(source: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < source.length) {
    if (source.startsWith("/*", index)) {
      depth += 1;
      index += 2;
    } else if (source.startsWith("*/", index)) {
      depth -= 1;
      index += 2;
      if (depth === 0) return index;
    } else {
      index += 1;
    }
  }
  return source.length;
}

function commentEnd(source: string, index: number): number | null {
  if (source[index] !== "/") return null;
  if (source[index + 1] === "/" && source[index - 1] !== ":") return lineEnd(source, index);
  if (source[index + 1] === "*") return blockCommentEnd(source, index);
  return null;
}

function rawEnd(source: string, start: number): number {
  let ticks = 0;
  while (source[start + ticks] === "`") ticks += 1;
  if (ticks === 2) return start + 2;
  const fence = "`".repeat(ticks);
  const close = source.indexOf(fence, start + ticks);
  return close < 0 ? source.length : close + ticks;
}

function stringEnd(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length && source[index] !== '"' && source[index] !== "\n") {
    index += source[index] === "\\" ? 2 : 1;
  }
  return Math.min(source.length, index + 1);
}

function statementEnd(source: string, start: number): number {
  const stack: string[] = [];
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    const inContent = stack.at(-1) === "]";
    if (character === "\n" && stack.length === 0) return index;
    const comment = commentEnd(source, index);
    if (comment !== null) {
      index = comment;
    } else if (character === "\\") {
      index += 2;
    } else if (!inContent && character === '"') {
      index = stringEnd(source, index);
    } else if (character === "`") {
      index = rawEnd(source, index);
    } else if (CLOSERS[character] && (!inContent || character === "[")) {
      stack.push(CLOSERS[character]);
      index += 1;
    } else {
      if (character === stack.at(-1)) stack.pop();
      index += 1;
    }
  }
  return source.length;
}

function statementName(source: string, hash: number): string | null {
  return /^[A-Za-z_][\w-]*/.exec(source.slice(hash + 1, hash + 41))?.[0] ?? null;
}

function proseSource(source: string): string {
  let out = "";
  let index = 0;
  let lineStart = true;
  while (index < source.length) {
    const character = source[index];
    const comment = commentEnd(source, index);
    if (comment !== null) {
      index = comment;
      continue;
    }
    if (character === "`" && source.startsWith("```", index)) {
      index = rawEnd(source, index);
      out += "\n\n";
      continue;
    }
    if (character === "\\") {
      out += source.slice(index, index + 2);
      index += 2;
      lineStart = false;
      continue;
    }
    if (character === "#" && lineStart) {
      const name = statementName(source, index);
      if (name && STATEMENTS.has(name)) {
        index = statementEnd(source, index);
        out += "\n\n";
        continue;
      }
    }
    if (character === "\n") {
      lineStart = true;
    } else if (character.trim() !== "") {
      lineStart = false;
    }
    out += character;
    index += 1;
  }
  return out;
}

function isStructuralLine(line: string): boolean {
  const trimmed = line.trim();
  return /^=+\s/.test(trimmed) || /^<[\p{L}\p{N}_:.-]+>$/u.test(trimmed);
}

export function splitTypstParagraphs(
  source: string,
  options?: SplitParagraphOptions,
): DocumentParagraph[] {
  const minLength = options?.minLength ?? DEFAULT_MIN_LENGTH;
  const maxParagraphs = options?.maxParagraphs ?? DEFAULT_MAX_PARAGRAPHS;
  const paragraphs: DocumentParagraph[] = [];
  for (const chunk of proseSource(source).split(/\n\s*\n/)) {
    const text = chunk
      .split("\n")
      .filter((line) => !isStructuralLine(line))
      .map((line) => line.trimEnd())
      .join("\n")
      .trim();
    if (text.length < minLength) continue;
    paragraphs.push({ index: paragraphs.length, text });
    if (paragraphs.length >= maxParagraphs) break;
  }
  return paragraphs;
}

const CITATION_CALL = /#(?:cite|ref)\((?:[^()]|\([^()]*\))*\)/g;
const CALL_HEAD = /#[A-Za-z_][\w.-]*(?:\((?:[^()]|\([^()]*\))*\))?/g;

export function extractTypstKeywords(text: string, maxTerms: number = DEFAULT_MAX_TERMS): string {
  let cleaned = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  cleaned = cleaned.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  cleaned = cleaned.replace(/```[\s\S]*?```/g, " ");
  cleaned = cleaned.replace(/`[^`\n]*`/g, " ");
  cleaned = cleaned.replace(/\$[^$]*\$/g, " ");
  cleaned = cleaned.replace(CITATION_CALL, " ");
  cleaned = cleaned.replace(CALL_HEAD, " ");
  cleaned = cleaned.replace(/<[\p{L}\p{N}_:.-]+>/gu, " ");
  cleaned = cleaned.replace(/(^|[^\p{L}\p{N}])@[\p{L}\p{N}_:.-]*[\p{L}\p{N}_-]/gu, "$1 ");
  cleaned = cleaned.replace(/^\s*(?:=+|[-+]|\/)\s+/gm, " ");
  cleaned = cleaned.replace(/[*_[\]#\\]/g, "");
  cleaned = cleaned.replace(/~/g, " ");
  cleaned = cleaned.replace(/\s+([.,;:!?])/g, "$1");
  return keywordQuery(cleaned, maxTerms);
}

const TYPST_SIGNAL = /^\s*(?:#(?:set|show|import|let|include)\b|=+\s+\S)/m;
const LATEX_SIGNAL = /\\(?:section|subsection|begin|documentclass|cite[tp]?|usepackage)\b/;

export function detectScanFormat(path: string | null | undefined, text: string): ScanFormat {
  if (path && /\.typ$/i.test(path)) return "typst";
  if (path && /\.(?:tex|ltx|latex)$/i.test(path)) return "latex";
  if (LATEX_SIGNAL.test(text)) return "latex";
  return TYPST_SIGNAL.test(text) ? "typst" : "latex";
}

function bibtexValue(value: string): string {
  return value.replace(/[{}]/g, "");
}

export function hayagrivaIdentityText(yaml: string): string {
  if (!looksLikeHayagriva(yaml)) return "";
  return hayagrivaEntries(yaml)
    .filter((entry) => entry.isEntry)
    .map((entry) => {
      const fields = [
        entry.title ? `  title = {${bibtexValue(entry.title.value)}}` : null,
        entry.doi ? `  doi = {${bibtexValue(entry.doi)}}` : null,
      ].filter((field): field is string => field !== null);
      return `@misc{${entry.key},\n${fields.join(",\n")}\n}`;
    })
    .join("\n\n");
}
