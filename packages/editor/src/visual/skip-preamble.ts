import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  type EditorState,
  type Extension,
  type RangeSet,
  type RangeValue,
  type StateField,
} from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { collapsePreambleEffect, type Preamble } from "./widgets/preamble";

export function skipAtomicRanges(state: EditorState, sets: RangeSet<RangeValue>[], position: number): number {
  let pos = position;
  let previous: number;
  do {
    previous = pos;
    for (const set of sets) {
      set.between(pos, pos, (_from, to) => {
        if (to > pos) pos = to;
      });
    }
    if (pos !== previous && state.doc.lineAt(pos).to === pos) pos += 1;
  } while (pos !== previous);
  return Math.min(pos, state.doc.length);
}

export function skipPreambleCursor(field: StateField<{ preamble: Preamble }>): Extension {
  return ViewPlugin.define((view: EditorView) => {
    let checked = false;
    let destroyed = false;

    const dispatchLater = (selection: EditorSelection) => {
      window.setTimeout(() => {
        if (!destroyed) view.dispatch({ selection, scrollIntoView: true });
      });
    };

    const escapeAtomicRanges = (selection: EditorSelection, force = false) => {
      const sets = view.state.facet(EditorView.atomicRanges).map((source) => source(view));
      let next = selection;
      selection.ranges.forEach((range, index) => {
        const anchor = skipAtomicRanges(view.state, sets, range.anchor);
        const head = skipAtomicRanges(view.state, sets, range.head);
        if (anchor !== range.anchor || head !== range.head) {
          next = next.replaceRange(EditorSelection.range(anchor, head), index);
        }
      });
      if (force || next !== selection) dispatchLater(next);
    };

    const leavePreamble = () => {
      const preamble = view.state.field(field, false)?.preamble;
      if (!preamble || preamble.to <= 0) return;
      const target = Math.min(preamble.to + 1, view.state.doc.length);
      escapeAtomicRanges(EditorSelection.create([EditorSelection.cursor(target)]), true);
    };

    const checkInitialSelection = (state: EditorState) => {
      if (checked || syntaxTree(state).length < state.doc.length) return;
      checked = true;
      if (state.selection.eq(EditorSelection.create([EditorSelection.cursor(0)]))) leavePreamble();
      else escapeAtomicRanges(state.selection);
    };

    window.setTimeout(() => {
      if (!destroyed) checkInitialSelection(view.state);
    });

    return {
      update(update) {
        if (!checked) {
          checkInitialSelection(update.state);
          return;
        }
        const collapsed = update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(collapsePreambleEffect)),
        );
        if (collapsed) leavePreamble();
      },
      destroy() {
        destroyed = true;
      },
    };
  });
}
