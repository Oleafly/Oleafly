import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { isTypstDisplayBody, type MathExpression, scanMathExpressions } from "./math-source";

const PARSE_BUDGET_MS = 20;
const MAX_FALLBACK_WINDOW = 8_000;

function parsedTree(state: EditorState, to: number): Tree | null {
  const tree = ensureSyntaxTree(state, to, PARSE_BUDGET_MS) ?? syntaxTree(state);
  if (tree.type.name !== "Source" || tree.length < to) return null;
  return tree;
}

function fallbackWindow(state: EditorState, from: number, to: number): { from: number; to: number } {
  const doc = state.doc;
  let start = doc.lineAt(from);
  for (let number = start.number - 1; number >= 1; number--) {
    const previous = doc.line(number);
    if (previous.text.trim() === "" || from - previous.from > MAX_FALLBACK_WINDOW) break;
    start = previous;
  }
  let end = doc.lineAt(to);
  for (let number = end.number + 1; number <= doc.lines; number++) {
    const next = doc.line(number);
    if (next.text.trim() === "" || next.to - to > MAX_FALLBACK_WINDOW) break;
    end = next;
  }
  return { from: start.from, to: end.to };
}

function scannedExpressions(state: EditorState, from: number, to: number): MathExpression[] {
  const window = fallbackWindow(state, from, to);
  const text = state.doc.sliceString(window.from, window.to);
  return scanMathExpressions(text, { format: "typst" })
    .map((expression) => ({
      ...expression,
      from: expression.from + window.from,
      to: expression.to + window.from,
      bodyFrom: expression.bodyFrom + window.from,
      bodyTo: expression.bodyTo + window.from,
    }))
    .filter((expression) => expression.to >= from && expression.from <= to);
}

function treeExpressions(state: EditorState, tree: Tree, from: number, to: number): MathExpression[] {
  const expressions: MathExpression[] = [];
  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "Equation") return true;
      const last = node.node.lastChild;
      const complete = !!last && last.name === "Dollar" && last.from > node.from;
      const bodyFrom = node.from + 1;
      const bodyTo = complete && last ? last.from : node.to;
      const body = state.doc.sliceString(bodyFrom, bodyTo);
      expressions.push({
        from: node.from,
        to: node.to,
        bodyFrom,
        bodyTo,
        source: state.doc.sliceString(node.from, node.to),
        body,
        display: isTypstDisplayBody(body),
        delimiter: "$",
        status: complete ? "complete" : "incomplete",
      });
      return false;
    },
  });
  return expressions;
}

export function typstMathExpressionsInState(state: EditorState, from: number, to: number): MathExpression[] {
  const tree = parsedTree(state, to);
  return tree ? treeExpressions(state, tree, from, to) : scannedExpressions(state, from, to);
}

export function typstMathAt(state: EditorState, pos: number): MathExpression | null {
  for (const expression of typstMathExpressionsInState(state, pos, pos)) {
    if (expression.status !== "complete" || expression.from > pos || expression.to < pos) continue;
    return expression.body.trim() ? expression : null;
  }
  return null;
}

export function insideTypstMath(state: EditorState, from: number, to: number): boolean {
  return typstMathExpressionsInState(state, from, to).some(
    (expression) => expression.status === "complete" && expression.bodyFrom <= from && to <= expression.bodyTo,
  );
}
