import { history, historyField, isolateHistory } from "@codemirror/commands";
import { type Annotation, EditorSelection, EditorState, type StateEffect, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { remoteChange, sessionLineBreaks } from "./collaboration";
import type { BackgroundDocumentChange } from "./controller";
import type { Utf16Edit } from "./document-session";

export interface PathViewState {
  state: EditorState;
  scroll: StateEffect<unknown>;
}

function clampedSelection(selection: EditorSelection, length: number): EditorSelection {
  return EditorSelection.create(
    selection.ranges.map((range) =>
      EditorSelection.range(Math.min(range.anchor, length), Math.min(range.head, length)),
    ),
    selection.mainIndex,
  );
}

export function capturePathViewState(view: EditorView, sessionBound: boolean): PathViewState {
  const saved = view.state.field(historyField, false);
  return {
    state: EditorState.create({
      doc: view.state.doc,
      selection: view.state.selection,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        sessionBound ? sessionLineBreaks : [],
        saved ? [historyField.init(() => saved), history()] : history(),
      ],
    }),
    scroll: view.scrollSnapshot(),
  };
}

function pathViewStateAfter(
  saved: PathViewState,
  changes: readonly BackgroundDocumentChange[],
  annotations: readonly Annotation<unknown>[],
): PathViewState {
  const transaction = saved.state.update({
    changes: [...changes],
    annotations: [...annotations],
  });
  return {
    state: transaction.state,
    scroll: saved.scroll.map(transaction.changes) ?? saved.scroll,
  };
}

export function holdsText(saved: PathViewState, text: string): boolean {
  return saved.state.doc.length === text.length && saved.state.doc.toString() === text;
}

export function editedPathViewState(
  saved: PathViewState,
  changes: readonly BackgroundDocumentChange[],
): PathViewState {
  return pathViewStateAfter(saved, changes, [isolateHistory.of("full")]);
}

export function remotePathViewState(saved: PathViewState, edits: readonly Utf16Edit[]): PathViewState {
  return pathViewStateAfter(saved, edits, [remoteChange.of(true), Transaction.addToHistory.of(false)]);
}

const MAX_SAVED_PATH_STATES = 20;

export function rememberPathState(
  states: Map<string, PathViewState>,
  path: string,
  state: PathViewState,
): void {
  states.delete(path);
  states.set(path, state);
  for (const oldest of states.keys()) {
    if (states.size <= MAX_SAVED_PATH_STATES) break;
    states.delete(oldest);
  }
}

export function takeSavedPathState(
  states: Map<string, PathViewState>,
  path: string,
  pathChanged: boolean,
  content: string,
): { restorable: PathViewState | undefined; selection: EditorSelection | undefined } {
  const saved = pathChanged ? states.get(path) : undefined;
  if (!saved) return { restorable: undefined, selection: undefined };
  states.delete(path);
  return {
    restorable: holdsText(saved, content) ? saved : undefined,
    selection: clampedSelection(saved.state.selection, content.length),
  };
}
