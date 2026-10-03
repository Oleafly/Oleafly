import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export interface TextRange {
  from: number;
  to: number;
}

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

export function callArguments(call: SyntaxNode): SyntaxNode | null {
  return call.getChild("Args");
}

export function argumentNodes(args: SyntaxNode): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  for (let child = args.firstChild; child; child = child.nextSibling) {
    if (["LeftParen", "RightParen", "Comma"].includes(child.name)) continue;
    nodes.push(child);
  }
  return nodes;
}

export function namedArgument(state: EditorState, args: SyntaxNode, name: string): SyntaxNode | null {
  for (let child = args.firstChild; child; child = child.nextSibling) {
    if (child.name !== "Named") continue;
    const key = child.firstChild;
    if (key && nodeText(state, key) === name) return child;
  }
  return null;
}

export function namedValue(named: SyntaxNode): SyntaxNode | null {
  const colon = named.getChild("Colon");
  const value = colon?.nextSibling ?? null;
  return value && !value.type.isError ? value : null;
}

export function positionalArguments(args: SyntaxNode): SyntaxNode[] {
  return argumentNodes(args).filter((node) => node.name !== "Named" && !node.type.isError);
}

export function insideParentheses(args: SyntaxNode): boolean {
  return args.firstChild?.name === "LeftParen";
}

export function closingParenthesis(args: SyntaxNode): SyntaxNode | null {
  for (let child = args.firstChild; child; child = child.nextSibling) {
    if (child.name === "RightParen") return child;
  }
  return null;
}

export function trailingContentBlocks(args: SyntaxNode): SyntaxNode[] {
  const close = closingParenthesis(args);
  const blocks: SyntaxNode[] = [];
  for (let child = close ? close.nextSibling : args.firstChild; child; child = child.nextSibling) {
    if (child.name === "ContentBlock") blocks.push(child);
  }
  return close || !insideParentheses(args) ? blocks : [];
}

export function contentBody(block: SyntaxNode): TextRange | null {
  const open = block.firstChild;
  const close = block.lastChild;
  if (open?.name !== "LeftBracket" || close?.name !== "RightBracket" || close.from < open.to) return null;
  return { from: open.to, to: close.from };
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

export function hasErrorNode(node: SyntaxNode): boolean {
  let found = false;
  node.toTree().iterate({
    enter(ref) {
      if (ref.type.isError) found = true;
      return !found;
    },
  });
  return found;
}
