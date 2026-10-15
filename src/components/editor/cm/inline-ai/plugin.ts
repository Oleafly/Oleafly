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
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { subscribeEditorDocument } from "@oleafly/editor";
import { remoteChange } from "@oleafly/editor/collaboration";
import { type Session, useInlineEditStore } from "@/store/inlineEdit";
import { buildDecoSpans } from "./diff-ranges";
import { changeTouchesRange, mapPendingRange, type PendingRange } from "./pending-range";
import { promptWidget } from "./promptWidget";

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

// Inline diff marks and the block panel widget live in separate fields: a single
// set mixing block and inline decorations can become invalid (and get silently
// dropped) if a diff span lands at the block widget's line-end position.
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

function buildPanelSet(state: EditorState): DecorationSet {
  const s = useInlineEditStore.getState().session;
  if (!s) return Decoration.none;
  const line = state.doc.lineAt(Math.min(s.to, state.doc.length));
  return Decoration.set([
    Decoration.widget({ widget: promptWidget, block: true, side: 1 }).range(line.to),
  ]);
}

function repaint(view: EditorView): void {
  view.dispatch({
    effects: [setDiffDeco.of(buildDiffSet(view.state)), setPanelDeco.of(buildPanelSet(view.state))],
  });
}

function onlyMoved(next: Session | null, previous: Session | null): boolean {
  if (!next || !previous || next === previous) return false;
  const keys = new Set([...Object.keys(next), ...Object.keys(previous)] as (keyof Session)[]);
  for (const key of keys) {
    if (key !== "from" && key !== "to" && next[key] !== previous[key]) return false;
  }
  return true;
}

function followPendingRange(update: ViewUpdate): void {
  if (!update.docChanged) return;
  const store = useInlineEditStore.getState();
  const session = store.session;
  if (!session) return;
  let range: PendingRange = { from: session.from, to: session.to };
  let withdrawn = session.phase === "withdrawn";
  // Only a suggestion can go stale. While the instruction is still being
  // typed, or after an error, the range just follows the edit, and the run
  // reads the text again when it starts.
  const suggesting = session.phase === "streaming" || session.phase === "reviewing";
  for (const tr of update.transactions) {
    if (!tr.docChanged) continue;
    if (
      suggesting &&
      !withdrawn &&
      tr.annotation(remoteChange) === true &&
      changeTouchesRange(tr.changes, range)
    ) {
      withdrawn = true;
    }
    range = mapPendingRange(tr.changes, range);
  }
  if (range.from !== session.from || range.to !== session.to) store.relocate(range.from, range.to);
  if (withdrawn && session.phase !== "withdrawn") store.withdraw();
  if (useInlineEditStore.getState().session && update.view.state.field(panelField).size === 0) {
    repaint(update.view);
  }
}

const pendingRangeTracker = EditorView.updateListener.of(followPendingRange);

const inlineDiffSubscriber = ViewPlugin.fromClass(
  class {
    private readonly unsub: () => void;
    private readonly unsubDocument: () => void;
    private documentPath: string | null | undefined = undefined;
    constructor(readonly view: EditorView) {
      this.unsub = useInlineEditStore.subscribe((state, previous) => {
        if (!onlyMoved(state.session, previous.session)) repaint(this.view);
      });
      this.unsubDocument = subscribeEditorDocument((path) => this.followDocument(path));
    }
    private followDocument(path: string | null) {
      const previous = this.documentPath;
      this.documentPath = path;
      if (previous === undefined || previous === path) return;
      if (useInlineEditStore.getState().session) useInlineEditStore.getState().reset();
    }
    destroy() {
      this.unsub();
      this.unsubDocument();
    }
  },
);

export const inlineDiffPlugin: Extension = [
  diffField,
  panelField,
  inlineDiffSubscriber,
  pendingRangeTracker,
];

export function acceptInlineEdit(view: EditorView): void {
  const s = useInlineEditStore.getState().session;
  if (!s || s.phase === "withdrawn") return;
  view.dispatch({ changes: { from: s.from, to: s.to, insert: s.proposed } });
  useInlineEditStore.getState().reset();
}

// No document change to undo here: the diff preview never mutated the doc.
export function rejectInlineEdit(_view: EditorView): void {
  useInlineEditStore.getState().reset();
}
