import {
  markdown,
  markdownLanguage as gfmMarkdownLanguage,
} from "@codemirror/lang-markdown";
import { styleTags } from "@lezer/highlight";
import type {
  InlineContext,
  MarkdownExtension,
} from "@lezer/markdown";
import { syntaxTags } from "./syntax-colors";

const DOLLAR = "$".codePointAt(0);
const AT = "@".codePointAt(0);
const CITATION_KEY =
  /^@(?:\{[^}\n]+\}|[\p{L}\p{N}_](?:[\p{L}\p{N}_]|[:.#$%&+?<>~/-](?=[\p{L}\p{N}_]))*)/u;
const KEY_CHARACTER = /[\p{L}\p{N}_]/u;
const OPEN_BRACKET = "[".codePointAt(0);
const CLOSE_BRACKET = "]".codePointAt(0);
const LINK_FOLLOWERS = new Set(["(", "[", ":"].map((character) => character.codePointAt(0)));
const GROUP_KEY_PREFIX = /[\s;-]/u;
const BACKSLASH = "\\".codePointAt(0);

const whitespace = (code: number): boolean =>
  code === 9 || code === 10 || code === 13 || code === 32;

function precedingBackslashCount(
  context: InlineContext,
  position: number,
): number {
  let count = 0;
  let cursor = position - 1;
  while (cursor >= context.offset && context.char(cursor) === BACKSLASH) {
    count += 1;
    cursor -= 1;
  }
  return count;
}

function pandocMathClose(
  context: InlineContext,
  contentStart: number,
  delimiterWidth: number,
): number {
  let cursor = contentStart;
  while (cursor + delimiterWidth <= context.end) {
    if (delimiterWidth === 1 && context.char(cursor) === 10) {
      return -1;
    }
    if (context.char(cursor) === BACKSLASH) {
      cursor += 2;
      continue;
    }
    const closes =
      context.char(cursor) === DOLLAR &&
      (delimiterWidth === 1 ||
        context.char(cursor + 1) === DOLLAR);
    if (
      closes &&
      !(delimiterWidth === 1 && whitespace(context.char(cursor - 1)))
    ) {
      return cursor;
    }
    cursor += 1;
  }
  return -1;
}

function parsePandocMath(
  context: InlineContext,
  next: number,
  position: number,
): number {
  if (next !== DOLLAR) return -1;
  if (precedingBackslashCount(context, position) % 2 === 1) return -1;

  const delimiterWidth =
    context.char(position + 1) === DOLLAR ? 2 : 1;
  const contentStart = position + delimiterWidth;
  if (
    contentStart >= context.end ||
    (delimiterWidth === 1 && whitespace(context.char(contentStart)))
  ) {
    return -1;
  }

  const close = pandocMathClose(context, contentStart, delimiterWidth);
  if (close < 0) return -1;

  const end = close + delimiterWidth;
  return context.addElement(
    context.elt("PandocMath", position, end, [
      context.elt(
        "PandocMathMark",
        position,
        position + delimiterWidth,
      ),
      context.elt(
        "PandocMathMark",
        close,
        end,
      ),
    ]),
  );
}

function parsePandocCitation(
  context: InlineContext,
  next: number,
  position: number,
): number {
  if (next !== AT) return -1;
  if (position > context.offset) {
    const previous = String.fromCodePoint(context.char(position - 1));
    if (KEY_CHARACTER.test(previous) || previous === "@" || previous === ".") return -1;
  }
  const match = CITATION_KEY.exec(context.slice(position, context.end));
  if (!match) return -1;
  return context.addElement(context.elt("PandocCitation", position, position + match[0].length));
}

function parsePandocCitationGroup(
  context: InlineContext,
  next: number,
  position: number,
): number {
  if (next !== OPEN_BRACKET) return -1;
  let close = position + 1;
  while (close < context.end && context.char(close) !== CLOSE_BRACKET) {
    if (context.char(close) === OPEN_BRACKET) return -1;
    close += 1;
  }
  if (close >= context.end || LINK_FOLLOWERS.has(context.char(close + 1))) return -1;
  const inner = context.slice(position + 1, close);
  const keys = [];
  for (let index = inner.indexOf("@"); index >= 0; index = inner.indexOf("@", index + 1)) {
    if (index > 0 && !GROUP_KEY_PREFIX.test(inner[index - 1])) continue;
    const match = CITATION_KEY.exec(inner.slice(index));
    if (!match) continue;
    const from = position + 1 + index;
    keys.push(context.elt("PandocCitation", from, from + match[0].length));
  }
  if (keys.length === 0) return -1;
  return context.addElement(context.elt("PandocCitationGroup", position, close + 1, keys));
}

const pandocMarkdownExtensions: MarkdownExtension = {
  defineNodes: [
    {
      name: "PandocMath",
      style: syntaxTags.math,
    },
    {
      name: "PandocMathMark",
      style: syntaxTags.math,
    },
    {
      name: "PandocCitation",
      style: syntaxTags.reference,
    },
    {
      name: "PandocCitationGroup",
    },
  ],
  parseInline: [
    {
      name: "PandocMath",
      parse: parsePandocMath,
      before: "Escape",
    },
    {
      name: "PandocCitationGroup",
      parse: parsePandocCitationGroup,
      before: "Link",
    },
    {
      name: "PandocCitation",
      parse: parsePandocCitation,
    },
  ],
  props: [
    styleTags({
      "EmphasisMark StrikethroughMark": syntaxTags.formatting,
    }),
  ],
};

/**
 * Oleafly compiles Pandoc Markdown rather than strict CommonMark. The GFM base
 * covers tables, task lists, and strikethrough, while the extension adds
 * Pandoc's dollar-delimited math without decorating escaped currency.
 */
export function markdownLanguage() {
  return markdown({
    base: gfmMarkdownLanguage,
    extensions: pandocMarkdownExtensions,
  });
}
