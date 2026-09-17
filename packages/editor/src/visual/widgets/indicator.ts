import { InlineWidget } from "./base";

export class IndicatorWidget extends InlineWidget {
  constructor(readonly content: string) {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "ofl-visual-indicator";
    element.textContent = this.content;
    return element;
  }

  eq(other: IndicatorWidget): boolean {
    return other.content === this.content;
  }

  updateDOM(element: HTMLElement): boolean {
    element.textContent = this.content;
    return true;
  }
}
