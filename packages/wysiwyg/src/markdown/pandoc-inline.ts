import { Extension } from "@tiptap/core";
import type { MarkdownNodeSpec } from "tiptap-markdown";

type MarkdownIt = Parameters<NonNullable<NonNullable<MarkdownNodeSpec["parse"]>["setup"]>>[0];
type InlineRule = Parameters<MarkdownIt["inline"]["ruler"]["before"]>[2];
type InlineState = Parameters<InlineRule>[0];

const SPAN_CLASSES: Readonly<Record<string, string>> = { underline: "u", mark: "mark" };
const SPAN_ATTRIBUTES = /^\{\s*\.(underline|mark)\s*\}/u;
export const ATTRIBUTE_BLOCK = /^\{\s*(?:(?:[.#][^\s{}]+|[\w-]+=(?:"[^"]*"|'[^']*'|[^\s{}"']*)|-)\s*)*\}/u;
const UNESCAPED_SPACE = /(^|[^\\])(\\\\)*[ \t\r\n]/u;
const withPandoc = new WeakSet<MarkdownIt>();
const lastClosers = new WeakMap<InlineState, { posMax: number; at: number }>();

function wrapInline(state: InlineState, tag: string, from: number, to: number, markup = ""): number {
  const max = state.posMax;
  state.push(`${tag}_open`, tag, 1).markup = markup;
  const first = state.tokens.length;
  state.pos = from;
  state.posMax = to;
  state.md.inline.tokenize(state);
  state.posMax = max;
  state.push(`${tag}_close`, tag, -1).markup = markup;
  return first;
}

function nonBreakingEscapedSpaces(tokens: InlineState["tokens"], from: number): void {
  for (let index = from; index < tokens.length - 1; index++) {
    if (tokens[index].info !== "escape" || tokens[index].markup !== "\\") continue;
    tokens[index].content = "\u00a0";
    tokens[index + 1].content = tokens[index + 1].content.slice(1);
  }
}

function scriptRule(marker: number, tag: "sup" | "sub"): InlineRule {
  return (state: InlineState, silent: boolean) => {
    const start = state.pos;
    const max = state.posMax;
    if (silent || state.src.charCodeAt(start) !== marker || start + 2 >= max) return false;
    if (marker === 0x7e && state.src.charCodeAt(start + 1) === 0x7e) return false;
    state.pos = start + 1;
    while (state.pos < max && state.src.charCodeAt(state.pos) !== marker) state.md.inline.skipToken(state);
    const end = state.pos;
    if (end >= max || end === start + 1 || UNESCAPED_SPACE.test(state.src.slice(start + 1, end))) {
      state.pos = start;
      return false;
    }
    nonBreakingEscapedSpaces(state.tokens, wrapInline(state, tag, start + 1, end, String.fromCharCode(marker)));
    state.pos = end + 1;
    return true;
  };
}

const bracketedSpan: InlineRule = (state: InlineState, silent: boolean) => {
  const start = state.pos;
  if (silent || state.src.charCodeAt(start) !== 0x5b) return false;
  const end = state.md.helpers.parseLinkLabel(state, start);
  if (end < 0) return false;
  const attributes = SPAN_ATTRIBUTES.exec(state.src.slice(end + 1, state.posMax));
  if (!attributes) return false;
  wrapInline(state, SPAN_CLASSES[attributes[1]], start + 1, end);
  state.pos = end + 1 + attributes[0].length;
  return true;
};

function lastCloser(state: InlineState): number {
  let last = lastClosers.get(state);
  if (last?.posMax !== state.posMax) {
    last = { posMax: state.posMax, at: state.src.lastIndexOf("]", state.posMax - 1) };
    lastClosers.set(state, last);
  }
  return last.at;
}

const inlineNote: InlineRule = (state: InlineState, silent: boolean) => {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x5e || state.src.charCodeAt(start + 1) !== 0x5b || lastCloser(state) <= start) return false;
  const end = state.md.helpers.parseLinkLabel(state, start + 1);
  if (end < 0) return false;
  const next = state.src.charCodeAt(end + 1);
  if (next === 0x28 || next === 0x5b || (next === 0x7b && ATTRIBUTE_BLOCK.test(state.src.slice(end + 1, state.posMax)))) return false;
  if (!silent) state.push("pandoc_note", "sup", 0).content = state.src.slice(start + 2, end);
  state.pos = end + 1;
  return true;
};

function setupPandocInline(md: MarkdownIt): void {
  if (withPandoc.has(md)) return;
  withPandoc.add(md);
  md.inline.ruler.before("link", "pandoc_span", bracketedSpan);
  md.inline.ruler.after("emphasis", "pandoc_superscript", scriptRule(0x5e, "sup"));
  md.inline.ruler.after("emphasis", "pandoc_subscript", scriptRule(0x7e, "sub"));
  md.inline.ruler.before("pandoc_superscript", "pandoc_note", inlineNote);
  md.renderer.rules.pandoc_note = (tokens, index) =>
    `<sup data-type="footnote" source="${md.utils.escapeHtml(tokens[index].content)}"></sup>`;
}

export const PandocInline = Extension.create({
  name: "pandocInline",

  addStorage() {
    return { markdown: { parse: { setup: setupPandocInline } } };
  },
});
