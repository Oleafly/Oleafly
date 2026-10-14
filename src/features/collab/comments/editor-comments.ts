import {
  type ChangeDesc,
  type EditorState,
  type Extension,
  RangeSet,
  type Range,
  StateEffect,
  StateField,
  type Text,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutter,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { scrollEditorPositionLocally } from "@oleafly/editor";
import { i18n } from "@/i18n";

export interface CommentSpan {
  id: string;
  from: number;
  to: number;
  resolved: boolean;
}

export interface CommentDraftRange {
  from: number;
  to: number;
}

export interface CommentSnapshot {
  path: string | null;
  spans: readonly CommentSpan[];
  selected: string | null;
  draft: CommentDraftRange | null;
}

export type CommentOpenedFrom = "marker" | "text";

export interface AnchorChange {
  emptied: readonly string[];
  edited: boolean;
}

export interface EditorCommentsSource {
  snapshot(): CommentSnapshot;
  documentPath(): string | null;
  subscribe(listener: () => void): () => void;
  open(threadId: string, from: CommentOpenedFrom): void;
  anchorsChanged?(change: AnchorChange): void;
}

const FLASH_MS = 1_200;
const NO_SPANS: readonly CommentSpan[] = [];
const SVG = "http://www.w3.org/2000/svg";

export const COMMENT_MARK_STYLES = {
  ".cm-comment-range": {
    backgroundColor: "color-mix(in oklch, oklch(0.82 0.16 85) 30%, transparent)",
    borderRadius: "2px",
  },
  ".dark & .cm-comment-range": {
    backgroundColor: "color-mix(in oklch, oklch(0.78 0.14 85) 22%, transparent)",
  },
  ".cm-comment-range.cm-comment-active, .cm-comment-draft": {
    backgroundColor: "color-mix(in oklch, oklch(0.82 0.16 85) 55%, transparent)",
  },
  ".dark & .cm-comment-range.cm-comment-active, .dark & .cm-comment-draft": {
    backgroundColor: "color-mix(in oklch, oklch(0.78 0.14 85) 42%, transparent)",
  },
  ".cm-comment-range.cm-comment-flash": {
    backgroundColor: "color-mix(in oklch, oklch(0.82 0.16 85) 80%, transparent)",
  },
  ".cm-comment-gutter .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 2px",
  },
  ".cm-comment-marker, .cm-comment-spacer": {
    display: "inline-flex",
    width: "0.875rem",
    height: "0.875rem",
  },
  ".cm-comment-marker": {
    color: "oklch(0.7 0.15 75)",
    cursor: "pointer",
  },
  ".cm-comment-marker svg": {
    width: "100%",
    height: "100%",
  },
};

const setSpans = StateEffect.define<readonly CommentSpan[]>();
const setSelected = StateEffect.define<string | null>();
const setDraft = StateEffect.define<CommentDraftRange | null>();
const setFlash = StateEffect.define<string | null>();

interface Reported {
  from: number;
  to: number;
}

interface CommentField {
  spans: readonly CommentSpan[];
  reported: ReadonlyMap<string, Reported>;
  selected: string | null;
  flash: string | null;
  draft: CommentDraftRange | null;
  decorations: DecorationSet;
  markers: RangeSet<GutterMarker>;
}

function clamp(doc: Text, position: number): number {
  return Math.max(0, Math.min(doc.length, Number.isFinite(position) ? Math.trunc(position) : 0));
}

function clampRange<T extends CommentDraftRange>(doc: Text, range: T): T {
  const from = clamp(doc, range.from);
  return { ...range, from, to: Math.max(from, clamp(doc, range.to)) };
}

function mapRange<T extends CommentDraftRange>(range: T, changes: ChangeDesc): T {
  const from = changes.mapPos(range.from, 1);
  return { ...range, from, to: Math.max(from, changes.mapPos(range.to, -1)) };
}

function commentIcon(): SVGSVGElement {
  const icon = document.createElementNS(SVG, "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z");
  icon.appendChild(path);
  return icon;
}

class CommentMarker extends GutterMarker {
  constructor(readonly ids: readonly string[]) {
    super();
  }

  eq(other: CommentMarker): boolean {
    return other.ids.length === this.ids.length && other.ids.every((id, index) => id === this.ids[index]);
  }

  toDOM(): Node {
    const marker = document.createElement("span");
    marker.className = "cm-comment-marker";
    marker.setAttribute("data-comment-ids", this.ids.join(" "));
    marker.title = i18n.t(($) => $.collab.comments.marker);
    marker.appendChild(commentIcon());
    return marker;
  }
}

class CommentSpacer extends GutterMarker {
  toDOM(): Node {
    const spacer = document.createElement("span");
    spacer.className = "cm-comment-spacer";
    return spacer;
  }
}

const SPACER = new CommentSpacer();

function markClass(id: string, selected: string | null, flash: string | null): string {
  if (flash === id) return "cm-comment-range cm-comment-active cm-comment-flash";
  return selected === id ? "cm-comment-range cm-comment-active" : "cm-comment-range";
}

function marksOf(value: Omit<CommentField, "decorations" | "markers">): DecorationSet {
  const marks: Range<Decoration>[] = [];
  for (const span of value.spans) {
    if (span.resolved || span.from === span.to) continue;
    marks.push(
      Decoration.mark({
        class: markClass(span.id, value.selected, value.flash),
        attributes: { "data-comment-id": span.id },
      }).range(span.from, span.to),
    );
  }
  if (value.draft && value.draft.from < value.draft.to) {
    marks.push(Decoration.mark({ class: "cm-comment-draft" }).range(value.draft.from, value.draft.to));
  }
  return Decoration.set(marks, true);
}

function markersOf(doc: Text, spans: readonly CommentSpan[]): RangeSet<GutterMarker> {
  const lines = new Map<number, string[]>();
  for (const span of spans) {
    if (span.resolved || span.from === span.to) continue;
    const line = doc.lineAt(span.from).from;
    lines.set(line, [...(lines.get(line) ?? []), span.id]);
  }
  const markers = [...lines.entries()]
    .sort(([left], [right]) => left - right)
    .map(([line, ids]) => new CommentMarker(ids).range(line));
  return RangeSet.of(markers);
}

function build(doc: Text, value: Omit<CommentField, "decorations" | "markers">): CommentField {
  return { ...value, decorations: marksOf(value), markers: markersOf(doc, value.spans) };
}

function linesChanged(transaction: Transaction): boolean {
  const before = transaction.startState.doc;
  let changed = false;
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (!changed && (inserted.lines > 1 || before.lineAt(fromA).number !== before.lineAt(toA).number)) changed = true;
  });
  return changed;
}

function placed(
  doc: Text,
  incoming: readonly CommentSpan[],
  current: readonly CommentSpan[],
  reported: ReadonlyMap<string, Reported>,
): readonly CommentSpan[] {
  const kept = new Map(current.map((span) => [span.id, span]));
  return incoming.map((span) => {
    const before = reported.get(span.id);
    const mine = kept.get(span.id);
    if (mine && before && before.from === span.from && before.to === span.to) {
      return { ...span, from: mine.from, to: mine.to };
    }
    return clampRange(doc, span);
  });
}

function newlyEmptied(before: readonly CommentSpan[], after: readonly CommentSpan[]): boolean {
  return after.some((span, index) => span.from === span.to && before[index]?.from !== before[index]?.to);
}

function emptiedIds(spans: readonly CommentSpan[]): string[] {
  return spans.filter((span) => !span.resolved && span.from === span.to).map((span) => span.id);
}

function editedInside(spans: readonly CommentSpan[], changes: ChangeDesc): boolean {
  let edited = false;
  changes.iterChangedRanges((fromA, toA) => {
    if (edited) return;
    edited = spans.some((span) => !span.resolved && span.from < span.to && fromA < span.to && toA > span.from);
  });
  return edited;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

const commentField = StateField.define<CommentField>({
  create: (state) =>
    build(state.doc, { spans: NO_SPANS, reported: new Map(), selected: null, flash: null, draft: null }),
  update(value, transaction) {
    let { spans, reported, selected, flash, draft } = value;
    let changed = false;
    const mapped = transaction.docChanged && (spans.length > 0 || draft !== null);
    if (mapped) {
      spans = spans.map((span) => mapRange(span, transaction.changes));
      draft = draft ? mapRange(draft, transaction.changes) : null;
    }
    const doc = transaction.state.doc;
    for (const effect of transaction.effects) {
      if (effect.is(setSpans)) {
        spans = placed(doc, effect.value, spans, reported);
        reported = new Map(effect.value.map((span) => [span.id, { from: span.from, to: span.to }]));
        changed = true;
      } else if (effect.is(setSelected)) {
        selected = effect.value;
        changed = true;
      } else if (effect.is(setDraft)) {
        draft = effect.value ? clampRange(doc, effect.value) : null;
        changed = true;
      } else if (effect.is(setFlash)) {
        flash = effect.value;
        changed = true;
      }
    }
    if (changed) return build(doc, { spans, reported, selected, flash, draft });
    if (!mapped) return value;
    const rebuild = linesChanged(transaction) || newlyEmptied(value.spans, spans);
    return {
      spans,
      reported,
      selected,
      flash,
      draft,
      decorations: value.decorations.map(transaction.changes),
      markers: rebuild ? markersOf(doc, spans) : value.markers.map(transaction.changes),
    };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

function idsAt(target: EventTarget | null, attribute: string): string[] {
  const element = target instanceof Element ? target.closest(`[${attribute}]`) : null;
  return (element?.getAttribute(attribute) ?? "").split(" ").filter(Boolean);
}

function commentGutter(source: EditorCommentsSource): Extension {
  return gutter({
    class: "cm-comment-gutter",
    markers: (view) => view.state.field(commentField).markers,
    initialSpacer: () => SPACER,
    domEventHandlers: {
      mousedown: (_view, _line, event) => {
        const [id] = idsAt(event.target, "data-comment-ids");
        if (!id) return false;
        source.open(id, "marker");
        return true;
      },
    },
  });
}

function commentClicks(source: EditorCommentsSource): Extension {
  return EditorView.domEventHandlers({
    click: (event, view) => {
      if (event.button !== 0 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
      if (!view.state.selection.main.empty) return;
      const [id] = idsAt(event.target, "data-comment-id");
      if (id) source.open(id, "text");
    },
  });
}

interface Pushed {
  spans: readonly CommentSpan[];
  selected: string | null;
  draft: CommentDraftRange | null;
}

function commentSync(source: EditorCommentsSource): Extension {
  return ViewPlugin.define((view) => {
    let last: Pushed | null = null;
    let scheduled = false;
    let destroyed = false;
    const push = () => {
      const snapshot = source.snapshot();
      const own = snapshot.path !== null && snapshot.path === source.documentPath();
      const next: Pushed = {
        spans: own ? snapshot.spans : NO_SPANS,
        selected: snapshot.selected,
        draft: own ? snapshot.draft : null,
      };
      const effects: StateEffect<unknown>[] = [];
      if (last?.spans !== next.spans) effects.push(setSpans.of(next.spans));
      if (last?.selected !== next.selected) effects.push(setSelected.of(next.selected));
      if (last?.draft !== next.draft) effects.push(setDraft.of(next.draft));
      last = next;
      if (effects.length > 0) view.dispatch({ effects });
    };
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (!destroyed) push();
      });
    };
    const unsubscribe = source.subscribe(refresh);
    refresh();
    let emptied: readonly string[] = [];
    return {
      update: (update: ViewUpdate) => {
        const before = update.startState.field(commentField).spans;
        const after = update.state.field(commentField).spans;
        if (before === after || !source.anchorsChanged) return;
        const edited = update.docChanged && editedInside(before, update.changes);
        const next = emptiedIds(after);
        if (!edited && sameIds(emptied, next)) return;
        emptied = next;
        source.anchorsChanged({ emptied: next, edited });
      },
      destroy: () => {
        destroyed = true;
        unsubscribe();
      },
    };
  });
}

export function editorComments(source: EditorCommentsSource): Extension {
  return [
    commentField,
    commentSync(source),
    commentGutter(source),
    commentClicks(source),
    EditorView.baseTheme(COMMENT_MARK_STYLES),
  ];
}

export function commentSpansIn(state: EditorState): readonly CommentSpan[] {
  return state.field(commentField, false)?.spans ?? NO_SPANS;
}

export function commentLinesIn(state: EditorState): number[] {
  const markers = state.field(commentField, false)?.markers;
  const lines: number[] = [];
  markers?.between(0, state.doc.length, (from) => {
    lines.push(state.doc.lineAt(from).number);
  });
  return lines;
}

export function commentDraftIn(state: EditorState): CommentDraftRange | null {
  return state.field(commentField, false)?.draft ?? null;
}

export function revealComment(view: EditorView, id: string): boolean {
  const span = commentSpansIn(view.state).find((candidate) => candidate.id === id);
  if (!span) return false;
  scrollEditorPositionLocally(view, span.from);
  view.dispatch({ effects: setFlash.of(id) });
  setTimeout(() => {
    if (view.state.field(commentField, false)?.flash === id) view.dispatch({ effects: setFlash.of(null) });
  }, FLASH_MS);
  return true;
}
