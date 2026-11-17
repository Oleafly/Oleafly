import { Node } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownNodeSpec } from "tiptap-markdown";
import { guardInlineDelimiters } from "./inline-delimiters";
import { ATTRIBUTE_BLOCK } from "./pandoc-inline";

const FOOTNOTE_REFERENCE = /\[\^[^\]\s[]+\]/uy;
const BRACKETED_CITATION = /\[(?:[^[\]\n]*?[\s;])?-?@[\p{L}\p{N}_][^[\]\n]*\]/uy;
const BARE_CITATION =
  /(?<![\p{L}\p{N}_.@\\])@[\p{L}\p{N}_](?:[\p{L}\p{N}_]|[:.#$%&+?~/-](?=[\p{L}\p{N}_]))*/uy;
const WIKI_LINK = /!?\[\[[^[\]\n]+\]\]/uy;
const DOLLAR_MATH = /\$\$[^$]+?\$\$|\$(?![\s$])[^$\n]*?(?<![\s\\])\$(?!\d)/uy;
const PANDOC_SPAN = new RegExp(String.raw`\[[^[\]\n*_~\x60\\<$^]*\]` + ATTRIBUTE_BLOCK.source.slice(1), "uy");
const VERBATIM_PATTERNS = [WIKI_LINK, FOOTNOTE_REFERENCE, BRACKETED_CITATION, BARE_CITATION, DOLLAR_MATH, PANDOC_SPAN];
const VERBATIM_STARTS = new Set(["[", "@", "!", "$"]);
const PANDOC_SPACE = /[ \t\r\n]/u;
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
  if (!VERBATIM_STARTS.has(text[index])) return 0;
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

interface CaretRun {
  parent: ProseMirrorNode;
  index: number;
  open: boolean;
}

const caretRuns = new WeakMap<object, CaretRun>();

function caretOpenAfter(written: string, open: boolean): boolean {
  let caret = open;
  for (let at = 0; at < written.length; at++) {
    if (written[at] === "\\") at++;
    else if (PANDOC_SPACE.test(written[at])) caret = false;
    else if (written[at] === "^") caret = true;
  }
  return caret;
}

function caretOpenBefore(state: object, parent: ProseMirrorNode, index: number): boolean {
  const run = caretRuns.get(state);
  if (run?.parent !== parent || run.index >= index) return false;
  for (let at = run.index + 1; at < index; at++) {
    const sibling = parent.child(at);
    if (sibling.type.name === "hardBreak" || PANDOC_SPACE.test(String(sibling.attrs.source ?? ""))) return false;
  }
  return run.open;
}

export const MarkdownText = Node.create({
  name: "text",
  group: "inline",

  addStorage() {
    const markdown: MarkdownNodeSpec = {
      serialize(state, node, parent, index) {
        guardInlineDelimiters(state);
        const text = node.text ?? "";
        const block = state as unknown as BlockStartState;
        const marker = block.atBlockStart ? unmodeledMarker(text, block.nodes) : 0;
        let open = caretOpenBefore(state, parent, index);
        const emit = (piece: string, escape: boolean) => {
          if (piece === "") return;
          state.text(piece, escape);
          block.atBlockStart = false;
          open = escape ? open && !PANDOC_SPACE.test(piece) : caretOpenAfter(piece, open);
        };
        const write = (from: number, to: number) => {
          let cursor = from;
          for (let caret = text.indexOf("^", from); caret >= 0 && caret < to; caret = text.indexOf("^", caret + 1)) {
            emit(escapeMarkdownHtml(text.slice(cursor, caret)), true);
            emit(open ? "\\^" : "^", false);
            cursor = caret + 1;
          }
          emit(escapeMarkdownHtml(text.slice(cursor, to)), true);
        };
        let cursor = 0;
        for (const range of verbatimTextRanges(text, marker)) {
          write(cursor, range.from);
          emit(text.slice(range.from, range.to), false);
          cursor = range.to;
        }
        write(cursor, text.length);
        caretRuns.set(state, { parent, index, open });
      },
    };
    return { markdown };
  },
});
