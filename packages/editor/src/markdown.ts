import {
  markdown,
  markdownLanguage as gfmMarkdownLanguage,
} from "@codemirror/lang-markdown";
import { StreamLanguage } from "@codemirror/language";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { parseMixed } from "@lezer/common";
import { styleTags, tags as t } from "@lezer/highlight";
import type {
  BlockContext,
  Element,
  InlineContext,
  Line,
  MarkdownExtension,
} from "@lezer/markdown";
import { codeChunkLanguage } from "./code-chunks";
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
const OPEN_BRACE = "{".codePointAt(0);
const LESS_THAN = "<".codePointAt(0);
const SHORTCODE_CLOSE = ">}}";
const FRONT_MATTER_OPEN = /^---[ \t]*$/u;
const FRONT_MATTER_CLOSE = /^(?:---|\.\.\.)[ \t]*$/u;
const yamlParser = StreamLanguage.define(yaml).parser;

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

function frontMatterEnd(cx: BlockContext, line: Line, marks: Element[]): number {
  let contentFrom = -1;
  let contentTo = -1;
  const addContent = () => {
    if (contentTo > contentFrom) marks.push(cx.elt("FrontMatterContent", contentFrom, contentTo));
  };
  while (cx.nextLine()) {
    if (FRONT_MATTER_CLOSE.test(line.text)) {
      addContent();
      marks.push(cx.elt("FrontMatterMark", cx.lineStart, cx.lineStart + 3));
      const end = cx.lineStart + line.text.length;
      cx.nextLine();
      return end;
    }
    if (contentFrom < 0) contentFrom = cx.lineStart;
    if (line.text.trim()) contentTo = cx.lineStart + line.text.length;
  }
  addContent();
  return Math.max(3, contentTo);
}

function parseFrontMatter(cx: BlockContext, line: Line): boolean {
  if (cx.lineStart !== 0 || !FRONT_MATTER_OPEN.test(line.text) || !cx.peekLine().trim()) {
    return false;
  }
  const marks = [cx.elt("FrontMatterMark", 0, 3)];
  const end = frontMatterEnd(cx, line, marks);
  cx.addElement(cx.elt("FrontMatter", 0, end, marks));
  return true;
}

const pandocFrontMatter: MarkdownExtension = {
  defineNodes: [
    { name: "FrontMatter", block: true },
    { name: "FrontMatterMark", style: syntaxTags.formatting },
    { name: "FrontMatterContent" },
  ],
  parseBlock: [
    {
      name: "FrontMatter",
      parse: parseFrontMatter,
      before: "HorizontalRule",
    },
  ],
  wrap: parseMixed((node) =>
    node.name === "FrontMatter"
      ? { parser: yamlParser, overlay: (child) => child.name === "FrontMatterContent" }
      : null,
  ),
};

function parseQuartoShortcode(
  context: InlineContext,
  next: number,
  position: number,
): number {
  if (
    next !== OPEN_BRACE ||
    context.char(position + 1) !== OPEN_BRACE ||
    context.char(position + 2) !== LESS_THAN
  ) {
    return -1;
  }
  const close = context.slice(position, context.end).indexOf(SHORTCODE_CLOSE);
  if (close < 0) return -1;
  return context.addElement(
    context.elt("QuartoShortcode", position, position + close + SHORTCODE_CLOSE.length),
  );
}

const quartoShortcodes: MarkdownExtension = {
  defineNodes: [{ name: "QuartoShortcode", style: t.meta }],
  parseInline: [
    {
      name: "QuartoShortcode",
      parse: parseQuartoShortcode,
      before: "Escape",
    },
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
    extensions: [pandocMarkdownExtensions, pandocFrontMatter],
    codeLanguages: codeChunkLanguage,
  });
}

export function quartoLanguage() {
  return markdown({
    base: gfmMarkdownLanguage,
    extensions: [pandocMarkdownExtensions, pandocFrontMatter, quartoShortcodes],
    codeLanguages: codeChunkLanguage,
  });
}
