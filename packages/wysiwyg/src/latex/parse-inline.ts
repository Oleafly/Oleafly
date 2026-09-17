import { printRaw } from "@unified-latex/unified-latex-util-print-raw";
import type { JSONContent } from "@tiptap/core";
import type { Macro, Node as LatexNode } from "@unified-latex/unified-latex-types";
import { scanMacroArguments } from "./arguments";

export interface ParseContext {
  source: string;
  theoremEnvironments: ReadonlySet<string>;
}

export interface MacroArguments {
  starred: boolean;
  optional: string | null;
  mandatory: string[];
}

const MARK_MACRO: Record<string, string> = {
  textbf: "bold",
  textit: "italic",
  underline: "underline",
  texttt: "code",
};

const COLOR_MACRO: Record<string, string> = {
  textcolor: "textColor",
  colorbox: "colorBox",
};

const ESCAPED_CHAR_MACRO: Record<string, string> = {
  "%": "%",
  $: "$",
  "&": "&",
  _: "_",
  "#": "#",
  "{": "{",
  "}": "}",
};

export function printRawNode(node: LatexNode): string {
  return printRaw(node);
}

export function exactSource(node: LatexNode, context: ParseContext): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return printRawNode(node);
  return context.source.slice(start, end);
}

export function macroArgContent(node: Macro, index: number): LatexNode[] {
  const arg = node.args?.[index];
  return arg?.type === "argument" ? arg.content : [];
}

function astArguments(node: Macro): MacroArguments {
  const result: MacroArguments = { starred: false, optional: null, mandatory: [] };
  for (const arg of node.args ?? []) {
    const value = printRaw(arg.content);
    if (arg.openMark === "[") result.optional = value;
    else if (arg.openMark === "{") result.mandatory.push(value);
    else if (value === "*") result.starred = true;
  }
  return result;
}

function comparable(value: string): string {
  return value.replace(/[{}\s]+/gu, "");
}

export function macroArguments(node: Macro, context: ParseContext): MacroArguments {
  const fromAst = astArguments(node);
  const end = node.position?.end.offset;
  if (end === undefined) return fromAst;
  const scanned = scanMacroArguments(context.source, end);
  const mandatory = scanned.args.filter((arg) => arg.kind === "mandatory").map((arg) => arg.value);
  const optional = scanned.args.find((arg) => arg.kind === "optional")?.value ?? null;
  const consistent =
    mandatory.length === fromAst.mandatory.length &&
    (optional === null) === (fromAst.optional === null) &&
    mandatory.every((value, index) => comparable(value) === comparable(fromAst.mandatory[index]));
  if (!consistent) return fromAst;
  return { starred: scanned.starred || fromAst.starred, optional, mandatory };
}

export function astToText(nodes: LatexNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "string") return node.content;
      if (node.type === "whitespace") return " ";
      return "";
    })
    .join("");
}

function mergeAdjacentText(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const node of nodes) {
    const previous = out.at(-1);
    if (
      previous?.type === "text" &&
      node.type === "text" &&
      JSON.stringify(previous.marks ?? []) === JSON.stringify(node.marks ?? [])
    ) {
      previous.text = (previous.text ?? "") + (node.text ?? "");
      continue;
    }
    out.push({ ...node });
  }
  return out;
}

function markedTextNode(text: string, marks: JSONContent["marks"]): JSONContent {
  return { type: "text", text, ...(marks?.length ? { marks } : {}) };
}

function lastArgumentIndex(node: Macro): number {
  return node.args && node.args.length > 1 ? node.args.length - 1 : 0;
}

function footnoteNode(node: Macro, context: ParseContext): JSONContent[] | null {
  const args = macroArguments(node, context);
  if (args.optional !== null || args.mandatory.length !== 1) return null;
  return [{ type: "footnote", attrs: { source: args.mandatory[0] } }];
}

function coloredInline(
  node: Macro,
  context: ParseContext,
  marks: JSONContent["marks"],
  markType: string,
): JSONContent[] | null {
  const args = macroArguments(node, context);
  if (args.mandatory.length !== 2) return null;
  const color = args.optional === null ? args.mandatory[0] : `[${args.optional}]{${args.mandatory[0]}}`;
  const inner = macroArgContent(node, lastArgumentIndex(node));
  if (inner.length === 0) return null;
  return inlineNodesToJSON(inner, context, [...(marks ?? []), { type: markType, attrs: { color } }]);
}

function inlineMacroToJSON(
  node: Macro,
  context: ParseContext,
  marks: JSONContent["marks"] = [],
): JSONContent[] | null {
  if (node.content === "href") {
    const href = astToText(macroArgContent(node, 1));
    const text = astToText(macroArgContent(node, 2));
    return [{ type: "text", text, marks: [...(marks ?? []), { type: "link", attrs: { href } }] }];
  }
  if (node.content in MARK_MACRO) {
    const inner = macroArgContent(node, lastArgumentIndex(node));
    return inlineNodesToJSON(inner, context, [...(marks ?? []), { type: MARK_MACRO[node.content] }]);
  }
  if (node.content in ESCAPED_CHAR_MACRO) {
    return [markedTextNode(ESCAPED_CHAR_MACRO[node.content], marks)];
  }
  if (node.content === "footnote") return footnoteNode(node, context);
  if (node.content in COLOR_MACRO) return coloredInline(node, context, marks, COLOR_MACRO[node.content]);
  return null;
}

function mathNodeFromAst(node: LatexNode, context: ParseContext): JSONContent {
  return { type: "mathInline", attrs: { source: exactSource(node, context) } };
}

function inlineNodeToJSON(
  node: LatexNode,
  context: ParseContext,
  marks: JSONContent["marks"] = [],
): JSONContent[] | null {
  if (node.type === "string") return [markedTextNode(node.content, marks)];
  if (node.type === "whitespace") return [markedTextNode(" ", marks)];
  if (node.type === "macro") return inlineMacroToJSON(node, context, marks);
  if (node.type === "inlinemath" || node.type === "displaymath") return [mathNodeFromAst(node, context)];
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

export function inlineNodesToJSON(
  nodes: LatexNode[],
  context: ParseContext,
  marks: JSONContent["marks"] = [],
): JSONContent[] {
  const out: JSONContent[] = [];
  let index = 0;
  while (index < nodes.length) {
    const mapped = inlineNodeToJSON(nodes[index], context, marks);
    if (mapped) {
      out.push(...mapped);
      index++;
      continue;
    }
    const run = rawInlineRun(nodes, index);
    out.push({ type: "rawInline", attrs: { source: run.source } });
    index = run.next;
  }
  return mergeAdjacentText(out);
}
