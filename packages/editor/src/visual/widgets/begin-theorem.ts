import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { typesetNodeInto } from "../typeset";
import { BeginWidget } from "./begin";

export class BeginTheoremWidget extends BeginWidget {
  constructor(
    environment: string,
    label: string,
    readonly title: SyntaxNode | null,
    readonly titleText: string,
  ) {
    super(environment, label);
  }

  toDOM(view: EditorView): HTMLElement {
    const element = super.toDOM(view);
    element.classList.add("ofl-visual-begin-theorem");
    return element;
  }

  updateDOM(element: HTMLElement, view: EditorView): boolean {
    super.updateDOM(element, view);
    element.classList.add("ofl-visual-begin-theorem");
    return true;
  }

  eq(other: BeginTheoremWidget): boolean {
    return super.eq(other) && other.titleText === this.titleText;
  }

  protected buildName(name: HTMLElement, view: EditorView): void {
    name.textContent = this.name;
    if (!this.title) return;
    const title = document.createElement("span");
    title.className = "ofl-visual-theorem-title";
    typesetNodeInto(this.title, title, view.state);
    name.append(" (", title, ")");
  }
}
