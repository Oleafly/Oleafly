import type { SyntaxNode } from "@lezer/common";

export type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";

export interface TextRange {
  from: number;
  to: number;
}

export function lastChildOfType(node: SyntaxNode, type: string): SyntaxNode | null {
  let found: SyntaxNode | null = null;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.type.is(type)) found = child;
  }
  return found;
}

export function ancestorOfType(node: SyntaxNode, type: string): SyntaxNode | null {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type.is(type)) return current;
  }
  return null;
}

export function isDirectChildOfEnvironment(node: SyntaxNode, environment: SyntaxNode): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (current.from === environment.from && current.to === environment.to) return true;
    const wrapsNode = current.from === node.from && current.to === node.to;
    if (current.name.endsWith("Environment") && !wrapsNode) return false;
  }
  return false;
}

export function rangeOf(node: TextRange): TextRange {
  return { from: node.from, to: node.to };
}

export function rangesOverlap(a: TextRange, b: TextRange): boolean {
  return a.from <= b.to && b.from <= a.to;
}

export function rangeContains(outer: TextRange, inner: TextRange): boolean {
  return outer.from <= inner.from && outer.to >= inner.to;
}
