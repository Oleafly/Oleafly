import {
  StateEffect,
  type StateEffectType,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { useInlineEditStore } from "@/store/inlineEdit";
import { buildDecoSpans } from "./diff-ranges";
import { promptWidget } from "./promptWidget";

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

// The inline diff (marks + inline widgets) and the block panel widget live in
// SEPARATE fields: a single set mixing block and inline decorations can become
// invalid when a diff span lands at the block widget's line-end position, which
// would silently drop the whole set. Keeping them apart guarantees each set is
// internally valid.
const setDiffDeco = StateEffect.define<DecorationSet>();
const setPanelDeco = StateEffect.define<DecorationSet>();

function decoField(effect: StateEffectType<DecorationSet>) {
  return StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(deco, tr) {
      deco = deco.map(tr.changes);
      for (const e of tr.effects) if (e.is(effect)) deco = e.value;
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

const diffField = decoField(setDiffDeco);
const panelField = decoField(setPanelDeco);

/** Inline red/green diff over the original text (streaming + reviewing). */
function buildDiffSet(state: EditorState): DecorationSet {
  const s = useInlineEditStore.getState().session;
  if (!s || (s.phase !== "streaming" && s.phase !== "reviewing") || !s.proposed) {
    return Decoration.none;
  }
  const docLength = state.doc.length;
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

/** The prompt panel as a block widget below the target line. */
function buildPanelSet(state: EditorState): DecorationSet {
  const s = useInlineEditStore.getState().session;
  if (!s) return Decoration.none;
  const line = state.doc.lineAt(Math.min(s.to, state.doc.length));
  return Decoration.set([
    Decoration.widget({ widget: promptWidget, block: true, side: 1 }).range(line.to),
  ]);
}

/** ViewPlugin that repaints both fields whenever the session store changes. */
const inlineDiffSubscriber = ViewPlugin.fromClass(
  class {
    private unsub: () => void;
    constructor(readonly view: EditorView) {
      this.unsub = useInlineEditStore.subscribe(() => this.repaint());
    }
    private repaint() {
      this.view.dispatch({
        effects: [
          setDiffDeco.of(buildDiffSet(this.view.state)),
          setPanelDeco.of(buildPanelSet(this.view.state)),
        ],
      });
    }
    destroy() {
      this.unsub();
    }
  },
);

/** Editor extension: renders the inline AI edit diff preview + prompt panel. */
export const inlineDiffPlugin: Extension = [diffField, panelField, inlineDiffSubscriber];

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
