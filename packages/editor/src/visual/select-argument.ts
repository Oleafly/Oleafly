import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  type Extension,
  type SelectionRange,
  type StateField,
} from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import { ancestorOfType, descendantsOfType } from "../latex-tree";
import { selectionAtMouseDown, selectionIntersects } from "./selection";

function coveredByAtom(set: DecorationSet, pos: number): boolean {
  let covered = false;
  set.between(pos, pos, (_from, to) => {
    if (to > pos) {
      covered = true;
      return false;
    }
    return undefined;
  });
  return covered;
}

function argumentSelection(
  tree: Tree,
  range: SelectionRange,
  pressed: EditorSelection | undefined,
  side: -1 | 1,
): SelectionRange | null {
  const anchor = tree.resolveInner(range.anchor, side);
  const command = ancestorOfType(anchor, "$Command");
  if (!command) return null;
  if (pressed && selectionIntersects(pressed, command)) return null;
  const [inner] = descendantsOfType(command, "$TextArgument");
  if (!inner) return null;
  if (side === 1) {
    if (range.anchor !== inner.from + 1 && range.anchor !== command.from) return null;
    if (range.empty) return EditorSelection.cursor(inner.from + 1);
    return Math.abs(range.head - inner.to) < 2 ? EditorSelection.range(inner.from + 1, inner.to - 1) : null;
  }
  if (range.anchor !== inner.to - 1 && range.anchor !== command.to) return null;
  if (range.empty) return EditorSelection.cursor(inner.to - 1);
  return Math.abs(range.head - command.from) < 2 ? EditorSelection.range(inner.to - 1, inner.from + 1) : null;
}

export function selectDecoratedArgument(field: StateField<{ decorations: DecorationSet }>): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.selection || !tr.isUserEvent("select.pointer")) return tr;
    const tree = syntaxTree(tr.state);
    const atoms = tr.state.field(field, false)?.decorations;
    const pressed = selectionAtMouseDown(tr.state);
    let selection = tr.selection;
    let replaced = false;
    tr.selection.ranges.forEach((range, index) => {
      if (atoms && !coveredByAtom(atoms, range.anchor)) return;
      const replacement =
        argumentSelection(tree, range, pressed, 1) ?? argumentSelection(tree, range, pressed, -1);
      if (replacement) {
        selection = selection.replaceRange(replacement, index);
        replaced = true;
      }
    });
    return replaced ? [tr, { selection }] : tr;
  });
}
