import { InlineWidget } from "./base";

export class BibItemWidget extends InlineWidget {
  constructor(readonly label: string) {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "ofl-visual-bibitem";
    element.textContent = `[${this.label}]`;
    return element;
  }

  eq(other: BibItemWidget): boolean {
    return other.label === this.label;
  }

  updateDOM(element: HTMLElement): boolean {
    element.textContent = `[${this.label}]`;
    return true;
  }
}
