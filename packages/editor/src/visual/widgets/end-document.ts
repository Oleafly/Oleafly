import type { EditorView } from "@codemirror/view";
import { editorMessage } from "../../messages";
import { BlockWidget } from "./base";

export class EndDocumentWidget extends BlockWidget {
  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("div");
    element.className = "ofl-visual-end-document";
    element.textContent = editorMessage("visual.endOfDocument");
    this.placeCursorOnClick(element, view);
    return element;
  }

  eq(): boolean {
    return true;
  }

  get estimatedHeight(): number {
    return 32;
  }
}
