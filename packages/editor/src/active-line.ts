import { EditorView, ViewPlugin, highlightActiveLine } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";

/** Set on the editor while any selection range is non-empty. */
export const HAS_SELECTION_CLASS = "cm-has-selection";

/**
 * CodeMirror draws the selection in a layer with a negative z-index, but
 * `.cm-activeLine` is a background on the line element itself, which paints
 * above it. Left alone, the active-line tint composites over the selection and
 * the cursor's line reads as a different shade from every other selected line.
 *
 * The obvious fix - dropping the decoration while a selection exists - works
 * visually but changes the decoration set on every selection change, and each
 * change costs CodeMirror a measure pass. Under rapid navigate/type churn that
 * showed up as gutter rows briefly out of step with their lines.
 *
 * So the decoration stays put and only a class on the editor moves. Styling is
 * a recalc, not a re-measure, so the line/gutter geometry is untouched.
 */
const selectionStateClass = ViewPlugin.fromClass(
  class {
    private applied = false;

    constructor(view: EditorView) {
      this.sync(view);
    }

    update(update: ViewUpdate) {
      if (update.selectionSet || update.docChanged) this.sync(update.view);
    }

    destroy() {
      // The view outlives this plugin on reconfigure; do not leave the class on.
      this.applied = false;
    }

    private sync(view: EditorView) {
      const active = view.state.selection.ranges.some((range) => !range.empty);
      if (active === this.applied) return;
      this.applied = active;
      view.dom.classList.toggle(HAS_SELECTION_CLASS, active);
    }
  },
);

const suppressWhileSelecting = EditorView.theme({
  [`&.${HAS_SELECTION_CLASS} .cm-activeLine`]: {
    backgroundColor: "transparent",
  },
});

/**
 * `highlightActiveLine()` whose highlight yields to a selection, so every
 * selected line shows one uniform colour.
 */
export function highlightActiveLineWhenCollapsed() {
  return [highlightActiveLine(), selectionStateClass, suppressWhileSelecting];
}
