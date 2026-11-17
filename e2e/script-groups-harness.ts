import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { latexLanguage } from "/packages/editor/src/latex.ts";
import { latexPairInputHandler, latexPairKeymap } from "/packages/editor/src/latex-pairs.ts";
import { latexScriptGroups } from "/packages/editor/src/latex-scripts.ts";
import { typstLanguage } from "/packages/editor/src/typst.ts";
import { typstEditing } from "/packages/editor/src/typst-editing.ts";
import { typstScriptGroups } from "/packages/editor/src/typst-scripts.ts";

type Engine = "latex" | "typst";

let view: EditorView | null = null;

function engineExtensions(engine: Engine): Extension[] {
  if (engine === "typst") {
    return [typstLanguage(), typstScriptGroups(), typstEditing({ math: true, wrap: true })];
  }
  return [
    latexLanguage(),
    latexScriptGroups(),
    latexPairInputHandler({ math: true, brackets: true }),
    Prec.highest(keymap.of(latexPairKeymap)),
  ];
}

function mount(engine: Engine, doc: string, caret: number): void {
  view?.destroy();
  const host = document.getElementById("host");
  if (!host) throw new Error("host is missing");
  view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: [
        history(),
        closeBrackets(),
        ...engineExtensions(engine),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
      ],
    }),
  });
  view.focus();
}

function snapshot(): { doc: string; head: number } {
  if (!view) throw new Error("no editor is mounted");
  return { doc: view.state.doc.toString(), head: view.state.selection.main.head };
}

Object.assign(window, { __scriptGroups: { mount, snapshot } });
document.body.dataset.fixtureState = "mounted";
