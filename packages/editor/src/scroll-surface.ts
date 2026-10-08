import { forceParsing, syntaxTreeAvailable } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import {
  attachOverlayScrollbar,
  NATIVE_SCROLLBAR_HIDDEN_CLASS,
  type OverlayScrollbarHandle,
} from "./overlay-scrollbar";

const nativeScrollbarHidden = EditorView.baseTheme({
  [`.cm-scroller.${NATIVE_SCROLLBAR_HIDDEN_CLASS}`]: {
    scrollbarWidth: "none",
  },
  [`.cm-scroller.${NATIVE_SCROLLBAR_HIDDEN_CLASS}::-webkit-scrollbar`]: {
    display: "none",
    width: "0",
    height: "0",
  },
});

const overlayScrollbarPlugin = ViewPlugin.fromClass(
  class {
    private readonly handle: OverlayScrollbarHandle;

    constructor(view: EditorView) {
      this.handle = attachOverlayScrollbar({
        scroller: view.scrollDOM,
        host: view.dom,
        axes: ["y", "x"],
        observe: [view.contentDOM],
      });
    }

    update(update: ViewUpdate) {
      if (update.geometryChanged || update.heightChanged || update.viewportChanged) {
        this.handle.update();
      }
    }

    destroy() {
      this.handle.destroy();
    }
  },
);

export function editorOverlayScrollbars(): Extension {
  return [nativeScrollbarHidden, overlayScrollbarPlugin];
}

export const FULL_PARSE_SLICE_MS = 4;
export const FULL_PARSE_PAUSE_MS = 12;
export const FULL_PARSE_MAX_LENGTH = 3_000_000;

const fullParsePlugin = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly view: EditorView) {
      this.schedule();
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.schedule();
    }

    destroy() {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
    }

    private complete(): boolean {
      const { state } = this.view;
      return state.doc.length > FULL_PARSE_MAX_LENGTH || syntaxTreeAvailable(state, state.doc.length);
    }

    private schedule() {
      if (this.timer !== null || this.complete()) return;
      this.timer = setTimeout(this.step, FULL_PARSE_PAUSE_MS);
    }

    private readonly step = () => {
      this.timer = null;
      if (this.complete()) return;
      forceParsing(this.view, this.view.state.doc.length, FULL_PARSE_SLICE_MS);
      this.schedule();
    };
  },
);

export function backgroundFullParse(): Extension {
  return fullParsePlugin;
}
