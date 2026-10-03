import { type EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { paintTypstMath, type TypstMathOutcome, type TypstMathTheme, typstMathTheme } from "../../math-render";
import { placeSelectionInsideBlock } from "../selection";

const cancels = new WeakMap<HTMLElement, () => void>();
const painted = new WeakMap<HTMLElement, { widget: TypstMathWidget; key: string }>();

function themeKey(theme: TypstMathTheme): string {
  return `${theme.color}|${theme.size}`;
}

function styled(view: EditorView): boolean {
  return view.dom.isConnected && view.dom.classList.contains("cm-editor");
}

function showSource(element: HTMLElement, source: string, pending: boolean): void {
  element.classList.toggle("ofl-visual-typst-math-pending", pending);
  element.classList.add("ofl-visual-typst-math-source");
  element.textContent = source;
}

export class TypstMathWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly body: string,
    readonly display: boolean,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const element: HTMLElement = document.createElement(this.display ? "div" : "span");
    element.className = `ofl-visual-math ofl-visual-typst-math ofl-visual-math-${this.display ? "display" : "inline"}`;
    this.paint(element, view);
    if (this.display) {
      element.addEventListener("mouseup", (event) => {
        event.preventDefault();
        view.dispatch(placeSelectionInsideBlock(view, event));
      });
    }
    return element;
  }

  eq(other: TypstMathWidget): boolean {
    return other.body === this.body && other.display === this.display;
  }

  updateDOM(element: HTMLElement, view: EditorView): boolean {
    this.paint(element, view);
    return true;
  }

  destroy(element: HTMLElement): void {
    cancels.get(element)?.();
    cancels.delete(element);
  }

  ignoreEvent(event: Event): boolean {
    if (event.type === "mouseup") return false;
    return this.display || event.type !== "mousedown";
  }

  coordsAt(element: HTMLElement): DOMRect {
    return element.getBoundingClientRect();
  }

  get estimatedHeight(): number {
    return this.display ? Math.max(1, this.source.split("\n").length) * 40 : -1;
  }

  private settle(element: HTMLElement, outcome: TypstMathOutcome): void {
    element.classList.remove("ofl-visual-typst-math-pending");
    element.classList.toggle("ofl-visual-math-error", outcome.status === "failed");
    if (outcome.status === "failed") {
      showSource(element, this.source, false);
      if (outcome.message) element.title = outcome.message;
      return;
    }
    element.classList.remove("ofl-visual-typst-math-source");
    element.removeAttribute("title");
    element.setAttribute("aria-label", this.source);
  }

  paint(element: HTMLElement, view: EditorView): void {
    cancels.get(element)?.();
    cancels.delete(element);
    if (!styled(view)) {
      painted.set(element, { widget: this, key: "" });
      showSource(element, this.source, true);
      queueMicrotask(() => {
        const entry = painted.get(element);
        if (styled(view) && entry?.widget === this && entry.key === "") this.paint(element, view);
      });
      return;
    }
    const theme = typstMathTheme(view.contentDOM);
    painted.set(element, { widget: this, key: themeKey(theme) });
    let painting = true;
    const cancel = paintTypstMath(element, this.body, theme, {
      owner: element,
      errorClass: "ofl-visual-math-error",
      onPaint: (outcome) => {
        this.settle(element, outcome);
        if (!painting && view.dom.isConnected) view.requestMeasure();
      },
    });
    painting = false;
    cancels.set(element, cancel);
    if (element.querySelector(".math-preview-loading")) showSource(element, this.source, true);
  }
}

export function repaintTypstMath(view: EditorView): void {
  if (!styled(view)) return;
  const key = themeKey(typstMathTheme(view.contentDOM));
  for (const element of view.contentDOM.querySelectorAll<HTMLElement>(".ofl-visual-typst-math")) {
    const entry = painted.get(element);
    if (entry && entry.key !== key) entry.widget.paint(element, view);
  }
}

const THEME_ATTRIBUTES = ["class", "style", "data-theme", "data-editor-theme"];

export const typstMathThemeWatcher = ViewPlugin.fromClass(
  class {
    private readonly observer: MutationObserver | null = null;
    private destroyed = false;

    constructor(view: EditorView) {
      if (typeof MutationObserver === "undefined") return;
      const observer = new MutationObserver(() => repaintTypstMath(view));
      this.observer = observer;
      observer.observe(view.dom.ownerDocument.documentElement, {
        attributes: true,
        attributeFilter: THEME_ATTRIBUTES,
      });
      queueMicrotask(() => {
        const themed = view.dom.parentElement?.closest("[data-editor-theme]");
        if (themed && !this.destroyed) observer.observe(themed, { attributes: true, attributeFilter: THEME_ATTRIBUTES });
      });
    }

    destroy(): void {
      this.destroyed = true;
      this.observer?.disconnect();
    }
  },
);
