import { InlineWidget } from "./base";

export class DescriptionItemWidget extends InlineWidget {
  constructor(readonly depth: number) {
    super();
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "ofl-visual-description-item";
    this.applyProperties(element);
    return element;
  }

  eq(other: DescriptionItemWidget): boolean {
    return other.depth === this.depth;
  }

  updateDOM(element: HTMLElement): boolean {
    this.applyProperties(element);
    return true;
  }

  private applyProperties(element: HTMLElement): void {
    element.style.setProperty("--ofl-list-depth", String(this.depth));
  }
}
