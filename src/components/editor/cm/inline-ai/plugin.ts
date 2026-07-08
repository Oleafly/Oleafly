import { StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { useInlineEditStore } from "@/store/inlineEdit";
import { buildDecoSpans } from "./diff-ranges";

/** Widget rendering an inserted (green) preview span. */
class AddWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: AddWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-inline-add";
    span.textContent = this.text;
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

const setInlineDeco = StateEffect.define<DecorationSet>();

const inlineDecoField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setInlineDeco)) deco = e.value;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Build the decoration set for the current session against the given doc length. */
function buildSet(docLength: number): DecorationSet {
  const s = useInlineEditStore.getState().session;
  if (!s || (s.phase !== "streaming" && s.phase !== "reviewing") || !s.proposed) {
    return Decoration.none;
  }
  const ranges = [];
  for (const sp of buildDecoSpans(s.original, s.proposed, s.from)) {
    if (sp.from > docLength || sp.to > docLength) continue; // out of bounds guard
    if (sp.kind === "del" && sp.to > sp.from) {
      ranges.push(Decoration.mark({ class: "cm-inline-del" }).range(sp.from, sp.to));
    } else if (sp.kind === "add") {
      ranges.push(
        Decoration.widget({ widget: new AddWidget(sp.text ?? ""), side: 1 }).range(sp.from),
      );
    }
  }
  return Decoration.set(ranges, true);
}

/** ViewPlugin that repaints the diff whenever the session store changes. */
const inlineDiffSubscriber = ViewPlugin.fromClass(
  class {
    private unsub: () => void;
    constructor(readonly view: EditorView) {
      this.unsub = useInlineEditStore.subscribe(() => this.repaint());
    }
    private repaint() {
      this.view.dispatch({ effects: setInlineDeco.of(buildSet(this.view.state.doc.length)) });
    }
    destroy() {
      this.unsub();
    }
  },
);

/** Editor extension: renders the inline AI edit diff preview. */
export const inlineDiffPlugin: Extension = [inlineDecoField, inlineDiffSubscriber];

/** Commit the proposed replacement into the document and clear the session. */
export function acceptInlineEdit(view: EditorView): void {
  const s = useInlineEditStore.getState().session;
  if (!s) return;
  view.dispatch({ changes: { from: s.from, to: s.to, insert: s.proposed } });
  useInlineEditStore.getState().reset();
}

/** Discard the proposal; the original text was never mutated. */
export function rejectInlineEdit(_view: EditorView): void {
  useInlineEditStore.getState().reset();
}
