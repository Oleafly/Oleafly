import type { JSONContent } from "@tiptap/core";
import { headingCommandForLevel, headingLevelForCommand, isSectioningCommand } from "./sectioning";
import { figureToLatex } from "./serialize-figure";
import { hasInlineLatexSerialization, hasMarkLatexSerialization, inlineToLatex } from "./serialize-inline";
import { bareTableToLatex, tableFloatToLatex } from "./serialize-table";
import { unknownNodeToLatex } from "./serialize-unknown";

function indentLines(text: string, indent: string): string {
  return text
    .split("\n")
    .map((line) => (line.length ? `${indent}${line}` : line))
    .join("\n");
}

function headingCommand(attrs: Record<string, unknown>): string {
  const level = Number(attrs.level ?? 1);
  const command = attrs.command;
  if (typeof command === "string" && isSectioningCommand(command) && headingLevelForCommand(command) === level) {
    return command;
  }
  return headingCommandForLevel(level);
}

function headingToLatex(node: JSONContent): string {
  const attrs = node.attrs ?? {};
  const star = attrs.starred === true ? "*" : "";
  const shortTitle = typeof attrs.shortTitle === "string" ? `[${attrs.shortTitle}]` : "";
  return `\\${headingCommand(attrs)}${star}${shortTitle}{${inlineToLatex(node.content)}}`;
}

function listItemToLatex(item: JSONContent): string {
  const [first, ...rest] = item.content ?? [];
  const lead = first?.type === "paragraph" ? inlineToLatex(first.content) : "";
  const trailing = first && first.type !== "paragraph" ? [first, ...rest] : rest;
  const lines = [String.raw`  \item ${lead}`];
  for (const block of trailing) {
    const text = blockToLatex(block);
    if (text.length) lines.push(indentLines(text, "  "));
  }
  return lines.join("\n");
}

function listToLatex(node: JSONContent, environment: string): string {
  const items = (node.content ?? []).map(listItemToLatex).join("\n");
  return `\\begin{${environment}}\n${items}\n\\end{${environment}}`;
}

function theoremToLatex(node: JSONContent): string {
  const attrs = node.attrs ?? {};
  const environment = String(attrs.environment ?? "theorem");
  const title = typeof attrs.title === "string" ? `[${attrs.title}]` : "";
  const body = blocksToLatex(node.content ?? []);
  return `\\begin{${environment}}${title}\n${body}\n\\end{${environment}}`;
}

function sourceOf(node: JSONContent): string {
  return String(node.attrs?.source ?? "");
}

const BLOCK_HANDLERS: Record<string, (node: JSONContent) => string> = {
  heading: headingToLatex,
  paragraph: (node) => inlineToLatex(node.content),
  blockquote: (node) => `\\begin{quote}\n${(node.content ?? []).map(blockToLatex).join("\n")}\n\\end{quote}`,
  bulletList: (node) => listToLatex(node, "itemize"),
  orderedList: (node) => listToLatex(node, "enumerate"),
  listItem: listItemToLatex,
  rawBlock: sourceOf,
  mathDisplay: sourceOf,
  theorem: theoremToLatex,
  figure: figureToLatex,
  figureCaption: (node) => String.raw`\caption{${inlineToLatex(node.content)}}`,
  tableFloat: (node) => tableFloatToLatex(node, blockToLatex),
  tableCaption: (node) => String.raw`\caption{${inlineToLatex(node.content)}}`,
  table: (node) => bareTableToLatex(node, blockToLatex),
  tableRow: (node) => (node.content ?? []).map(blockToLatex).join(" & "),
  tableCell: (node) => (node.content ?? []).map(blockToLatex).join(" "),
  tableHeader: (node) => (node.content ?? []).map(blockToLatex).join(" "),
  image: (node) => String.raw`\includegraphics{${String(node.attrs?.src ?? "")}}`,
  doc: (node) => blocksToLatex(node.content ?? []),
};

export function hasLatexSerialization(type: string): boolean {
  return Object.hasOwn(BLOCK_HANDLERS, type) || hasInlineLatexSerialization(type);
}

export function hasLatexMarkSerialization(type: string): boolean {
  return hasMarkLatexSerialization(type);
}

export function blockToLatex(node: JSONContent): string {
  const type = node.type ?? "";
  if (Object.hasOwn(BLOCK_HANDLERS, type)) return BLOCK_HANDLERS[type](node);
  if (hasInlineLatexSerialization(type)) return inlineToLatex([node]);
  return unknownNodeToLatex(node);
}

function blocksToLatex(blocks: JSONContent[]): string {
  return blocks.map(blockToLatex).filter((text) => text.length > 0).join("\n\n");
}

export function serializeLatexBody(doc: JSONContent): string {
  return `${blocksToLatex(doc.content ?? [])}\n`;
}
