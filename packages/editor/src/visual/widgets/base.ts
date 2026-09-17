import { type EditorView, WidgetType } from "@codemirror/view";
import { placeSelectionInsideBlock } from "../selection";

export abstract class InlineWidget extends WidgetType {
  ignoreEvent(event: Event): boolean {
    return event.type !== "mousedown" && event.type !== "mouseup";
  }

  coordsAt(element: HTMLElement): DOMRect {
    return element.getBoundingClientRect();
  }
}

export abstract class BlockWidget extends WidgetType {
  ignoreEvent(event: Event): boolean {
    return event.type !== "mouseup";
  }

  coordsAt(element: HTMLElement): DOMRect {
    return element.getBoundingClientRect();
  }

  protected placeCursorOnClick(element: HTMLElement, view: EditorView): void {
    element.addEventListener("mouseup", (event) => {
      event.preventDefault();
      view.dispatch(placeSelectionInsideBlock(view, event));
    });
  }
}
