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

function cursorLayer(view: EditorView): HTMLElement | null {
  return view.scrollDOM.querySelector<HTMLElement>(":scope > .cm-cursorLayer");
}

export function cursorFillsLine() {
  return ViewPlugin.fromClass(
    class {
      extend = -1;
      layer: HTMLElement | null = null;

      constructor(readonly view: EditorView) {
        this.measure();
      }

      update(update: ViewUpdate) {
        if (update.selectionSet || update.geometryChanged || update.focusChanged) {
          this.measure();
        }
      }

      measure() {
        this.view.requestMeasure({
          key: this,
          read: measureExtend,
          write: (extend, view) => {
            const layer = cursorLayer(view);
            if (extend === null || !layer) return;
            if (extend === this.extend && layer === this.layer) return;
            this.extend = extend;
            this.layer = layer;
            layer.style.setProperty(CURSOR_EXTEND_PROPERTY, `${extend}px`);
          },
        });
      }

      destroy() {
        this.layer?.style.removeProperty(CURSOR_EXTEND_PROPERTY);
      }
    },
  );
}
