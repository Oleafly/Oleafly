import type { EditorView } from "@codemirror/view";
import { BlockWidget } from "./base";

function environmentClass(environment: string): string {
  return `ofl-visual-begin-${environment.replace(/[^\w-]/gu, "")}`;
}

export class BeginWidget extends BlockWidget {
  constructor(
    readonly environment: string,
    readonly name: string,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("div");
    this.build(element, view);
    this.placeCursorOnClick(element, view);
    return element;
  }

  eq(other: BeginWidget): boolean {
    return other.environment === this.environment && other.name === this.name;
  }

  updateDOM(element: HTMLElement, view: EditorView): boolean {
    element.replaceChildren();
    element.className = "";
    this.build(element, view);
    return true;
  }

  protected buildName(name: HTMLElement, _view: EditorView): void {
    name.textContent = this.name;
  }

  private build(element: HTMLElement, view: EditorView): void {
    element.classList.add("ofl-visual-begin", environmentClass(this.environment));
    const lead = document.createElement("span");
    lead.className = "ofl-visual-environment-padding ofl-visual-environment-lead";
    const name = document.createElement("span");
    name.className = "ofl-visual-environment-name";
    this.buildName(name, view);
    const trail = document.createElement("span");
    trail.className = "ofl-visual-environment-padding ofl-visual-environment-trail";
    element.append(lead, name, trail);
  }
}
