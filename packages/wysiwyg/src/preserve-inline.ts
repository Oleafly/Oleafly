import type { JSONContent } from "@tiptap/core";
import { splitMathSource } from "./math/source";

export interface PreservedInlineRange {
  from: number;
  to: number;
}

interface NormalizedInlineRange extends PreservedInlineRange {
  source: string;
}

export function normalizePreservedRanges(
  source: string,
  contentOffset: number,
  ranges: readonly PreservedInlineRange[],
): NormalizedInlineRange[] {
  const normalized = ranges
    .filter(
      (range) =>
        Number.isSafeInteger(range.from) &&
        Number.isSafeInteger(range.to) &&
        range.from >= contentOffset &&
        range.to > range.from &&
        range.to <= source.length,
    )
    .map((range) => ({
      from: range.from - contentOffset,
      to: range.to - contentOffset,
      source: source.slice(range.from, range.to),
    }))
    .sort((left, right) => left.from - right.from || left.to - right.to);

  const disjoint: NormalizedInlineRange[] = [];
  for (const range of normalized) {
    const previous = disjoint.at(-1);
    if (previous && range.from < previous.to) continue;
    disjoint.push(range);
  }
  return disjoint;
}

export function protectInlineSources(
  content: string,
  ranges: readonly NormalizedInlineRange[],
): { protectedContent: string; tokenPrefix: string; sources: string[] } {
  let tokenPrefix = "OLEAFLYXMATHSOURCE";
  while (content.includes(tokenPrefix)) tokenPrefix += "X";

  const sources: string[] = [];
  let protectedContent = "";
  let cursor = 0;
  for (const range of ranges) {
    protectedContent += content.slice(cursor, range.from);
    const index = sources.push(range.source) - 1;
    protectedContent += `${tokenPrefix}${index}X`;
    cursor = range.to;
  }
  protectedContent += content.slice(cursor);
  return { protectedContent, tokenPrefix, sources };
}

export function preservedInlineNode(source: string): JSONContent {
  return {
    type: splitMathSource(source) ? "mathInline" : "rawInline",
    attrs: { source },
  };
}

function expandTextNode(
  child: JSONContent,
  token: RegExp,
  sources: readonly string[],
): JSONContent[] {
  const text = child.text ?? "";
  const parts: JSONContent[] = [];
  let cursor = 0;
  let matched = false;
  for (const match of text.matchAll(token)) {
    if (match.index === undefined) continue;
    const preserved = sources[Number(match[1])];
    if (preserved === undefined) continue;
    matched = true;
    if (match.index > cursor) {
      parts.push({ ...child, text: text.slice(cursor, match.index) });
    }
    parts.push(preservedInlineNode(preserved));
    cursor = match.index + match[0].length;
  }
  if (!matched) return [child];
  if (cursor < text.length) parts.push({ ...child, text: text.slice(cursor) });
  return parts;
}

function restoreAttributes(
  attrs: Record<string, unknown>,
  token: RegExp,
  sources: readonly string[],
): Record<string, unknown> {
  const restored: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(attrs)) {
    restored[name] =
      typeof value === "string"
        ? value.replace(token, (match: string, index: string) => sources[Number(index)] ?? match)
        : value;
  }
  return restored;
}

function restoreNode(
  node: JSONContent,
  token: RegExp,
  sources: readonly string[],
): JSONContent {
  const base = node.attrs ? { ...node, attrs: restoreAttributes(node.attrs, token, sources) } : node;
  if (node.type === "text" || !node.content) return base;
  const content = node.content.flatMap((child) =>
    child.type === "text" && child.text
      ? expandTextNode(child, token, sources)
      : [restoreNode(child, token, sources)],
  );
  return { ...base, content };
}

export function restoreInlineSources(
  node: JSONContent,
  tokenPrefix: string,
  sources: readonly string[],
): JSONContent {
  const token = new RegExp(String.raw`${tokenPrefix}(\d+)X`, "gu");
  return restoreNode(node, token, sources);
}
