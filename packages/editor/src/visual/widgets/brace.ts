import { InlineWidget } from "./base";

export class BraceWidget extends InlineWidget {
  constructor(readonly content = "") {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "ofl-visual-brace";
    element.textContent = this.content;
    return element;
  }

  eq(other: BraceWidget): boolean {
    return other.content === this.content;
  }

  updateDOM(element: HTMLElement): boolean {
    element.textContent = this.content;
    return true;
  }
}
