import type { JSONContent } from "@tiptap/core";
import { escapeLatexText, unknownNodeToLatex } from "./serialize-unknown";

type MarkWrapper = (inner: string, mark: JSONContent) => string;

function colorArgument(mark: JSONContent): string {
  const color = String(mark.attrs?.color ?? "");
  return color.startsWith("[") ? color : `{${color}}`;
}

const MARK_WRAPPERS: Record<string, MarkWrapper> = {
  bold: (inner) => String.raw`\textbf{${inner}}`,
  italic: (inner) => String.raw`\textit{${inner}}`,
  underline: (inner) => String.raw`\underline{${inner}}`,
  code: (inner) => String.raw`\texttt{${inner}}`,
  textColor: (inner, mark) => String.raw`\textcolor${colorArgument(mark)}{${inner}}`,
  colorBox: (inner, mark) => String.raw`\colorbox${colorArgument(mark)}{${inner}}`,
  strike: (inner) => inner,
  link: (inner) => inner,
};

function textNodeToLatex(node: JSONContent): string {
  const escaped = escapeLatexText(node.text ?? "");
  const marks = node.marks ?? [];
  const link = marks.find((mark) => mark.type === "link");
  const base = link ? String.raw`\href{${link.attrs?.href ?? ""}}{${escaped}}` : escaped;
  return marks.reduceRight((inner, mark) => {
    const wrapper = Object.hasOwn(MARK_WRAPPERS, mark.type) ? MARK_WRAPPERS[mark.type] : null;
    return wrapper ? wrapper(inner, mark) : inner;
  }, base);
}

function sourceOf(node: JSONContent): string {
  return String(node.attrs?.source ?? "");
}

const INLINE_HANDLERS: Record<string, (node: JSONContent) => string> = {
  text: textNodeToLatex,
  rawInline: sourceOf,
  mathInline: sourceOf,
  footnote: (node) => String.raw`\footnote{${sourceOf(node)}}`,
  hardBreak: () => String.raw`\\`,
  image: (node) => String.raw`\includegraphics{${String(node.attrs?.src ?? "")}}`,
};

export function hasInlineLatexSerialization(type: string): boolean {
  return Object.hasOwn(INLINE_HANDLERS, type);
}

export function hasMarkLatexSerialization(type: string): boolean {
  return Object.hasOwn(MARK_WRAPPERS, type);
}

export function inlineToLatex(nodes: JSONContent[] = []): string {
  return nodes
    .map((node) => {
      const handler = Object.hasOwn(INLINE_HANDLERS, node.type ?? "") ? INLINE_HANDLERS[node.type ?? ""] : null;
      return handler ? handler(node) : unknownNodeToLatex(node);
    })
    .join("");
}
