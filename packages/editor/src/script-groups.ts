import { completionStatus } from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import {
  EditorSelection,
  Prec,
  RangeSet,
  RangeValue,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type ChangeSpec,
  type SelectionRange,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { typedAtSelection, vimOwnsInput } from "./latex-structure-commands";
import { isBackslashEscaped } from "@oleafly/latex";

export type ScriptMark = "^" | "_";

export interface ScriptGroupSyntax {
  readonly open: string;
  readonly close: string;
  startsGroup(mark: ScriptMark, first: string, next: string): boolean;
  scriptAt(state: EditorState, at: number): boolean;
}

interface ActiveGroup {
  readonly mark: ScriptMark;
  readonly from: number;
  readonly caret: number;
  readonly to: number;
  readonly body: string;
}

const ESCAPE_WINDOW = 64;

const BASE_SCAN_LIMIT = 256;

const LETTER = /^\p{L}$/u;

export function isScriptDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

export function isScriptLetter(character: string | undefined): boolean {
  return character !== undefined && LETTER.test(character);
}

export function isScriptSign(character: string | undefined): boolean {
  return character === "+" || character === "-";
}

function scriptMark(character: string): ScriptMark | null {
  return character === "^" || character === "_" ? character : null;
}

function bodyLead(body: string): string | undefined {
  return isScriptSign(body[0]) ? body[1] : body[0];
}

function bodyTakes(body: string, next: string): boolean {
  return isScriptDigit(bodyLead(body))
    ? isScriptDigit(next)
    : isScriptDigit(next) || isScriptLetter(next);
}

function groupBody(body: string): boolean {
  if (body.length < 2) return false;
  const start = isScriptSign(body[0]) ? 1 : 0;
  const lead = body[start];
  if (!isScriptDigit(lead) && !isScriptLetter(lead)) return false;
  for (let index = start + 1; index < body.length; index += 1) {
    if (!bodyTakes(body, body[index])) return false;
  }
  return true;
}

function escapedAt(state: EditorState, pos: number): boolean {
  const from = Math.max(0, pos - ESCAPE_WINDOW);
  return isBackslashEscaped(state.sliceDoc(from, pos), pos - from);
}

class ScriptGroup extends RangeValue {
  constructor(readonly close: string) {
    super();
  }
}

ScriptGroup.prototype.startSide = 1;
ScriptGroup.prototype.endSide = -1;

interface ScriptGroupInsertion {
  readonly from: number;
  readonly to: number;
  readonly close: string;
}

const trackGroup = StateEffect.define<ScriptGroupInsertion>({
  map: (value, mapping) => ({
    ...value,
    from: mapping.mapPos(value.from, 1),
    to: mapping.mapPos(value.to, -1),
  }),
});

function caretAt(state: EditorState, pos: number): boolean {
  return state.selection.ranges.some(
    (range) => range.empty && range.head === pos,
  );
}

const scriptGroupsField = StateField.define<RangeSet<ScriptGroup>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    let next = set;
    if (next.size > 0) {
      next = next.map(tr.changes).update({
        filter: (_from, to, value) =>
          caretAt(tr.state, to - value.close.length),
      });
    }
    for (const effect of tr.effects) {
      if (!effect.is(trackGroup)) continue;
      const { from, to, close } = effect.value;
      next = next.update({ add: [new ScriptGroup(close).range(from, to)] });
    }
    return next;
  },
});

function activeGroupAt(
  state: EditorState,
  syntax: ScriptGroupSyntax,
  set: RangeSet<ScriptGroup>,
  pos: number,
): ActiveGroup | null {
  let found: ActiveGroup | null = null;
  set.between(pos, pos, (from, to) => {
    if (to - syntax.close.length !== pos) return;
    const bodyFrom = from + syntax.open.length;
    if (state.sliceDoc(from, bodyFrom) !== syntax.open) return;
    const mark = scriptMark(state.sliceDoc(from - 1, from));
    const body = state.sliceDoc(bodyFrom, pos);
    if (!mark || !groupBody(body)) return;
    found = { mark, from, caret: pos, to, body };
    return false;
  });
  return found;
}

function activeGroups(
  state: EditorState,
  syntax: ScriptGroupSyntax,
): readonly ActiveGroup[] | null {
  const set = state.field(scriptGroupsField, false);
  if (!set || set.size === 0) return null;
  const groups: ActiveGroup[] = [];
  for (const range of state.selection.ranges) {
    if (!range.empty) return null;
    const group = activeGroupAt(state, syntax, set, range.head);
    if (!group) return null;
    groups.push(group);
  }
  return groups;
}

function changeEachGroup(
  state: EditorState,
  groups: readonly ActiveGroup[],
  plan: (group: ActiveGroup) => { changes: ChangeSpec; range: SelectionRange },
): TransactionSpec {
  let index = 0;
  return state.changeByRange(() => {
    const group = groups[index];
    index += 1;
    return plan(group);
  });
}

function groupStartAt(
  state: EditorState,
  syntax: ScriptGroupSyntax,
  range: SelectionRange,
  next: string,
): boolean {
  if (!range.empty || range.head < 2) return false;
  const pos = range.head;
  const mark = scriptMark(state.sliceDoc(pos - 2, pos - 1));
  if (!mark) return false;
  if (state.sliceDoc(Math.max(0, pos - 3), pos - 2) === mark) return false;
  if (!syntax.startsGroup(mark, state.sliceDoc(pos - 1, pos), next)) {
    return false;
  }
  const after = state.sliceDoc(pos, pos + 1);
  if (isScriptLetter(after) || isScriptDigit(after)) return false;
  return !escapedAt(state, pos - 2) && syntax.scriptAt(state, pos - 2);
}

function startGroups(
  view: EditorView,
  syntax: ScriptGroupSyntax,
  text: string,
): boolean {
  if (!isScriptLetter(text) && !isScriptDigit(text)) return false;
  const state = view.state;
  if (
    !state.selection.ranges.every((range) =>
      groupStartAt(state, syntax, range, text),
    )
  ) {
    return false;
  }
  view.dispatch({
    ...state.replaceSelection(text),
    userEvent: "input.type",
    scrollIntoView: true,
  });
  const typed = view.state;
  view.dispatch({
    ...typed.changeByRange((range) => {
      const first = range.head - 2;
      return {
        changes: [
          { from: first, insert: syntax.open },
          { from: range.head, insert: syntax.close },
        ],
        range: EditorSelection.cursor(range.head + syntax.open.length),
        effects: trackGroup.of({
          from: first,
          to: range.head + syntax.open.length + syntax.close.length,
          close: syntax.close,
        }),
      };
    }),
    annotations: isolateHistory.of("full"),
    userEvent: "input.type",
    scrollIntoView: true,
  });
  return true;
}

function groupStartIn(
  text: string,
  last: number,
  syntax: ScriptGroupSyntax,
): number | null {
  let depth = 0;
  for (let index = last; index >= 0; index -= 1) {
    const character = text[index];
    if (isBackslashEscaped(text, index)) continue;
    if (character === syntax.close) depth += 1;
    if (character !== syntax.open) continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return null;
}

function wordStartIn(text: string, last: number): number {
  if (!isScriptLetter(text[last])) return last;
  let start = last;
  while (start > 0 && isScriptLetter(text[start - 1])) start -= 1;
  const command =
    start > 0 && text[start - 1] === "\\" && !isBackslashEscaped(text, start - 1);
  return command ? start - 1 : last;
}

function tokenStartBefore(
  state: EditorState,
  syntax: ScriptGroupSyntax,
  end: number,
): number | null {
  const from = Math.max(0, end - BASE_SCAN_LIMIT);
  const text = state.sliceDoc(from, end);
  const last = text.length - 1;
  const start =
    text[last] === syntax.close && !isBackslashEscaped(text, last)
      ? groupStartIn(text, last, syntax)
      : wordStartIn(text, last);
  return start === null ? null : from + start;
}

function baseCarries(
  state: EditorState,
  syntax: ScriptGroupSyntax,
  markAt: number,
  mark: ScriptMark,
): boolean {
  const start = tokenStartBefore(state, syntax, markAt);
  return (
    start !== null &&
    start > 0 &&
    state.sliceDoc(start - 1, start) === mark &&
    !escapedAt(state, start - 1)
  );
}

function splitsAt(
  state: EditorState,
  syntax: ScriptGroupSyntax,
  group: ActiveGroup,
  mark: ScriptMark,
): boolean {
  return (
    isScriptLetter(group.body[0]) &&
    isScriptLetter(group.body.at(-1)) &&
    (mark === group.mark || baseCarries(state, syntax, group.from - 1, mark))
  );
}

function splitGroups(
  view: EditorView,
  syntax: ScriptGroupSyntax,
  groups: readonly ActiveGroup[],
  mark: ScriptMark,
): void {
  view.dispatch({
    ...changeEachGroup(view.state, groups, (group) => {
      const kept = group.body.slice(0, -1);
      const head =
        kept.length === 1 ? kept : `${syntax.open}${kept}${syntax.close}`;
      const insert = `${head}${group.body.slice(-1)}${mark}`;
      return {
        changes: [{ from: group.from, to: group.to, insert }],
        range: EditorSelection.cursor(group.from + insert.length),
      };
    }),
    userEvent: "input.type",
    scrollIntoView: true,
  });
}

function stepOver(
  view: EditorView,
  syntax: ScriptGroupSyntax,
  groups: readonly ActiveGroup[],
): void {
  view.dispatch({
    ...changeEachGroup(view.state, groups, (group) => ({
      changes: [{ from: group.caret, to: group.to, insert: syntax.close }],
      range: EditorSelection.cursor(group.to),
    })),
    userEvent: "input.type",
    scrollIntoView: true,
  });
}

function leaveGroups(
  view: EditorView,
  groups: readonly ActiveGroup[],
): void {
  view.dispatch({
    selection: EditorSelection.create(
      groups.map((group) => EditorSelection.cursor(group.to)),
      view.state.selection.mainIndex,
    ),
    scrollIntoView: true,
  });
}

function retype(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  let pending: Transaction | null = null;
  const insert = (): Transaction => {
    pending ??= view.state.update(view.state.replaceSelection(text), {
      userEvent: "input.type",
      scrollIntoView: true,
    });
    return pending;
  };
  const handled = view.state
    .facet(EditorView.inputHandler)
    .some((handler) => handler(view, from, to, text, insert));
  if (!handled) view.dispatch(insert());
}

function groupInput(
  view: EditorView,
  syntax: ScriptGroupSyntax,
  groups: readonly ActiveGroup[],
  text: string,
): boolean {
  if (groups.every((group) => bodyTakes(group.body, text))) return false;
  if (text === syntax.close) {
    stepOver(view, syntax, groups);
    return true;
  }
  const mark = scriptMark(text);
  if (
    mark &&
    groups.every((group) => splitsAt(view.state, syntax, group, mark))
  ) {
    splitGroups(view, syntax, groups, mark);
    return true;
  }
  leaveGroups(view, groups);
  retype(view, text);
  return true;
}

function scriptInput(
  view: EditorView,
  syntax: ScriptGroupSyntax,
  text: string,
): boolean {
  if (text.length !== 1 || view.state.readOnly) return false;
  const groups = activeGroups(view.state, syntax);
  return groups
    ? groupInput(view, syntax, groups, text)
    : startGroups(view, syntax, text);
}

function keyOwnedByEditor(view: EditorView): boolean {
  return !view.state.readOnly && !vimOwnsInput(view);
}

function shrinkGroups(view: EditorView, syntax: ScriptGroupSyntax): boolean {
  if (!keyOwnedByEditor(view)) return false;
  const groups = activeGroups(view.state, syntax);
  if (!groups || groups.some((group) => group.body.length !== 2)) {
    return false;
  }
  view.dispatch({
    ...changeEachGroup(view.state, groups, (group) => ({
      changes: [{ from: group.from, to: group.to, insert: group.body[0] }],
      range: EditorSelection.cursor(group.from + 1),
    })),
    userEvent: "delete.backward",
    scrollIntoView: true,
  });
  return true;
}

function leaveBeforeNewline(
  view: EditorView,
  syntax: ScriptGroupSyntax,
): void {
  if (!keyOwnedByEditor(view) || completionStatus(view.state) === "active") {
    return;
  }
  const groups = activeGroups(view.state, syntax);
  if (groups) leaveGroups(view, groups);
}

export function scriptGroups(syntax: ScriptGroupSyntax): Extension {
  return [
    scriptGroupsField,
    Prec.highest(
      EditorView.inputHandler.of(
        (view, from, to, text) =>
          typedAtSelection(view, from, to) && scriptInput(view, syntax, text),
      ),
    ),
    Prec.highest(
      keymap.of([
        { key: "Backspace", run: (view) => shrinkGroups(view, syntax) },
        {
          key: "Enter",
          run: (view) => {
            leaveBeforeNewline(view, syntax);
            return false;
          },
        },
      ]),
    ),
  ];
}
