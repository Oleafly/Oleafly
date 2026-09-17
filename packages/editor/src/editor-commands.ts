import { EditorSelection, type EditorState, type SelectionRange } from "@codemirror/state";
import type { Command, KeyBinding } from "@codemirror/view";
import {
  addCursorAbove,
  addCursorBelow,
  copyLineDown,
  deleteLine,
  indentLess,
  indentMore,
  toggleComment,
} from "@codemirror/commands";
import { gotoLine, selectNextOccurrence } from "@codemirror/search";

type CaseTransform = (value: string) => string;

const WORD_PATTERN = /\p{L}[\p{L}\p{M}\p{N}'’]*/gu;

const toTitleCase = (value: string): string =>
  value.replace(
    WORD_PATTERN,
    (word) => word.slice(0, 1).toUpperCase() + word.slice(1).toLowerCase(),
  );

function caseTarget(state: EditorState, range: SelectionRange): SelectionRange {
  if (!range.empty) return range;
  return state.wordAt(range.head) ?? range;
}

function changeCase(transform: CaseTransform): Command {
  return (view) => {
    const state = view.state;
    let changed = false;
    const spec = state.changeByRange((range) => {
      const target = caseTarget(state, range);
      if (target.empty) return { range };
      const text = state.sliceDoc(target.from, target.to);
      const next = transform(text);
      if (next === text) return { range };
      changed = true;
      return {
        changes: { from: target.from, to: target.to, insert: next },
        range: range.empty
          ? EditorSelection.cursor(Math.min(range.head, target.from + next.length))
          : EditorSelection.range(target.from, target.from + next.length),
      };
    });
    if (!changed) return false;
    view.dispatch(state.update(spec, { userEvent: "input.changeCase", scrollIntoView: true }));
    return true;
  };
}

export const uppercaseSelection = changeCase((value) => value.toUpperCase());
export const lowercaseSelection = changeCase((value) => value.toLowerCase());
export const titleCaseSelection = changeCase(toTitleCase);

export const duplicateSelection: Command = (view) => {
  const state = view.state;
  if (state.selection.ranges.every((range) => range.empty)) return copyLineDown(view);
  const spec = state.changeByRange((range) => {
    if (range.empty) return { range };
    const text = state.sliceDoc(range.from, range.to);
    return {
      changes: { from: range.to, insert: text },
      range: EditorSelection.range(range.to, range.to + text.length),
    };
  });
  view.dispatch(state.update(spec, { userEvent: "input.duplicate", scrollIntoView: true }));
  return true;
};

export const deleteLineCommand: Command = deleteLine;

export {
  addCursorAbove,
  addCursorBelow,
  gotoLine,
  indentLess,
  indentMore,
  selectNextOccurrence,
  toggleComment,
};

export type EditorCommandId =
  | "uppercase"
  | "lowercase"
  | "titleCase"
  | "deleteLine"
  | "duplicate"
  | "addCursorAbove"
  | "addCursorBelow"
  | "gotoLine"
  | "toggleComment"
  | "selectNextOccurrence"
  | "indentMore"
  | "indentLess";

export const EDITOR_COMMANDS: Readonly<Record<EditorCommandId, Command>> = {
  uppercase: uppercaseSelection,
  lowercase: lowercaseSelection,
  titleCase: titleCaseSelection,
  deleteLine: deleteLineCommand,
  duplicate: duplicateSelection,
  addCursorAbove,
  addCursorBelow,
  gotoLine,
  toggleComment,
  selectNextOccurrence,
  indentMore,
  indentLess,
};

export const EDITOR_COMMAND_IDS = Object.keys(EDITOR_COMMANDS) as EditorCommandId[];

export function editorCommandKeymap(
  keys: Readonly<Partial<Record<EditorCommandId, string>>>,
): KeyBinding[] {
  return EDITOR_COMMAND_IDS.flatMap((id) => {
    const key = keys[id]?.trim();
    return key ? [{ key, run: EDITOR_COMMANDS[id], preventDefault: true }] : [];
  });
}
