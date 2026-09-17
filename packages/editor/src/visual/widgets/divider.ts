import { WidgetType } from "@codemirror/view";

export class DividerWidget extends WidgetType {
  toDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "ofl-visual-divider";
    return element;
  }

  eq(): boolean {
    return true;
  }

  updateDOM(): boolean {
    return true;
  }

  coordsAt(element: HTMLElement): DOMRect {
    return element.getBoundingClientRect();
  }
}
