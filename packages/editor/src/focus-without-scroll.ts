import { EditorView, ViewPlugin } from "@codemirror/view";

interface ScrollPosition {
  readonly element: Element;
  readonly top: number;
  readonly left: number;
}

const OWN_FOCUS = "input, textarea, select, button, [contenteditable='true']";

function scrollPositions(from: Element): ScrollPosition[] {
  const positions: ScrollPosition[] = [];
  for (let element: Element | null = from; element; element = element.parentElement) {
    positions.push({ element, top: element.scrollTop, left: element.scrollLeft });
  }
  const root = from.ownerDocument.scrollingElement;
  if (root && !positions.some((position) => position.element === root)) {
    positions.push({ element: root, top: root.scrollTop, left: root.scrollLeft });
  }
  return positions;
}

function restoreScroll(positions: readonly ScrollPosition[]): void {
  for (const { element, top, left } of positions) {
    if (element.scrollTop !== top) element.scrollTop = top;
    if (element.scrollLeft !== left) element.scrollLeft = left;
  }
}

export function focusWithoutScroll(view: EditorView): void {
  if (view.root.activeElement === view.contentDOM) return;
  const positions = scrollPositions(view.scrollDOM);
  view.contentDOM.focus({ preventScroll: true });
  restoreScroll(positions);
}

function startsTextSelection(view: EditorView, target: EventTarget | null): boolean {
  if (target === view.scrollDOM) return true;
  if (!(target instanceof Element) || !view.contentDOM.contains(target)) return false;
  const own = target.closest(OWN_FOCUS);
  return !own || own === view.contentDOM || !view.contentDOM.contains(own);
}

export const focusOnPointerWithoutScroll = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      view.scrollDOM.addEventListener("mousedown", this.onMouseDown, true);
    }

    onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || !startsTextSelection(this.view, event.target)) return;
      focusWithoutScroll(this.view);
    };

    destroy() {
      this.view.scrollDOM.removeEventListener("mousedown", this.onMouseDown, true);
    }
  },
);
