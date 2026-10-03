import { forceParsing, syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { loadTypstParser } from "../../typst";
import { contentParsedEffect, contentParsedField } from "../parsed-content";
import { isTypstTree } from "./field";

const REVEAL_FALLBACK_MS = 5000;

function parsed(state: EditorState): boolean {
  const tree = syntaxTree(state);
  return isTypstTree(tree) && tree.length >= state.doc.length;
}

class TypstRevealPlugin {
  private done = false;
  private readonly fallback: number;

  constructor(private readonly view: EditorView) {
    this.fallback = window.setTimeout(() => this.reveal(), REVEAL_FALLBACK_MS);
  }

  static start(view: EditorView): TypstRevealPlugin {
    const plugin = new TypstRevealPlugin(view);
    plugin.waitForParser();
    return plugin;
  }

  private waitForParser(): void {
    loadTypstParser().then(
      () => window.setTimeout(() => this.settle()),
      () => this.reveal(),
    );
  }

  update(update: ViewUpdate): void {
    if (!this.done && parsed(update.state)) window.setTimeout(() => this.reveal());
  }

  destroy(): void {
    this.done = true;
    window.clearTimeout(this.fallback);
  }

  private settle(): void {
    if (this.done) return;
    const { state } = this.view;
    if (!parsed(state)) forceParsing(this.view, state.doc.length, 2_000);
    if (parsed(this.view.state)) window.setTimeout(() => this.reveal());
  }

  private reveal(): void {
    if (this.done || !this.view.dom.isConnected) return;
    this.done = true;
    window.clearTimeout(this.fallback);
    this.view.dispatch({ effects: contentParsedEffect.of(true) });
  }
}

export const typstContentShownWhenParsed: Extension = [
  contentParsedField,
  EditorView.editorAttributes.from(contentParsedField, (shown) => () => (shown ? { class: "ofl-visual-parsed" } : null)),
  ViewPlugin.define((view) => TypstRevealPlugin.start(view)),
];
