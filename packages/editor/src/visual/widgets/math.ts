import { type EditorView, WidgetType } from "@codemirror/view";
import { type MathRenderResult, renderMathSource } from "../../math-render";
import { placeSelectionInsideBlock } from "../selection";

// Labels, references and environments KaTeX lacks are handled by the shared
// renderer, so the tooltip, this widget and the hover card agree.
export function renderVisualMath(source: string, display: boolean): MathRenderResult {
  return renderMathSource(source, display);
}

export function replaceWithMarkup(element: HTMLElement, html: string): void {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  element.replaceChildren(...Array.from(parsed.body.childNodes));
}

export function paintMath(element: HTMLElement, source: string, display: boolean): MathRenderResult {
  const result = renderVisualMath(source, display);
  element.classList.toggle("ofl-visual-math-error", result.status !== "ready");
  if (result.status === "ready") {
    element.removeAttribute("title");
    replaceWithMarkup(element, result.html);
  } else {
    element.textContent = source;
    if (result.message) element.title = result.message;
  }
  return result;
}

export class MathWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly display: boolean,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const element: HTMLElement = document.createElement(this.display ? "div" : "span");
    element.className = `ofl-visual-math ofl-visual-math-${this.display ? "display" : "inline"}`;
    paintMath(element, this.source, this.display);
    if (this.display) {
      element.addEventListener("mouseup", (event) => {
        event.preventDefault();
        view.dispatch(placeSelectionInsideBlock(view, event));
      });
    }
    return element;
  }

  eq(other: MathWidget): boolean {
    return other.source === this.source && other.display === this.display;
  }

  updateDOM(element: HTMLElement): boolean {
    paintMath(element, this.source, this.display);
    return true;
  }

  ignoreEvent(event: Event): boolean {
    if (event.type === "mouseup") return false;
    return this.display || event.type !== "mousedown";
  }

  coordsAt(element: HTMLElement): DOMRect {
    return element.getBoundingClientRect();
  }

  get estimatedHeight(): number {
    return this.display ? this.source.split("\n").length * 40 : -1;
  }
}
