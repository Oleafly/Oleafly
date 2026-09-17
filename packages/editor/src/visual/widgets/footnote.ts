import { editorMessage } from "../../messages";
import { InlineWidget } from "./base";

export type NoteKind = "footnote" | "endnote";

const MARKS: Record<NoteKind, string> = {
  footnote: "*",
  endnote: "†",
};

export class FootnoteWidget extends InlineWidget {
  constructor(readonly kind: NoteKind = "footnote") {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "ofl-visual-footnote";
    element.setAttribute("role", "button");
    this.fill(element);
    return element;
  }

  eq(other: FootnoteWidget): boolean {
    return other.kind === this.kind;
  }

  updateDOM(element: HTMLElement): boolean {
    this.fill(element);
    return true;
  }

  private fill(element: HTMLElement): void {
    element.textContent = MARKS[this.kind];
    element.title = editorMessage(this.kind === "footnote" ? "visual.footnote" : "visual.endnote");
  }
}
