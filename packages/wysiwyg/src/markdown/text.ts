import { Node } from "@tiptap/core";
import type { MarkdownNodeSpec } from "tiptap-markdown";

const FOOTNOTE_REFERENCE = /\[\^[^\]\s[]+\]/uy;
const BRACKETED_CITATION = /\[(?:[^[\]\n]*?[\s;])?-?@[\p{L}\p{N}_][^[\]\n]*\]/uy;
const BARE_CITATION =
  /(?<![\p{L}\p{N}_.@\\])@[\p{L}\p{N}_](?:[\p{L}\p{N}_]|[:.#$%&+?~/-](?=[\p{L}\p{N}_]))*/uy;
const PANDOC_PATTERNS = [FOOTNOTE_REFERENCE, BRACKETED_CITATION, BARE_CITATION];

export function escapeMarkdownHtml(text: string): string {
  return text.replace(/<(?=[A-Za-z/!?])/gu, "&lt;");
}

function pandocMatchLength(text: string, index: number): number {
  if (text[index] !== "[" && text[index] !== "@") return 0;
  for (const pattern of PANDOC_PATTERNS) {
    pattern.lastIndex = index;
    const match = pattern.exec(text);
    if (match) return match[0].length;
  }
  return 0;
}

export function pandocTextRanges(text: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  let from = 0;
  while (from < text.length) {
    const length = pandocMatchLength(text, from);
    if (length === 0) {
      from++;
      continue;
    }
    const to = from + length;
    const next = text[to];
    if (text[from] !== "[" || (next !== "(" && next !== "[")) ranges.push({ from, to });
    from = to;
  }
  return ranges;
}

interface BlockStartState {
  atBlockStart: boolean;
}

export const MarkdownText = Node.create({
  name: "text",
  group: "inline",

  addStorage() {
    const markdown: MarkdownNodeSpec = {
      serialize(state, node) {
        const text = node.text ?? "";
        let cursor = 0;
        for (const range of pandocTextRanges(text)) {
          if (range.from > cursor) {
            state.text(escapeMarkdownHtml(text.slice(cursor, range.from)));
          }
          state.text(text.slice(range.from, range.to), false);
          (state as unknown as BlockStartState).atBlockStart = false;
          cursor = range.to;
        }
        if (cursor < text.length) {
          state.text(escapeMarkdownHtml(text.slice(cursor)));
        }
      },
    };
    return { markdown };
  },
});
