import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { positionalArguments, type TextRange } from "../../typst-arguments";

export function nodeText(state: EditorState, node: TextRange): string {
  return state.sliceDoc(node.from, node.to);
}

export function expressionAfterHash(hash: SyntaxNode): SyntaxNode | null {
  const next = hash.nextSibling;
  return next && next.from === hash.to ? next : null;
}

export function hashBefore(node: SyntaxNode): SyntaxNode | null {
  const previous = node.prevSibling;
  return previous?.name === "Hash" && previous.to === node.from ? previous : null;
}

export function calleeName(state: EditorState, call: SyntaxNode): string | null {
  const callee = call.firstChild;
  if (!callee) return null;
  if (callee.name === "Ident") return nodeText(state, callee);
  if (callee.name !== "FieldAccess") return null;
  const text = nodeText(state, callee);
  return /^[\p{ID_Start}_][\p{ID_Continue}.-]*$/u.test(text) ? text : null;
}

export function isClosedPair(node: SyntaxNode, open: string, close: string): boolean {
  const first = node.firstChild;
  const last = node.lastChild;
  return first?.name === open && last?.name === close && first !== last && !last.type.isError;
}

export function isBlank(text: string): boolean {
  return /^\s*$/u.test(text);
}

export function listDepth(node: SyntaxNode): number {
  let depth = 1;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === "ListItem" || parent.name === "EnumItem" || parent.name === "TermItem") depth += 1;
  }
  return depth;
}

export function decodeTypstEscape(text: string): string {
  if (text.startsWith("\\") && text.startsWith("u{", 1)) {
    const value = Number.parseInt(text.slice(3, -1), 16);
    return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : text;
  }
  return text.slice(1);
}

export function labelKey(state: EditorState, label: TextRange): string {
  return state.sliceDoc(label.from + 1, label.to - 1);
}

export function referenceKey(state: EditorState, ref: SyntaxNode): string | null {
  const marker = ref.getChild("RefMarker");
  if (!marker) return null;
  return state.sliceDoc(marker.from + 1, marker.to);
}

export function imagePath(state: EditorState, args: SyntaxNode): string | null {
  const [first] = positionalArguments(args);
  if (first?.name !== "Str") return null;
  const raw = state.sliceDoc(first.from, first.to);
  if (raw.length < 2 || !raw.endsWith('"') || raw.includes("\\")) return null;
  const path = raw.slice(1, -1).trim().replace(/^\/+/u, "");
  return path === "" ? null : path;
}

