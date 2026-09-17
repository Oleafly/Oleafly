import {
  EditorSelection,
  EditorState,
  type Extension,
  type Line,
  StateEffect,
  StateField,
  type Text,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

export interface Extents {
  from: number;
  to: number;
}

export function selectionIntersects(selection: EditorSelection, extents: Extents): boolean {
  return selection.ranges.some(
    (range) =>
      (extents.from <= range.from && extents.to >= range.from) ||
      (extents.from <= range.to && extents.to >= range.to),
  );
}

export function placeSelectionInsideBlock(view: EditorView, event: MouseEvent): TransactionSpec {
  const block = view.lineBlockAtHeight(event.pageY - view.documentTop);
  const cursor = EditorSelection.cursor(block.to);
  return {
    selection: event.ctrlKey ? view.state.selection.addRange(cursor) : cursor,
    effects: EditorView.scrollIntoView(block.to),
  };
}

export function selectNodeContent(view: EditorView, node: SyntaxNode): void {
  view.dispatch({
    selection: EditorSelection.single(node.from + 1, Math.max(node.from + 1, node.to - 1)),
    scrollIntoView: true,
  });
}

export function extendBackwardsOverEmptyLines(
  doc: Text,
  line: Line,
  limit = Number.POSITIVE_INFINITY,
): number {
  let from = line.from;
  for (let number = line.number - 1; number > 0 && line.number - number <= limit; number -= 1) {
    const previous = doc.line(number);
    if (previous.text.trim().length > 0) break;
    from = previous.from;
  }
  return from;
}

export function extendForwardsOverEmptyLines(
  doc: Text,
  line: Line,
  limit = Number.POSITIVE_INFINITY,
): number {
  let to = line.to;
  for (let number = line.number + 1; number <= doc.lines && number - line.number <= limit; number += 1) {
    const next = doc.line(number);
    if (next.text.trim().length > 0) break;
    to = next.to;
  }
  return to;
}

export const mouseDownEffect = StateEffect.define<boolean>();

export function hasMouseDownEffect(tr: Transaction): boolean {
  return tr.effects.some((effect) => effect.is(mouseDownEffect));
}

const pendingRelease = new WeakMap<EditorView, () => void>();

function releaseLater(view: EditorView): void {
  window.setTimeout(() => {
    if (view.dom.isConnected) view.dispatch({ effects: mouseDownEffect.of(false) });
  });
}

function disarm(view: EditorView): void {
  const pending = pendingRelease.get(view);
  if (!pending) return;
  pendingRelease.delete(view);
  window.removeEventListener("mouseup", pending, true);
}

function arm(view: EditorView): void {
  disarm(view);
  const onRelease = () => {
    disarm(view);
    releaseLater(view);
  };
  pendingRelease.set(view, onRelease);
  window.addEventListener("mouseup", onRelease, true);
}

const pointerListeners = EditorView.domEventHandlers({
  mousedown: (_event, view) => {
    view.dispatch({ effects: mouseDownEffect.of(true) });
    arm(view);
  },
  contextmenu: (_event, view) => {
    disarm(view);
    releaseLater(view);
  },
  drop: (_event, view) => {
    disarm(view);
    releaseLater(view);
  },
});

const selectionAtMouseDownField = StateField.define<EditorSelection | undefined>({
  create: () => undefined,
  update(value, tr) {
    let next = value && tr.docChanged ? value.map(tr.changes) : value;
    for (const effect of tr.effects) {
      if (effect.is(mouseDownEffect)) next = effect.value ? tr.startState.selection : undefined;
    }
    return next;
  },
});

export function selectionAtMouseDown(state: EditorState): EditorSelection | undefined {
  return state.field(selectionAtMouseDownField, false);
}

export const pointerSelectionTracking: Extension = [pointerListeners, selectionAtMouseDownField];

export const scrollAdjustment = EditorState.transactionExtender.of((tr) => {
  if (tr.scrollIntoView) return null;
  const released = tr.effects.some((effect) => effect.is(mouseDownEffect) && effect.value === false);
  return released ? { effects: EditorView.scrollIntoView(tr.newSelection.main.head) } : null;
});
