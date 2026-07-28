import type { JSONContent } from "@tiptap/core";

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
    const previous = disjoint[disjoint.length - 1];
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

export function restoreInlineSources(
  node: JSONContent,
  tokenPrefix: string,
  sources: readonly string[],
): JSONContent {
  if (
    (node.type === "rawInline" || node.type === "rawBlock") &&
    typeof node.attrs?.source === "string"
  ) {
    const token = new RegExp(`${tokenPrefix}(\\d+)X`, "gu");
    return {
      ...node,
      attrs: {
        ...node.attrs,
        source: node.attrs.source.replace(token, (_match: string, index: string) => {
          const preserved = sources[Number(index)];
          return preserved ?? _match;
        }),
      },
    };
  }
  if (node.type === "text" && node.text) return node;
  if (!node.content) return node;

  const token = new RegExp(`${tokenPrefix}(\\d+)X`, "gu");
  const content: JSONContent[] = [];
  for (const child of node.content) {
    if (child.type !== "text" || !child.text) {
      content.push(restoreInlineSources(child, tokenPrefix, sources));
      continue;
    }

    let cursor = 0;
    let matched = false;
    for (const match of child.text.matchAll(token)) {
      if (match.index === undefined) continue;
      const sourceIndex = Number(match[1]);
      const preserved = sources[sourceIndex];
      if (preserved === undefined) continue;
      matched = true;
      if (match.index > cursor) {
        content.push({
          ...child,
          text: child.text.slice(cursor, match.index),
        });
      }
      content.push({
        type: "rawInline",
        attrs: { source: preserved },
      });
      cursor = match.index + match[0].length;
    }
    if (!matched) {
      content.push(child);
    } else if (cursor < child.text.length) {
      content.push({ ...child, text: child.text.slice(cursor) });
    }
  }
  return { ...node, content };
}
