import type { EditorView } from "@tiptap/pm/view";

const SELECTION_MARGIN_PX = 48;

/**
 * ProseMirror's default scroll-to-selection implementation walks every
 * ancestor and ends by calling `window.scrollBy`. In Oleafly the Visual editor
 * lives inside its own `.wysiwyg-content` scroller, so only that element may
 * move. Returning true tells ProseMirror the request is fully handled.
 */
export function scrollVisualSelectionLocally(view: EditorView): boolean {
  const scroller = view.dom.closest<HTMLElement>(".wysiwyg-content");
  if (!scroller) return true;

  let selectionRect: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  try {
    selectionRect = view.coordsAtPos(view.state.selection.head, 1);
  } catch {
    return true;
  }

  const viewport = scroller.getBoundingClientRect();
  let deltaY = 0;
  let deltaX = 0;
  if (selectionRect.top < viewport.top + SELECTION_MARGIN_PX) {
    deltaY =
      selectionRect.top - viewport.top - SELECTION_MARGIN_PX;
  } else if (
    selectionRect.bottom >
    viewport.bottom - SELECTION_MARGIN_PX
  ) {
    deltaY =
      selectionRect.bottom -
      viewport.bottom +
      SELECTION_MARGIN_PX;
  }
  if (selectionRect.left < viewport.left + SELECTION_MARGIN_PX) {
    deltaX =
      selectionRect.left - viewport.left - SELECTION_MARGIN_PX;
  } else if (
    selectionRect.right >
    viewport.right - SELECTION_MARGIN_PX
  ) {
    deltaX =
      selectionRect.right -
      viewport.right +
      SELECTION_MARGIN_PX;
  }

  if (deltaY) scroller.scrollTop += deltaY;
  if (deltaX) scroller.scrollLeft += deltaX;
  return true;
}
