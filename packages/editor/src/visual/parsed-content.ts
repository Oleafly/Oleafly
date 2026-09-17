import { forceParsing, syntaxTree } from "@codemirror/language";
import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

const REVEAL_FALLBACK_MS = 5000;

export const contentParsedEffect = StateEffect.define<boolean>();

export const contentParsedField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(contentParsedEffect)) next = effect.value;
    }
    return next;
  },
});

const revealPlugin = ViewPlugin.define((view) => {
  let done = false;
  const reveal = () => {
    if (done) return;
    done = true;
    view.dispatch({ effects: contentParsedEffect.of(true) });
  };
  const fallback = window.setTimeout(reveal, REVEAL_FALLBACK_MS);
  window.setTimeout(() => {
    if (done) return;
    if (syntaxTree(view.state).length < view.state.doc.length) {
      forceParsing(view, view.state.doc.length, Number.POSITIVE_INFINITY);
    }
    window.clearTimeout(fallback);
    window.setTimeout(reveal);
  });
  return {
    destroy() {
      done = true;
      window.clearTimeout(fallback);
    },
  };
});

export const contentShownWhenParsed: Extension = [
  contentParsedField,
  EditorView.editorAttributes.from(contentParsedField, (parsed) => () => (parsed ? { class: "ofl-visual-parsed" } : null)),
  revealPlugin,
];
