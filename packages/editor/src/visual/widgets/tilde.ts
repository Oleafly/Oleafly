import { InlineWidget } from "./base";

export class TildeWidget extends InlineWidget {
  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "ofl-visual-tilde";
    element.textContent = " ";
    return element;
  }

  eq(): boolean {
    return true;
  }
}
