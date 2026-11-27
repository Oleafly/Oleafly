import {
  EditorSelection,
  type EditorState,
  type Extension,
  Prec,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { autoCandidates } from "@oleafly/snippets";
import { vimOwnsInput } from "../latex-structure-commands";
import { insertSnippet } from "./insert";
import { autoExpandYieldsTo } from "./loader";
import { fitsAt, snippetLookup } from "./lookup";
import { snippetPort } from "./port";
import { popSnippetSession, snippetSessions } from "./session";

interface AutoExpansion {
  from: number;
  to: number;
  typed: string;
  depth: number;
}

const HAND_TYPED_FRACTION = "\\frac{";

const setAutoExpansion = StateEffect.define<AutoExpansion>({
  map: (value, mapping) => ({ ...value, from: mapping.mapPos(value.from, 1), to: mapping.mapPos(value.to, -1) }),
});

export const lastAutoExpansion = StateField.define<AutoExpansion | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setAutoExpansion)) return effect.value;
    return value && (tr.docChanged || tr.selection) ? null : value;
  },
});

function yielded(state: EditorState): boolean {
  return state.facet(autoExpandYieldsTo).some((owner) => owner(state));
}

function singleCaretAt(state: EditorState, from: number, to: number): boolean {
  const { ranges, main } = state.selection;
  return ranges.length === 1 && main.empty && main.head === from && to === from;
}

function expand(view: EditorView, from: number, to: number, text: string, insert: () => Transaction): boolean {
  if (text.length !== 1 || view.composing || view.compositionStarted || vimOwnsInput(view)) return false;
  const state = view.state;
  if (state.readOnly || !singleCaretAt(state, from, to)) return false;
  const port = snippetPort(state);
  if (!port?.enabled().auto || yielded(state)) return false;
  const lookup = snippetLookup(state, from, text);
  if (!lookup) return false;
  const hits = autoCandidates(lookup.index, lookup.ctx, text, (record) => port.reportSlowRegex(record));
  const hit = hits.find((candidate) => fitsAt(state, candidate.record, lookup.offset + candidate.from, lookup.language));
  if (!hit) {
    if (text === "{" && lookup.ctx.lineBefore.endsWith(HAND_TYPED_FRACTION)) port.onHandTypedFraction();
    return false;
  }
  const typing = insert();
  view.dispatch(typing);
  const start = typing.changes.mapPos(lookup.offset + hit.from, -1);
  const caret = view.state.selection.main.head;
  const typed = view.state.sliceDoc(start, caret);
  const depth = snippetSessions(view.state).length;
  insertSnippet(view, hit.record, start, caret, "auto", {
    captures: hit.captures,
    rangeEffect: (from, to) => setAutoExpansion.of({ from, to, typed, depth }),
  });
  port.onAutoExpanded(hit.record);
  return true;
}

export function restoreAutoTrigger(view: EditorView): boolean {
  const last = view.state.field(lastAutoExpansion, false);
  if (!last || vimOwnsInput(view) || view.state.readOnly) return false;
  view.dispatch({
    changes: { from: last.from, to: last.to, insert: last.typed },
    selection: EditorSelection.cursor(last.from + last.typed.length),
    effects: snippetSessions(view.state).length > last.depth ? popSnippetSession.of(null) : [],
    userEvent: "delete.backward",
    scrollIntoView: true,
  });
  return true;
}

const autoExtension: Extension = [
  lastAutoExpansion,
  Prec.high(EditorView.inputHandler.of(expand)),
  Prec.highest(keymap.of([{ key: "Backspace", run: restoreAutoTrigger }])),
];

export function snippetAutoExpand(): Extension {
  return autoExtension;
}
