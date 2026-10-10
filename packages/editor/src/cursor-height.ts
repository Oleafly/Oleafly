import { EditorView, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";

export const EDITOR_CURSOR_HEIGHTS = ["text", "line"] as const;

export type EditorCursorHeight = (typeof EDITOR_CURSOR_HEIGHTS)[number];

export const CURSOR_EXTEND_PROPERTY = "--cm-cursor-extend";

export function cursorLineExtend(lineHeight: number, textHeight: number): number {
  return Math.max(0, (lineHeight - textHeight) / 2);
}

function measureExtend(view: EditorView): number | null {
  const { head, assoc } = view.state.selection.main;
  const rect = view.coordsAtPos(head, assoc || 1);
  if (!rect) return null;
  return cursorLineExtend(view.defaultLineHeight, rect.bottom - rect.top);
}

export function cursorFillsLine() {
  return ViewPlugin.fromClass(
    class {
      extend = -1;

      constructor(readonly view: EditorView) {
        this.measure();
      }

      update(update: ViewUpdate) {
        if (update.selectionSet || update.geometryChanged || update.docChanged || update.focusChanged) {
          this.measure();
        }
      }

      measure() {
        this.view.requestMeasure({
          key: this,
          read: measureExtend,
          write: (extend, view) => {
            if (extend === null || extend === this.extend) return;
            this.extend = extend;
            view.dom.style.setProperty(CURSOR_EXTEND_PROPERTY, `${extend}px`);
          },
        });
      }

      destroy() {
        this.view.dom.style.removeProperty(CURSOR_EXTEND_PROPERTY);
      }
    },
  );
}
