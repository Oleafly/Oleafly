import { parse as parseLatexAst } from "@unified-latex/unified-latex-util-parse";
import { printRaw } from "@unified-latex/unified-latex-util-print-raw";
import type { JSONContent } from "@tiptap/core";
import type { Macro, Environment, Node as LatexNode } from "@unified-latex/unified-latex-types";

const HEADING_LEVEL: Record<string, number> = {
  section: 1,
  subsection: 2,
  subsubsection: 3,
};

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

function macroArgContent(node: Macro, index: number): LatexNode[] {
  const arg = node.args?.[index];
  return arg && arg.type === "argument" ? arg.content : [];
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
    const prev = out[out.length - 1];
    if (prev && prev.type === "text" && node.type === "text" && JSON.stringify(prev.marks ?? []) === JSON.stringify(node.marks ?? [])) {
      prev.text = (prev.text ?? "") + (node.text ?? "");
      continue;
    }
    out.push({ ...node });
  }
  return out;
}

function inlineNodesToJSON(nodes: LatexNode[], marks: JSONContent["marks"] = []): JSONContent[] {
  const out: JSONContent[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type === "string") {
      out.push({ type: "text", text: node.content, ...(marks.length ? { marks } : {}) });
    } else if (node.type === "whitespace") {
      out.push({ type: "text", text: " ", ...(marks.length ? { marks } : {}) });
    } else if (node.type === "macro" && node.content === "href") {
      const href = astToText(macroArgContent(node, 1));
      const text = astToText(macroArgContent(node, 2));
      out.push({ type: "text", text, marks: [...marks, { type: "link", attrs: { href } }] });
    } else if (node.type === "macro" && node.content in MARK_MACRO) {
      const inner = macroArgContent(node, node.args && node.args.length > 1 ? node.args.length - 1 : 0);
      out.push(...inlineNodesToJSON(inner, [...marks, { type: MARK_MACRO[node.content] }]));
    } else if (node.type === "macro" && node.content in ESCAPED_CHAR_MACRO) {
      out.push({ type: "text", text: ESCAPED_CHAR_MACRO[node.content], ...(marks.length ? { marks } : {}) });
    } else {
      let end = i;
      let source = printRawNode(nodes[end]);
      while (end + 1 < nodes.length && nodes[end + 1].type === "group") {
        end++;
        source += printRawNode(nodes[end]);
      }
      i = end;
      out.push({ type: "rawInline", attrs: { source } });
    }
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
      if (lastArg && lastArg.type === "argument") {
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

export function parseLatexBody(body: string): JSONContent {
  const ast = parseLatexAst(body);
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
      if (node.content in HEADING_LEVEL) {
        flushParagraph();
        const titleNodes = macroArgContent(node, (node.args?.length ?? 1) - 1);
        content.push({
          type: "heading",
          attrs: { level: HEADING_LEVEL[node.content] },
          content: [{ type: "text", text: astToText(titleNodes) }],
        });
        continue;
      }
      paragraphBuffer.push(node);
      continue;
    }
    if (node.type === "environment") {
      flushParagraph();
      const mapped = environmentToJSON(node);
      if (mapped) {
        content.push(mapped);
        continue;
      }
      content.push({ type: "rawBlock", attrs: { source: printRawNode(node) } });
      continue;
    }
    paragraphBuffer.push(node);
  }
  flushParagraph();

  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
