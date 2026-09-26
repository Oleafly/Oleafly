import { EditorSelection, Prec, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  cursorLineBoundaryBackward,
  cursorLineBoundaryForward,
  selectLineBoundaryBackward,
  selectLineBoundaryForward,
} from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { emacs, EmacsHandler } from "@replit/codemirror-emacs";

import { runHostSave } from "./host-save";

function visualLineEnd(view: EditorView, head: number): number {
  const boundary = view.moveToLineBoundary(EditorSelection.cursor(head), true).head;
  if (boundary > head) return boundary;
  const line = view.state.doc.lineAt(head);
  return Math.min(line.to + 1, view.state.doc.length);
}

function killToVisualLineEnd(handler: EmacsHandler): void {
  const view = handler.view;
  const ranges = view.state.selection.ranges.map((range) =>
    EditorSelection.range(range.head, visualLineEnd(view, range.head)),
  );
  view.dispatch({ selection: EditorSelection.create(ranges) });
  EmacsHandler.execCommand(EmacsHandler.commands.killRegion, handler, null);
}

function searchFromMark(handler: EmacsHandler): void {
  handler.pushEmacsMark(handler.selectionToEmacsMark());
  openSearchPanel(handler.view);
}

function saveFromEmacs(handler: EmacsHandler): void {
  runHostSave(handler.view);
}

let bound = false;

function bindEditorEmacsKeys(): void {
  if (bound) return;
  bound = true;
  EmacsHandler.bindKey("Home|C-a", {
    command: "goOrSelect",
    args: [cursorLineBoundaryBackward, selectLineBoundaryBackward],
  });
  EmacsHandler.bindKey("End|C-e", {
    command: "goOrSelect",
    args: [cursorLineBoundaryForward, selectLineBoundaryForward],
  });
  EmacsHandler.bindKey("C-k", { exec: killToVisualLineEnd, keepLastCommand: true });
  EmacsHandler.bindKey("C-s|C-r", { exec: searchFromMark, readOnly: true });
  EmacsHandler.bindKey("C-x C-s", { exec: saveFromEmacs, readOnly: true });
  EmacsHandler.bindKey("C-x C-l", {
    command: "changeCase",
    args: { dir: -1, region: true },
  });
}

export function emacsModeExtension(): Extension {
  bindEditorEmacsKeys();
  return Prec.highest([emacs()]);
}
