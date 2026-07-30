import {
  markdown,
  markdownLanguage as gfmMarkdownLanguage,
} from "@codemirror/lang-markdown";
import { tags } from "@lezer/highlight";
import type {
  InlineContext,
  MarkdownExtension,
} from "@lezer/markdown";

const DOLLAR = "$".charCodeAt(0);
const BACKSLASH = "\\".charCodeAt(0);

const whitespace = (code: number): boolean =>
  code === 9 || code === 10 || code === 13 || code === 32;

function parsePandocMath(
  context: InlineContext,
  next: number,
  position: number,
): number {
  if (next !== DOLLAR) return -1;

  let precedingBackslashes = 0;
  for (
    let cursor = position - 1;
    cursor >= context.offset && context.char(cursor) === BACKSLASH;
    cursor -= 1
  ) {
    precedingBackslashes += 1;
  }
  if (precedingBackslashes % 2 === 1) return -1;

  const delimiterWidth =
    context.char(position + 1) === DOLLAR ? 2 : 1;
  const contentStart = position + delimiterWidth;
  if (
    contentStart >= context.end ||
    (delimiterWidth === 1 && whitespace(context.char(contentStart)))
  ) {
    return -1;
  }

  for (
    let cursor = contentStart;
    cursor + delimiterWidth <= context.end;
    cursor += 1
  ) {
    if (delimiterWidth === 1 && context.char(cursor) === 10) {
      return -1;
    }
    if (context.char(cursor) === BACKSLASH) {
      cursor += 1;
      continue;
    }
    const closes =
      context.char(cursor) === DOLLAR &&
      (delimiterWidth === 1 ||
        context.char(cursor + 1) === DOLLAR);
    if (
      !closes ||
      (delimiterWidth === 1 &&
        whitespace(context.char(cursor - 1)))
    ) {
      continue;
    }

    const end = cursor + delimiterWidth;
    return context.addElement(
      context.elt("PandocMath", position, end, [
        context.elt(
          "PandocMathMark",
          position,
          position + delimiterWidth,
        ),
        context.elt(
          "PandocMathMark",
          cursor,
          end,
        ),
      ]),
    );
  }
  return -1;
}

const pandocMarkdownExtensions: MarkdownExtension = {
  defineNodes: [
    {
      name: "PandocMath",
      style: tags.special(tags.string),
    },
    {
      name: "PandocMathMark",
      style: tags.processingInstruction,
    },
  ],
  parseInline: [
    {
      name: "PandocMath",
      parse: parsePandocMath,
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
    extensions: pandocMarkdownExtensions,
  });
}
