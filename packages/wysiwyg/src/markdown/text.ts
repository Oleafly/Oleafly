import { Node } from "@tiptap/core";
import type { MarkdownNodeSpec } from "tiptap-markdown";

const FOOTNOTE_REFERENCE = /\[\^[^\]\s[]+\]/uy;
const BRACKETED_CITATION = /\[(?:[^[\]\n]*?[\s;])?-?@[\p{L}\p{N}_][^[\]\n]*\]/uy;
const BARE_CITATION =
  /(?<![\p{L}\p{N}_.@\\])@[\p{L}\p{N}_](?:[\p{L}\p{N}_]|[:.#$%&+?~/-](?=[\p{L}\p{N}_]))*/uy;
const WIKI_LINK = /!?\[\[[^[\]\n]+\]\]/uy;
const VERBATIM_PATTERNS = [WIKI_LINK, FOOTNOTE_REFERENCE, BRACKETED_CITATION, BARE_CITATION];
const BLOCK_MARKERS: [node: string, marker: RegExp][] = [
  ["taskItem", /^\[[ xX]\](?=[ \t]|$)/u],
  ["callout", /^\[![\w-]+\][+-]?(?=[ \t]|$)/u],
];

function unmodeledMarker(text: string, nodes: Record<string, unknown>): number {
  for (const [node, marker] of BLOCK_MARKERS) {
    const length = node in nodes ? 0 : (marker.exec(text)?.[0].length ?? 0);
    if (length) return length;
  }
  return 0;
}

export function escapeMarkdownHtml(text: string): string {
  return text.replace(/<(?=[A-Za-z/!?])/gu, "&lt;");
}

function verbatimMatchLength(text: string, index: number): number {
  if (text[index] !== "[" && text[index] !== "@" && text[index] !== "!") return 0;
  for (const pattern of VERBATIM_PATTERNS) {
    pattern.lastIndex = index;
    const match = pattern.exec(text);
    if (match) return match[0].length;
  }
  return 0;
}

function verbatimTextRanges(text: string, marker: number): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = marker ? [{ from: 0, to: marker }] : [];
  let from = marker;
  while (from < text.length) {
    const length = verbatimMatchLength(text, from);
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
  nodes: Record<string, unknown>;
}

export const MarkdownText = Node.create({
  name: "text",
  group: "inline",

  addStorage() {
    const markdown: MarkdownNodeSpec = {
      serialize(state, node) {
        const text = node.text ?? "";
        const block = state as unknown as BlockStartState;
        const marker = block.atBlockStart ? unmodeledMarker(text, block.nodes) : 0;
        let cursor = 0;
        for (const range of verbatimTextRanges(text, marker)) {
          if (range.from > cursor) {
            state.text(escapeMarkdownHtml(text.slice(cursor, range.from)));
          }
          state.text(text.slice(range.from, range.to), false);
          block.atBlockStart = false;
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
