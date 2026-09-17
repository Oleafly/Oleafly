import type { EditorView } from "@codemirror/view";
import { selectNodeContent } from "../selection";
import { typesetNodeInto } from "../typeset";
import { BlockWidget } from "./base";
import type { Preamble, PreambleEntry } from "./preamble";

function samePreamble(left: Preamble, right: Preamble): boolean {
  if (left.title?.content !== right.title?.content) return false;
  if (left.authors.length !== right.authors.length) return false;
  return left.authors.every((author, index) => author.content === right.authors[index]?.content);
}

function buildTitle(view: EditorView, title: PreambleEntry): HTMLElement {
  const element = document.createElement("div");
  element.className = "ofl-visual-title";
  typesetNodeInto(title.node, element, view.state);
  element.addEventListener("mouseup", () => selectNodeContent(view, title.node));
  return element;
}

function buildAuthors(view: EditorView, authors: PreambleEntry[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "ofl-visual-authors";
  for (const author of authors) {
    const typeset = typesetNodeInto(author.node, document.createElement("div"), view.state);
    let current = document.createElement("div");
    current.className = "ofl-visual-author";
    row.append(current);
    while (typeset.firstChild) {
      const child = typeset.firstChild;
      if (child instanceof HTMLElement && child.classList.contains("ofl-visual-command-and")) {
        child.remove();
        current = document.createElement("div");
        current.className = "ofl-visual-author";
        row.append(current);
      } else {
        current.append(child);
      }
    }
    for (const element of row.querySelectorAll<HTMLElement>(".ofl-visual-author")) {
      if (!element.dataset.bound) {
        element.dataset.bound = "true";
        element.addEventListener("mouseup", () => selectNodeContent(view, author.node));
      }
    }
  }
  return row;
}

export class MakeTitleWidget extends BlockWidget {
  constructor(readonly preamble: Preamble) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("div");
    element.className = "ofl-visual-maketitle";
    this.fill(element, view);
    return element;
  }

  eq(other: MakeTitleWidget): boolean {
    return samePreamble(other.preamble, this.preamble);
  }

  updateDOM(element: HTMLElement, view: EditorView): boolean {
    element.replaceChildren();
    this.fill(element, view);
    view.requestMeasure();
    return true;
  }

  private fill(element: HTMLElement, view: EditorView): void {
    if (this.preamble.title) element.append(buildTitle(view, this.preamble.title));
    if (this.preamble.authors.length > 0) element.append(buildAuthors(view, this.preamble.authors));
  }
}
