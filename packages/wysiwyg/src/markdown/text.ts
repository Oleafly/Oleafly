import { Node } from "@tiptap/core";
import type { MarkdownNodeSpec } from "tiptap-markdown";

const PANDOC_TEXT =
  /\[\^[^\]\s[]+\]|\[(?:[^[\]\n]*?[\s;])?-?@[\p{L}\p{N}_][^[\]\n]*\]|(?<![\p{L}\p{N}_.@\\])@[\p{L}\p{N}_](?:[\p{L}\p{N}_]|[:.#$%&+?~/-](?=[\p{L}\p{N}_]))*/gu;

export function escapeMarkdownHtml(text: string): string {
  return text.replace(/<(?=[A-Za-z/!?])/gu, "&lt;");
}

export function pandocTextRanges(text: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (const match of text.matchAll(PANDOC_TEXT)) {
    const from = match.index;
    const to = from + match[0].length;
    const next = text[to];
    if (match[0].startsWith("[") && (next === "(" || next === "[")) continue;
    ranges.push({ from, to });
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
