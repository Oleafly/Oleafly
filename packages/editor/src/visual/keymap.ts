import { IndentContext, indentString } from "@codemirror/language";
import { type ChangeSpec, EditorSelection, Prec, type SelectionRange, type EditorState } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { ancestorAt, ancestorOfType, listEnvironmentName } from "../latex-tree";

interface RangeChange {
  changes?: ChangeSpec;
  range: SelectionRange;
}

const EMPTY_ITEM = /^\\item(\[\])?$/u;

function listItemText(state: EditorState, pos: number): string {
  const indent = indentString(state, new IndentContext(state).lineIndent(pos));
  return `${indent}\\item `;
}

function whitespaceAfter(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos);
  return /^\s*/u.exec(state.sliceDoc(pos, line.to))?.[0].length ?? 0;
}

function leaveEmptyLastItem(state: EditorState, list: SyntaxNode, lineFrom: number, lineTo: number): RangeChange {
  const deleteLine = { from: lineFrom, to: Math.min(lineTo + 1, state.doc.length), insert: "" };
  const changes: ChangeSpec[] = [deleteLine];
  const atDocumentEnd = list.to >= state.doc.length;
  const pos = atDocumentEnd ? list.to : list.to + 1;
  let cursor = EditorSelection.cursor(pos);
  if (ancestorOfType(list.parent, "ListEnvironment")) {
    const item = listItemText(state, pos);
    const insert = atDocumentEnd ? `\n${item}` : `${item}\n`;
    changes.push({ from: pos, insert });
    cursor = EditorSelection.cursor(pos + insert.length - (atDocumentEnd ? 0 : 1));
  }
  return { changes, range: cursor.map(state.changes(deleteLine)) };
}

function continueList(state: EditorState, range: SelectionRange, list: SyntaxNode): RangeChange {
  const { from } = range;
  const line = state.doc.lineAt(from);
  const endLine = state.doc.lineAt(list.to);
  if (line.number === endLine.number - 1 && EMPTY_ITEM.test(line.text.trim())) {
    return leaveEmptyLastItem(state, list, line.from, line.to);
  }
  let insert = `\n${listItemText(state, from)}`;
  let pos: number;
  if (listEnvironmentName(state, list) === "description") {
    insert = insert.replace(/\\item $/u, "\\item[] ");
    pos = from + insert.length - 2;
  } else {
    pos = from + insert.length + whitespaceAfter(state, from);
  }
  return { changes: { from, insert }, range: EditorSelection.cursor(pos, -1) };
}

function leaveHeading(state: EditorState, from: number): RangeChange | null {
  const nextLineNumber = state.doc.lineAt(from).number + 1;
  if (nextLineNumber > state.doc.lines) return null;
  return { range: EditorSelection.cursor(state.doc.line(nextLineNumber).from) };
}

export function insertListItemOrLeaveHeading(view: EditorView): boolean {
  const { state } = view;
  let handled = false;
  const transaction = state.changeByRange((range) => {
    if (!range.empty) return { range };
    const list = ancestorAt(state, range.from, "ListEnvironment");
    if (list) {
      handled = true;
      return continueList(state, range, list);
    }
    if (ancestorAt(state, range.from, "SectioningCommand")) {
      const result = leaveHeading(state, range.from);
      if (result) {
        handled = true;
        return result;
      }
    }
    return { range };
  });
  if (!handled) return false;
  view.dispatch(transaction, { scrollIntoView: true, userEvent: "input" });
  return true;
}

export const visualKeymap = Prec.highest(keymap.of([{ key: "Enter", run: insertListItemOrLeaveHeading }]));
