import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type Line, Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

const HEADING_TAIL = /^[ \t]*(?:<[^<>\n]*>[ \t]*)?$/u;

function headingOn(state: EditorState, line: Line): SyntaxNode | null {
  const indent = /^[ \t]*/u.exec(line.text)?.[0].length ?? 0;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(line.from + indent, 1); node; node = node.parent) {
    if (node.name === "Heading") return state.doc.lineAt(node.from).number === line.number ? node : null;
  }
  return null;
}

export function leaveTypstHeading(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly) return false;
  let handled = false;
  const transaction = state.changeByRange((range) => {
    if (!range.empty) return { range };
    const line = state.doc.lineAt(range.head);
    const heading = headingOn(state, line);
    const body = heading?.getChild("Markup");
    if (!heading || !body || range.head < body.from) return { range };
    if (!HEADING_TAIL.test(state.sliceDoc(range.head, line.to))) return { range };
    handled = true;
    return { changes: { from: line.to, insert: "\n" }, range: EditorSelection.cursor(line.to + 1) };
  });
  if (!handled) return false;
  view.dispatch(transaction, { scrollIntoView: true, userEvent: "input" });
  return true;
}

export const typstVisualKeymap = Prec.highest(keymap.of([{ key: "Enter", run: leaveTypstHeading }]));
