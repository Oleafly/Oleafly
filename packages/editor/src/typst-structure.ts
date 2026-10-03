import { syntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { STICKY_MAX_LINES, type StickyScope } from "./sticky-structure";

export interface TypstHeading {
  node: SyntaxNode;
  from: number;
  to: number;
  level: number;
  titleFrom: number;
  titleTo: number;
}

const HEADING_OPAQUE = new Set(["Equation", "Raw", "Str", "LineComment", "BlockComment"]);
const headingCache = new WeakMap<Tree, readonly TypstHeading[]>();

export function typstHeadingLevel(heading: SyntaxNode): number {
  const marker = heading.firstChild;
  return marker?.name === "HeadingMarker" ? marker.to - marker.from : 1;
}

export function typstHeadings(tree: Tree): readonly TypstHeading[] {
  const cached = headingCache.get(tree);
  if (cached) return cached;
  const headings: TypstHeading[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === "Heading") {
        const heading = node.node;
        const body = heading.getChild("Markup");
        headings.push({
          node: heading,
          from: heading.from,
          to: heading.to,
          level: typstHeadingLevel(heading),
          titleFrom: body?.from ?? heading.to,
          titleTo: body?.to ?? heading.to,
        });
        return false;
      }
      return HEADING_OPAQUE.has(node.name) ? false : undefined;
    },
  });
  headingCache.set(tree, headings);
  return headings;
}

type TypstTextReader = (from: number, to: number) => string;

const SHORTHANDS: Readonly<Record<string, string>> = {
  "~": "\u00a0",
  "--": "\u2013",
  "---": "\u2014",
  "...": "\u2026",
  "-?": "",
  "-": "\u2212",
};

const SILENT_MARKUP = new Set([
  "LineComment",
  "BlockComment",
  "Label",
  "HeadingMarker",
  "ListMarker",
  "EnumMarker",
  "TermMarker",
  "Hash",
  "Star",
  "Underscore",
]);

function decodeTypstEscape(text: string): string {
  if (text.startsWith("\\u{")) {
    const value = Number.parseInt(text.slice(3, -1), 16);
    return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : "";
  }
  return text.slice(1);
}

function unquote(text: string): string {
  const body = text.slice(1, text.endsWith('"') && text.length > 1 ? -1 : undefined);
  return body.replaceAll(/\\(u\{[0-9a-fA-F]+\}|.)/gu, (_match, escape: string) => {
    if (escape.startsWith("u{")) return decodeTypstEscape(`\\${escape}`);
    if (escape === "n" || escape === "r" || escape === "t") return " ";
    return escape;
  });
}

function rawText(node: SyntaxNode, read: TypstTextReader): string {
  const open = node.firstChild;
  const close = node.lastChild;
  if (!open || !close || open === close) return "";
  const start = node.getChild("RawLang")?.to ?? open.to;
  return read(start, close.from);
}

function embeddedText(node: SyntaxNode, read: TypstTextReader, parts: string[]): void {
  switch (node.name) {
    case "Str":
      parts.push(unquote(read(node.from, node.to)));
      return;
    case "Int":
    case "Float":
    case "Numeric":
      parts.push(read(node.from, node.to));
      return;
    case "ContentBlock": {
      const body = node.getChild("Markup");
      if (body) markupText(body, read, parts);
      return;
    }
    case "FuncCall": {
      const args = node.getChild("Args");
      if (!args) return;
      const blocks = args.getChildren("ContentBlock");
      const sources = blocks.length > 0 ? blocks : args.getChildren("Str");
      for (const source of sources) embeddedText(source, read, parts);
      return;
    }
    default:
      return;
  }
}

function markupChild(node: SyntaxNode, read: TypstTextReader, parts: string[]): void {
  switch (node.name) {
    case "Escape":
      parts.push(decodeTypstEscape(read(node.from, node.to)));
      return;
    case "Linebreak":
      parts.push(" ");
      return;
    case "Shorthand":
      parts.push(SHORTHANDS[read(node.from, node.to)] ?? "");
      return;
    case "Raw":
      parts.push(rawText(node, read));
      return;
    case "Equation": {
      const open = node.firstChild;
      const close = node.lastChild;
      const end = close && close !== open && close.name === "Dollar" ? close.from : node.to;
      parts.push(read(open?.to ?? node.from, end).trim());
      return;
    }
    case "Ref":
      parts.push(read(node.from, node.getChild("RefMarker")?.to ?? node.to));
      return;
    case "TermItem": {
      const [term, description] = node.getChildren("Markup");
      if (term) markupText(term, read, parts);
      parts.push(": ");
      if (description) markupText(description, read, parts);
      return;
    }
    default:
      break;
  }
  if (SILENT_MARKUP.has(node.name)) return;
  const previous = node.prevSibling;
  if (previous?.name === "Hash" && previous.to === node.from) {
    embeddedText(node, read, parts);
    return;
  }
  if (node.firstChild) markupText(node, read, parts);
  else parts.push(read(node.from, node.to));
}

function markupText(node: SyntaxNode, read: TypstTextReader, parts: string[]): void {
  let pos = node.from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from > pos) parts.push(read(pos, child.from));
    markupChild(child, read, parts);
    pos = Math.max(pos, child.to);
  }
  if (node.to > pos) parts.push(read(pos, node.to));
}

export function typstPlainText(node: SyntaxNode, source: string | TypstTextReader): string {
  const read: TypstTextReader =
    typeof source === "string" ? (from, to) => source.slice(from, to) : source;
  const parts: string[] = [];
  const body = node.name === "Heading" ? node.getChild("Markup") : node;
  if (body) markupText(body, read, parts);
  return parts.join("").replaceAll(/\s+/gu, " ").trim();
}

const TYPST_OPAQUE = new Set(["Equation", "Raw", "Str", "LineComment", "BlockComment", "Label"]);

interface OpenHeading {
  line: number;
  level: number;
}

function startsLine(doc: Text, pos: number): boolean {
  const line = doc.lineAt(pos);
  return doc.sliceString(line.from, pos).trim() === "";
}

function blockEndLine(doc: Text, block: SyntaxNode): number {
  const close = block.lastChild;
  const line = doc.lineAt(Math.max(block.from, block.to - 1));
  if (close?.name !== "RightBracket") return line.number;
  return startsLine(doc, close.from) ? line.number - 1 : line.number;
}

export function typstStickyScopes(state: EditorState): StickyScope[] {
  const { doc } = state;
  if (doc.lines > STICKY_MAX_LINES) return [];
  const scopes: StickyScope[] = [];
  const close = (line: number, endLine: number) => {
    if (endLine > line) scopes.push({ line, endLine });
  };
  const containers: OpenHeading[][] = [[]];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "Heading") {
        const open = containers[containers.length - 1];
        const line = doc.lineAt(node.from).number;
        const level = typstHeadingLevel(node.node);
        while (open.length > 0 && open[open.length - 1].level >= level) close(open.pop()!.line, line - 1);
        open.push({ line, level });
        return false;
      }
      if (node.name === "Hash") {
        const expression = node.node.nextSibling;
        if (expression && expression.from === node.to && startsLine(doc, node.from)) {
          close(doc.lineAt(node.from).number, doc.lineAt(expression.to).number);
        }
        return false;
      }
      if (node.name === "ContentBlock") containers.push([]);
      return TYPST_OPAQUE.has(node.name) ? false : undefined;
    },
    leave(node) {
      if (node.name !== "ContentBlock") return;
      const endLine = blockEndLine(doc, node.node);
      for (const heading of containers.pop() ?? []) close(heading.line, endLine);
    },
  });
  for (const heading of containers[0]) close(heading.line, doc.lines);
  scopes.sort((a, b) => a.line - b.line);
  return scopes;
}
