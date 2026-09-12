import { parse as parseLatexAst } from "@unified-latex/unified-latex-util-parse";
import { printRaw } from "@unified-latex/unified-latex-util-print-raw";
import type { JSONContent } from "@tiptap/core";
import type { Macro, Environment, Node as LatexNode } from "@unified-latex/unified-latex-types";
import {
  normalizePreservedRanges,
  protectInlineSources,
  restoreInlineSources,
  type PreservedInlineRange,
} from "../preserve-inline";

const HEADING_LEVEL: Record<string, number> = {
  section: 1,
  subsection: 2,
  subsubsection: 3,
};

const BLOCK_MACROS = new Set([
  "appendix",
  "author",
  "bibliography",
  "bibliographystyle",
  "date",
  "keywords",
  "maketitle",
  "tableofcontents",
  "title",
]);

const MARK_MACRO: Record<string, string> = {
  textbf: "bold",
  textit: "italic",
  underline: "underline",
  texttt: "code",
};

const ESCAPED_CHAR_MACRO: Record<string, string> = {
  "%": "%",
  "$": "$",
  "&": "&",
  "_": "_",
  "#": "#",
  "{": "{",
  "}": "}",
};

export interface ParseLatexBodyOptions {
  /**
   * Exact math ranges found in this body before unified-latex parsing. Keeping
   * them opaque prevents `$`/`$$`/`\(`/`\[` delimiter normalization.
   */
  preservedInlineRanges?: readonly PreservedInlineRange[];
}

function macroArgContent(node: Macro, index: number): LatexNode[] {
  const arg = node.args?.[index];
  return arg?.type === "argument" ? arg.content : [];
}

function astToText(nodes: LatexNode[]): string {
  return nodes
    .map((n) => {
      if (n.type === "string") return n.content;
      if (n.type === "whitespace") return " ";
      return "";
    })
    .join("");
}

function mergeAdjacentText(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const node of nodes) {
    const prev = out.at(-1);
    if (prev?.type === "text" && node.type === "text" && JSON.stringify(prev.marks ?? []) === JSON.stringify(node.marks ?? [])) {
      prev.text = (prev.text ?? "") + (node.text ?? "");
      continue;
    }
    out.push({ ...node });
  }
  return out;
}

function markedTextNode(text: string, marks: JSONContent["marks"]): JSONContent {
  return { type: "text", text, ...(marks?.length ? { marks } : {}) };
}

function markMacroArgumentIndex(node: Macro): number {
  return node.args && node.args.length > 1 ? node.args.length - 1 : 0;
}

function inlineMacroToJSON(node: Macro, marks: JSONContent["marks"] = []): JSONContent[] | null {
  if (node.content === "href") {
    const href = astToText(macroArgContent(node, 1));
    const text = astToText(macroArgContent(node, 2));
    return [{ type: "text", text, marks: [...(marks ?? []), { type: "link", attrs: { href } }] }];
  }
  if (node.content in MARK_MACRO) {
    const inner = macroArgContent(node, markMacroArgumentIndex(node));
    return inlineNodesToJSON(inner, [...(marks ?? []), { type: MARK_MACRO[node.content] }]);
  }
  if (node.content in ESCAPED_CHAR_MACRO) {
    return [markedTextNode(ESCAPED_CHAR_MACRO[node.content], marks)];
  }
  return null;
}

function inlineNodeToJSON(node: LatexNode, marks: JSONContent["marks"] = []): JSONContent[] | null {
  if (node.type === "string") return [markedTextNode(node.content, marks)];
  if (node.type === "whitespace") return [markedTextNode(" ", marks)];
  if (node.type === "macro") return inlineMacroToJSON(node, marks);
  return null;
}

function rawInlineRun(nodes: LatexNode[], start: number): { source: string; next: number } {
  let end = start;
  let source = printRawNode(nodes[end]);
  while (end + 1 < nodes.length && nodes[end + 1].type === "group") {
    end++;
    source += printRawNode(nodes[end]);
  }
  return { source, next: end + 1 };
}

function inlineNodesToJSON(nodes: LatexNode[], marks: JSONContent["marks"] = []): JSONContent[] {
  const out: JSONContent[] = [];
  let i = 0;
  while (i < nodes.length) {
    const mapped = inlineNodeToJSON(nodes[i], marks);
    if (mapped) {
      out.push(...mapped);
      i++;
      continue;
    }
    const run = rawInlineRun(nodes, i);
    out.push({ type: "rawInline", attrs: { source: run.source } });
    i = run.next;
  }
  return mergeAdjacentText(out);
}

function printRawNode(node: LatexNode): string {
  return printRaw(node);
}

function itemsOf(env: Environment): LatexNode[][] {
  const items: LatexNode[][] = [];
  let current: LatexNode[] | null = null;
  for (const node of env.content) {
    if (node.type === "whitespace" || node.type === "parbreak") continue;
    if (node.type === "macro" && node.content === "item") {
      current = [];
      items.push(current);
      const lastArg = node.args?.[node.args.length - 1];
      if (lastArg?.type === "argument") {
        const start = lastArg.content.findIndex((n) => n.type !== "whitespace");
        if (start !== -1) current.push(...lastArg.content.slice(start));
      }
      continue;
    }
    current?.push(node);
  }
  return items;
}

function environmentToJSON(env: Environment): JSONContent | null {
  if (env.env === "quote") {
    return { type: "blockquote", content: [{ type: "paragraph", content: inlineNodesToJSON(env.content.filter((n) => n.type !== "parbreak")) }] };
  }
  if (env.env === "itemize" || env.env === "enumerate") {
    return {
      type: env.env === "itemize" ? "bulletList" : "orderedList",
      content: itemsOf(env).map((itemNodes) => ({
        type: "listItem",
        content: [{ type: "paragraph", content: inlineNodesToJSON(itemNodes) }],
      })),
    };
  }
  return null;
}

function macroBlock(node: Macro): JSONContent | null {
  if (node.content in HEADING_LEVEL) {
    const titleNodes = macroArgContent(node, (node.args?.length ?? 1) - 1);
    return {
      type: "heading",
      attrs: { level: HEADING_LEVEL[node.content] },
      content: [{ type: "text", text: astToText(titleNodes) }],
    };
  }
  if (BLOCK_MACROS.has(node.content)) {
    return {
      type: "rawBlock",
      attrs: { source: printRawNode(node) },
    };
  }
  return null;
}

export function parseLatexBody(
  body: string,
  options: ParseLatexBodyOptions = {},
): JSONContent {
  const ranges = normalizePreservedRanges(
    body,
    0,
    options.preservedInlineRanges ?? [],
  );
  const { protectedContent, tokenPrefix, sources } = protectInlineSources(
    body,
    ranges,
  );
  const ast = parseLatexAst(protectedContent);
  const content: JSONContent[] = [];
  let paragraphBuffer: LatexNode[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    content.push({ type: "paragraph", content: inlineNodesToJSON(paragraphBuffer) });
    paragraphBuffer = [];
  };

  for (const node of ast.content) {
    if (node.type === "whitespace") {
      if (paragraphBuffer.length === 0) continue;
      paragraphBuffer.push(node);
      continue;
    }
    if (node.type === "parbreak") {
      flushParagraph();
      continue;
    }
    if (node.type === "comment") {
      flushParagraph();
      content.push({ type: "rawBlock", attrs: { source: printRawNode(node) } });
      continue;
    }
    if (node.type === "macro") {
      const block = macroBlock(node);
      if (block) {
        flushParagraph();
        content.push(block);
        continue;
      }
      paragraphBuffer.push(node);
      continue;
    }
    if (node.type === "environment") {
      flushParagraph();
      content.push(
        environmentToJSON(node) ?? { type: "rawBlock", attrs: { source: printRawNode(node) } },
      );
      continue;
    }
    paragraphBuffer.push(node);
  }
  flushParagraph();

  return restoreInlineSources(
    {
      type: "doc",
      content: content.length ? content : [{ type: "paragraph" }],
    },
    tokenPrefix,
    sources,
  );
}
