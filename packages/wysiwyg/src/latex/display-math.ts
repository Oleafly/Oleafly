import type { JSONContent } from "@tiptap/core";
import { isDisplayMathSource } from "../math/source";

const BLOCK_PARENTS = new Set(["doc", "blockquote", "listItem", "theorem", "tableCell", "tableHeader"]);
const LEADING_PARAGRAPH_PARENTS = new Set(["listItem"]);

function isDisplayMathInline(node: JSONContent): boolean {
  return node.type === "mathInline" && isDisplayMathSource(String(node.attrs?.source ?? ""));
}

function trimEdge(nodes: JSONContent[], edge: "start" | "end"): JSONContent[] {
  const index = edge === "start" ? 0 : nodes.length - 1;
  const node = nodes[index];
  if (node?.type !== "text" || typeof node.text !== "string") return nodes;
  const text = edge === "start" ? node.text.trimStart() : node.text.trimEnd();
  const rest = edge === "start" ? nodes.slice(1) : nodes.slice(0, -1);
  if (text === "") return rest;
  const trimmed = { ...node, text };
  return edge === "start" ? [trimmed, ...rest] : [...rest, trimmed];
}

function isBlankParagraph(paragraph: JSONContent): boolean {
  return (paragraph.content ?? []).every((child) => child.type === "text" && !(child.text ?? "").trim());
}

function splitParagraph(paragraph: JSONContent): JSONContent[] {
  const children = paragraph.content ?? [];
  if (!children.some(isDisplayMathInline)) return [paragraph];
  const pieces: JSONContent[] = [];
  let run: JSONContent[] = [];
  const flush = () => {
    const content = trimEdge(trimEdge(run, "start"), "end");
    const piece = { ...paragraph, content };
    if (!isBlankParagraph(piece)) pieces.push(piece);
    run = [];
  };
  for (const child of children) {
    if (!isDisplayMathInline(child)) {
      run.push(child);
      continue;
    }
    flush();
    pieces.push({ type: "mathDisplay", attrs: { source: child.attrs?.source } });
  }
  flush();
  return pieces;
}

export function normalizeDisplayMath(node: JSONContent): JSONContent {
  if (!node.content) return node;
  const children = node.content.map(normalizeDisplayMath);
  if (!BLOCK_PARENTS.has(node.type ?? "")) return { ...node, content: children };
  const content = children.flatMap((child) => (child.type === "paragraph" ? splitParagraph(child) : [child]));
  if (LEADING_PARAGRAPH_PARENTS.has(node.type ?? "") && content[0]?.type !== "paragraph") {
    content.unshift({ type: "paragraph" });
  }
  return { ...node, content };
}
