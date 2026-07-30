import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { WYSIWYG_EXTENSIONS } from "../schema";
import {
  normalizePreservedRanges,
  protectInlineSources,
  restoreInlineSources,
  type PreservedInlineRange,
} from "../preserve-inline";

const FRONTMATTER_RE = /^(---\r?\n[\s\S]*?\r?\n---)\r?\n?/;

export type PreservedMarkdownInlineRange = PreservedInlineRange;

export interface ParseMarkdownBodyOptions {
  /**
   * Absolute source ranges that Markdown must not consume or normalize. The
   * caller uses this for exact math delimiters after syntax-aware scanning.
   */
  preservedInlineRanges?: readonly PreservedMarkdownInlineRange[];
}

export function parseMarkdownBody(
  source: string,
  options: ParseMarkdownBodyOptions = {},
): { doc: JSONContent; frontmatter: string } {
  const match = FRONTMATTER_RE.exec(source);
  const frontmatter = match ? match[1] : "";
  const body = match ? source.slice(match[0].length) : source;
  const bodyOffset = match?.[0].length ?? 0;
  const ranges = normalizePreservedRanges(
    source,
    bodyOffset,
    options.preservedInlineRanges ?? [],
  );
  const { protectedContent, tokenPrefix, sources } = protectInlineSources(
    body,
    ranges,
  );

  const editor = new Editor({
    element: document.createElement("div"),
    extensions: WYSIWYG_EXTENSIONS,
    content: "",
  });
  editor.commands.setContent(protectedContent);
  const doc = restoreInlineSources(editor.getJSON(), tokenPrefix, sources);
  editor.destroy();

  return { doc, frontmatter };
}
