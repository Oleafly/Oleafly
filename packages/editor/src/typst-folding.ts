import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { typstHeadingLevel } from "./typst-structure";

export interface FoldRange {
  from: number;
  to: number;
}

function headingStartingAt(state: EditorState, pos: number): SyntaxNode | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === "Heading") return node.from === pos ? node : null;
    if (node.from < pos) return null;
  }
  return null;
}

function trimEnd(state: EditorState, from: number, to: number): number {
  let end = to;
  while (end > from && /\s/u.test(state.sliceDoc(end - 1, end))) end -= 1;
  return end;
}

export function typstHeadingFoldRange(state: EditorState, heading: SyntaxNode): FoldRange | null {
  const level = typstHeadingLevel(heading);
  const lineEnd = state.doc.lineAt(heading.from).to;
  let end = -1;
  for (let sibling = heading.nextSibling; sibling; sibling = sibling.nextSibling) {
    if (sibling.name === "Heading" && typstHeadingLevel(sibling) <= level) {
      end = state.doc.lineAt(sibling.from).from;
      break;
    }
  }
  if (end < 0) {
    const container = heading.parent;
    const complete = syntaxTree(state).length >= state.doc.length;
    if (!container || (container.name === "Source" && !complete)) return null;
    end = container.to;
  }
  const to = trimEnd(state, lineEnd, end);
  return to > lineEnd ? { from: lineEnd, to } : null;
}

export function typstHeadingFold(state: EditorState, lineStart: number, lineEnd: number): FoldRange | null {
  const text = state.sliceDoc(lineStart, lineEnd);
  const indent = text.length - text.trimStart().length;
  if (text.charCodeAt(indent) !== 61) return null;
  const heading = headingStartingAt(state, lineStart + indent);
  return heading ? typstHeadingFoldRange(state, heading) : null;
}
