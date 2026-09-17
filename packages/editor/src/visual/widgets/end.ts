import { WidgetType } from "@codemirror/view";

export class EndWidget extends WidgetType {
  toDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "ofl-visual-end";
    return element;
  }

  eq(): boolean {
    return true;
  }

  coordsAt(element: HTMLElement): DOMRect {
    return element.getBoundingClientRect();
  }
}
