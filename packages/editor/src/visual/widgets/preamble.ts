import { EditorSelection, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { type EditorMessageKey, editorMessage } from "../../messages";
import { BlockWidget } from "./base";
import { createIcon } from "./icons";

export interface PreambleEntry {
  node: SyntaxNode;
  content: string;
}

export interface Preamble {
  from: number;
  to: number;
  title?: PreambleEntry;
  authors: PreambleEntry[];
}

export const collapsePreambleEffect = StateEffect.define<boolean>();

export interface PreambleLabels {
  show: EditorMessageKey;
  hide: EditorMessageKey;
}

const LATEX_PREAMBLE_LABELS: PreambleLabels = { show: "visual.preamble.show", hide: "visual.preamble.hide" };

export class PreambleWidget extends BlockWidget {
  constructor(
    readonly expanded: boolean,
    readonly labels: PreambleLabels = LATEX_PREAMBLE_LABELS,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.classList.add("ofl-visual-preamble-wrapper");
    wrapper.classList.toggle("ofl-visual-preamble-expanded", this.expanded);

    const bar = document.createElement("div");
    bar.className = "ofl-visual-preamble-widget";
    bar.setAttribute("role", "button");
    bar.setAttribute("aria-expanded", String(this.expanded));

    const text = document.createElement("span");
    text.className = "ofl-visual-preamble-text";
    text.textContent = editorMessage(this.expanded ? this.labels.hide : this.labels.show);

    bar.append(text, createIcon("chevron", "ofl-visual-preamble-chevron"));
    wrapper.append(bar);

    bar.addEventListener("mouseup", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      if (this.expanded) {
        view.dispatch({ effects: collapsePreambleEffect.of(true) });
      } else {
        view.dispatch({ selection: EditorSelection.cursor(0), scrollIntoView: true });
      }
    });

    return wrapper;
  }

  eq(other: PreambleWidget): boolean {
    return (
      other.expanded === this.expanded &&
      other.labels.show === this.labels.show &&
      other.labels.hide === this.labels.hide
    );
  }

  get estimatedHeight(): number {
    return this.expanded ? -1 : 44;
  }
}
