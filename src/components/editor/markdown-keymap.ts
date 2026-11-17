import { type Extension, EditorState, Prec, StateEffect, StateField, type Text, Transaction, type TransactionSpec } from "@codemirror/state";
import { type EditorView, type KeyBinding, ViewPlugin, keymap } from "@codemirror/view";
import type { EngineFormattingAction } from "@/lib/document-engine";
import { sameEditorKey, useEditorKeymapStore } from "@/store/editor-keymap";
import type { MarkdownTarget } from "./markdown-model";

type Engine = typeof import("./markdown-model");

export interface PendingTyping {
  from: number;
  to: number;
  replace(inserted: string): TransactionSpec | null;
}

export const pendingTyping = StateEffect.define<PendingTyping>();

const pendingField = StateField.define<(PendingTyping & { doc: Text }) | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(pendingTyping)) return { ...effect.value, doc: tr.newDoc };
    return tr.docChanged || tr.selection ? null : value;
  },
});

const typingThroughModel = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.isUserEvent("input.type.compose") || !(tr.isUserEvent("input.type") || tr.isUserEvent("delete"))) return tr;
  const pending = tr.startState.field(pendingField, false);
  if (!pending || pending.doc !== tr.startState.doc) return tr;
  const changes: { from: number; to: number; text: string }[] = [];
  tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => changes.push({ from, to, text: inserted.toString() }));
  const [only] = changes;
  if (changes.length !== 1 || only.from !== pending.from || only.to !== pending.to || tr.effects.length > 0) return tr;
  if (tr.selection && tr.selection.main.head !== only.from + only.text.length) return tr;
  const spec = pending.replace(only.text);
  return spec ? { ...spec, userEvent: tr.annotation(Transaction.userEvent) } : tr;
});

let engine: Engine | null = null;
let loading: Promise<Engine> | null = null;

function loadEngine(): Promise<Engine> {
  loading ??= import("./markdown-model").then((loaded) => {
    engine = loaded;
    return loaded;
  });
  return loading;
}

function editorKeyTaken(key: string): boolean {
  return Object.values(useEditorKeymapStore.getState().keys).some((bound) => sameEditorKey(bound, key));
}

type Act = (target: MarkdownTarget) => void;

const waiting: { view: EditorView; acts: readonly Act[]; state: EditorState }[] = [];

function applied(loaded: Engine, view: EditorView, acts: readonly Act[], state: EditorState): boolean {
  for (const act of acts) {
    const spec = loaded.modelEdit(state, act);
    if (spec) {
      view.dispatch(spec);
      return true;
    }
  }
  return false;
}

function drain(loaded: Engine) {
  const after = new Map<EditorView, Text>();
  for (const { view, acts, state } of waiting.splice(0)) {
    const ours = after.get(view);
    if (view.state.doc !== (ours ?? state.doc)) continue;
    applied(loaded, view, acts, ours ? view.state : state);
    after.set(view, view.state.doc);
  }
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

export const markdownFormatKeymap: Extension = [
  pendingField,
  typingThroughModel,
  ViewPlugin.define(() => {
    void loadEngine();
    return {};
  }),
  Prec.high(
    keymap.of([
      format("Mod-b", (target) => target.bold()),
      format("Mod-i", (target) => target.italic()),
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
