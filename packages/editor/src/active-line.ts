import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";

const activeLine = Decoration.line({ class: "cm-activeLine" });

function activeLineDecorations(view: EditorView): DecorationSet {
  // CodeMirror draws the selection in a layer with a negative z-index, but
  // `.cm-activeLine` is a background on the line element itself, which paints
  // above it. Keeping the highlight during a selection therefore composites the
  // active-line tint over the selection colour, and the cursor's line reads as a
  // different shade from every other selected line. Editors resolve this by
  // dropping the current-line highlight while a selection exists.
  if (view.state.selection.ranges.some((range) => !range.empty)) return Decoration.none;

  const decorations = [];
  let lastLineStart = -1;
  for (const range of view.state.selection.ranges) {
    const line = view.lineBlockAt(range.head);
    if (line.from > lastLineStart) {
      decorations.push(activeLine.range(line.from));
      lastLineStart = line.from;
    }
  }
  return Decoration.set(decorations);
}

/**
 * `highlightActiveLine()` from @codemirror/view, minus the highlight while text
 * is selected. Same decoration and class, so themes need no change.
 */
export function highlightActiveLineWhenCollapsed() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = activeLineDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) {
          this.decorations = activeLineDecorations(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
