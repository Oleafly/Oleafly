import { parse as parseLatexAst } from "@unified-latex/unified-latex-util-parse";
import type { JSONContent } from "@tiptap/core";
import { inlineNodesToJSON, type ParseContext } from "./parse-inline";

export function parseInlineSource(source: string, context: ParseContext): JSONContent[] {
  return inlineNodesToJSON(parseLatexAst(source).content, { ...context, source });
}

export function paragraphOf(content: JSONContent[]): JSONContent {
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}
