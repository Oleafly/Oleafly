import { ChangeSet, type EditorSelection, EditorState, type Extension, Prec, StateEffect, StateField, type Text, Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView, KeyBinding } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import type { Mark } from "@tiptap/pm/model";
import { lazyExtension, lazyExtensionFilled, reportEditorError } from "@oleafly/editor";
import type { EngineFormattingAction } from "@/lib/document-engine";
import { sameEditorKey, useEditorKeymapStore } from "@/store/editor-keymap";
import type { MarkdownTarget } from "./markdown-model";

type Engine = typeof import("./markdown-model");

export interface TypedKey {
  from: number;
  to: number;
  text: string;
  head: number;
  kind: "type" | "delete" | "cut" | "enter" | "paste";
  doc: Text;
}

export interface PendingTyping {
  from: number;
  to: number;
  marks: readonly Mark[];
  idle: boolean;
  replace(key: TypedKey): TransactionSpec | null;
}

export type Held = PendingTyping & { doc: Text; composed?: number };

export const pendingTyping = StateEffect.define<PendingTyping>();

const pendingField = StateField.define<Held | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(pendingTyping)) return { ...effect.value, doc: tr.newDoc };
    if (!value || (tr.reconfigured && !tr.effects.some((effect) => effect.is(lazyExtensionFilled)))) return null;
    if (tr.isUserEvent("input.type.compose")) {
      let inside = true;
      const end = value.composed ?? value.to;
      tr.changes.iterChangedRanges((from, to) => {
        if (from < value.from || to > end) inside = false;
      });
      return inside ? { ...value, composed: tr.changes.mapPos(end, 1) } : null;
    }
    if (tr.docChanged) return null;
    const main = tr.selection?.main;
    return !main || (tr.selection?.ranges.length === 1 && main.from === value.from && main.to === value.to) ? value : null;
  },
});

export function heldAt(state: EditorState): Held | null {
  return state.field(pendingField, false) ?? null;
}

export function pendingAt(state: EditorState): PendingTyping | null {
  const pending = heldAt(state);
  return pending && pending.doc === state.doc && pending.composed === undefined ? pending : null;
}

function keyKind(tr: Transaction): TypedKey["kind"] | null {
  if (tr.isUserEvent("input.type.compose")) return null;
  if (tr.isUserEvent("input.type")) return "type";
  if (tr.isUserEvent("delete.cut")) return "cut";
  if (tr.isUserEvent("delete")) return "delete";
  if (tr.isUserEvent("input.paste")) return "paste";
  return tr.annotation(Transaction.userEvent) === "input" ? "enter" : null;
}

const typingThroughModel = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  const kind = keyKind(tr);
  const queue = kind && waiting.find((entry) => entry.view.state === tr.startState);
  if (queue) {
    waiting.push({ view: queue.view, state: tr.startState, typed: tr });
    return [];
  }
  const pending = kind && pendingAt(tr.startState);
  const selection = tr.newSelection;
  if (!kind || !pending || selection.ranges.length > 1 || !selection.main.empty) return tr;
  const changes: { from: number; to: number; text: string }[] = [];
  tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => changes.push({ from, to, text: inserted.toString() }));
  if (changes.length !== 1) return tr;
  const spec = pending.replace({ ...changes[0], head: selection.main.head, kind, doc: tr.newDoc });
  return spec ? [{ changes: tr.changes, selection: tr.selection, effects: tr.effects, scrollIntoView: tr.scrollIntoView, userEvent: tr.annotation(Transaction.userEvent) }, { ...spec, sequential: true }] : tr;
});

let engine: Engine | null = null;
let loading: Promise<Engine | null> | null = null;

function loadEngine(): Promise<Engine | null> {
  loading ??= import("./markdown-model").then(
    (loaded) => {
      engine = loaded;
      return loaded;
    },
    (error: unknown) => {
      loading = null;
      reportEditorError("markdown toolbar", error);
      return null;
    },
  );
  return loading;
}

export function editorKeyTaken(key: string): boolean {
  return Object.values(useEditorKeymapStore.getState().keys).some((bound) => sameEditorKey(bound, key));
}

type Act = (target: MarkdownTarget) => void;

const waiting: { view: EditorView; state: EditorState; acts?: readonly Act[]; typed?: Transaction }[] = [];

function idleOnly(spec: TransactionSpec): boolean {
  return !spec.changes && [spec.effects ?? []].flat().every((effect) => effect.is(pendingTyping) && effect.value.idle);
}

function applied(loaded: Engine, view: EditorView, acts: readonly Act[], state: EditorState): Transaction | null {
  let fallback: TransactionSpec | null = null;
  for (const act of acts) {
    const spec = loaded.modelEdit(state, act);
    if (spec && !idleOnly(spec)) {
      fallback = spec;
      break;
    }
    fallback ??= spec;
  }
  if (!fallback) return null;
  const tr = view.state.update({ selection: state.selection }, fallback);
  view.dispatch(tr);
  return tr;
}

function replayed(view: EditorView, typed: Transaction, moved: ChangeSet): Transaction {
  const changes = typed.changes.map(moved);
  const head = typed.newSelection.main.head;
  let anchor: number | undefined;
  typed.changes.iterChanges((_fromA, _toA, fromB, toB) => {
    if (head >= fromB && head <= toB) changes.iterChanges((_from, _to, start) => {
      anchor ??= start + head - fromB;
    });
  });
  return view.state.update({ changes, selection: anchor === undefined ? undefined : { anchor }, userEvent: typed.annotation(Transaction.userEvent) });
}

function drain(loaded: Engine | null) {
  const runs = new Map<EditorView, { doc: Text; at: Text; moved: ChangeSet; live: EditorSelection; last: EditorSelection }>();
  for (const { view, state, acts, typed } of waiting.splice(0)) {
    const run = runs.get(view) ?? { doc: state.doc, at: state.doc, moved: ChangeSet.empty(state.doc.length), live: view.state.selection, last: state.selection };
    runs.set(view, run);
    if (state.doc !== run.doc || view.state.doc !== run.at) continue;
    run.last = state.selection;
    try {
      const tr = typed ? replayed(view, typed, run.moved) : loaded && acts ? applied(loaded, view, acts, view.state.update({ selection: state.selection.map(run.moved) }).state) : null;
      if (!tr) continue;
      if (typed) view.dispatch(tr);
      run.moved = run.moved.compose(tr.changes);
      run.at = view.state.doc;
    } catch (error) {
      reportEditorError("markdown toolbar", error);
    }
  }
  for (const [view, run] of runs) if (!run.live.eq(run.last) && view.state.doc === run.at) view.dispatch({ selection: run.live.map(run.moved) });
}

function formatNow(view: EditorView, ...acts: Act[]) {
  const { state } = view;
  if (state.readOnly) return;
  if (engine && waiting.length === 0) {
    applied(engine, view, acts, state);
    return;
  }
  waiting.push({ view, acts, state });
  void loadEngine().then(drain);
}

const ENGINE_ACTIONS: Readonly<Record<EngineFormattingAction, (target: MarkdownTarget) => void>> = {
  bold: (target) => target.bold(),
  italic: (target) => target.italic(),
  section: (target) => target.heading(1),
  list: (target) => target.bullet(),
};

export function runMarkdownFormatting(view: EditorView | null, action: EngineFormattingAction) {
  if (view) formatNow(view, ENGINE_ACTIONS[action]);
}

function format(key: string, ...acts: Act[]): KeyBinding {
  return {
    key,
    run: (view) => {
      if (editorKeyTaken(key)) return false;
      formatNow(view, ...acts);
      return true;
    },
  };
}

const handoffExtras = lazyExtension(async () => {
  if (!(await loadEngine())) throw new Error("the Markdown toolbar did not load");
  return (await import("./markdown-typing")).handoffExtras;
});

export const markdownFormatKeymap: Extension = [
  pendingField,
  typingThroughModel,
  handoffExtras(),
  Prec.high(
    keymap.of([
      format("Mod-b", (target) => target.bold()),
      format("Mod-i", (target) => target.italic()),
      format("Mod-Shift-i", (target) => target.italic()),
      format("Mod-u", (target) => target.underline()),
      format("Mod-Shift-u", (target) => target.underline()),
      format("Mod-e", (target) => target.code()),
      format("Mod-Shift-s", (target) => target.strike()),
      format("Mod-.", (target) => target.superscript()),
      format("Mod-Shift-,", (target) => target.subscript()),
      format("Mod-Alt-0", (target) => target.paragraph()),
      ...[1, 2, 3, 4, 5, 6].map((level) => format(`Mod-Alt-${level}`, (target) => target.heading(level))),
      format("Mod-Shift-7", (target) => target.ordered()),
      format("Mod-Shift-8", (target) => target.bullet()),
      format("Mod-Shift-b", (target) => target.quote(), (target) => target.bold()),
      format("Mod-Alt-c", (target) => target.codeBlock()),
    ]),
  ),
];
