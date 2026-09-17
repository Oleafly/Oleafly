import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type SelectionRange, type Transaction } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

function itemNodeAround(node: SyntaxNode): SyntaxNode | null {
  if (node.type.is("Item")) return node;
  if (node.type.is("ItemCtrlSeq")) return node.parent;
  if (node.type.is("Whitespace") && node.nextSibling?.type.is("Command")) {
    return node.nextSibling.firstChild?.firstChild ?? null;
  }
  return null;
}

function targetPosition(tr: Transaction, range: SelectionRange, index: number): number | null {
  const node = syntaxTree(tr.state).resolveInner(range.anchor, 1);
  const item = itemNodeAround(node);
  if (!item?.type.is("Item")) return null;
  if (tr.isUserEvent("select.pointer")) return item.to;
  const previousHead = tr.startState.selection.ranges[index]?.head ?? range.head;
  if (range.head < previousHead) return Math.max(tr.state.doc.lineAt(range.anchor).from - 1, 1);
  return item.to;
}

export const listItemMarker = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection) return tr;
  let selection = tr.selection;
  tr.selection.ranges.forEach((range, index) => {
    if (!range.empty) return;
    const pos = targetPosition(tr, range, index);
    if (pos === null) return;
    selection = selection.replaceRange(
      EditorSelection.cursor(pos, range.assoc, range.bidiLevel ?? undefined, range.goalColumn),
      index,
    );
  });
  return selection === tr.selection ? tr : [tr, { selection }];
});
