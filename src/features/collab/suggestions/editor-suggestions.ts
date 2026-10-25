import { type ChangeDesc, type EditorState, type Extension, type Range, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { scrollEditorPositionLocally } from "@oleafly/editor";
import type { CollabSuggestionKind } from "@/lib/tauri";

export interface SuggestionSpan {
  id: string;
  kind: CollabSuggestionKind;
  from: number;
  to: number;
  text: string;
  hue: number;
  label: string;
}

export interface SuggestionSnapshot {
  path: string | null;
  spans: readonly SuggestionSpan[];
  active: string | null;
}

export interface EditorSuggestionsSource {
  snapshot(): SuggestionSnapshot;
  documentPath(): string | null;
  subscribe(listener: () => void): () => void;
  open(id: string): void;
  hover(id: string | null): void;
}

const NO_SPANS: readonly SuggestionSpan[] = [];

export const SUGGESTION_STYLES = {
  ".cm-suggestion-insert": {
    backgroundColor: "hsl(var(--suggestion-hue) 85% 55% / 0.22)",
    borderRadius: "2px",
  },
  ".cm-suggestion-insert.cm-suggestion-active": {
    backgroundColor: "hsl(var(--suggestion-hue) 85% 55% / 0.42)",
  },
  ".cm-suggestion-delete": {
    textDecoration: "line-through",
    textDecorationColor: "hsl(var(--suggestion-hue) 70% 40%)",
    color: "hsl(var(--suggestion-hue) 55% 38%)",
    backgroundColor: "hsl(var(--suggestion-hue) 85% 55% / 0.1)",
    borderRadius: "2px",
    cursor: "pointer",
  },
  ".dark & .cm-suggestion-delete": {
    textDecorationColor: "hsl(var(--suggestion-hue) 70% 70%)",
    color: "hsl(var(--suggestion-hue) 60% 72%)",
  },
  ".cm-suggestion-delete.cm-suggestion-active": {
    backgroundColor: "hsl(var(--suggestion-hue) 85% 55% / 0.28)",
  },
};

const setSpans = StateEffect.define<readonly SuggestionSpan[]>();
const setActive = StateEffect.define<string | null>();

interface Reported {
  from: number;
  to: number;
}

interface SuggestionField {
  spans: readonly SuggestionSpan[];
  reported: ReadonlyMap<string, Reported>;
  active: string | null;
  decorations: DecorationSet;
}

function clamp(doc: Text, position: number): number {
  return Math.max(0, Math.min(doc.length, Number.isFinite(position) ? Math.trunc(position) : 0));
}

function clampSpan(doc: Text, span: SuggestionSpan): SuggestionSpan {
  const from = clamp(doc, span.from);
  const to = span.kind === "delete" ? from : Math.max(from, clamp(doc, span.to));
  return { ...span, from, to };
}

function mapSpan(span: SuggestionSpan, changes: ChangeDesc): SuggestionSpan {
  if (span.kind === "delete") {
    const at = changes.mapPos(span.from, -1);
    return { ...span, from: at, to: at };
  }
  const from = changes.mapPos(span.from, 1);
  return { ...span, from, to: Math.max(from, changes.mapPos(span.to, 1)) };
}

function stateClass(base: string, id: string, active: string | null): string {
  return active === id ? `${base} cm-suggestion-active` : base;
}

class DeletionWidget extends WidgetType {
  constructor(
    readonly id: string,
    readonly text: string,
    readonly hue: number,
    readonly label: string,
    readonly active: boolean,
  ) {
    super();
  }

  eq(other: DeletionWidget): boolean {
    return (
      other.id === this.id &&
      other.text === this.text &&
      other.hue === this.hue &&
      other.label === this.label &&
      other.active === this.active
    );
  }

  toDOM(): HTMLElement {
    const node = document.createElement("del");
    node.className = this.active ? "cm-suggestion-delete cm-suggestion-active" : "cm-suggestion-delete";
    node.dataset.suggestionId = this.id;
    node.style.setProperty("--suggestion-hue", String(this.hue));
    node.title = this.label;
    node.textContent = this.text;
    return node;
  }

  ignoreEvent(event: Event): boolean {
    return !(event instanceof MouseEvent);
  }
}

function decorationsOf(spans: readonly SuggestionSpan[], active: string | null): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const span of spans) {
    if (span.kind === "delete") {
      if (!span.text) continue;
      ranges.push(
        Decoration.widget({
          widget: new DeletionWidget(span.id, span.text, span.hue, span.label, active === span.id),
          side: -1,
        }).range(span.from),
      );
      continue;
    }
    if (span.from === span.to) continue;
    ranges.push(
      Decoration.mark({
        class: stateClass("cm-suggestion-insert", span.id, active),
        attributes: {
          "data-suggestion-id": span.id,
          style: `--suggestion-hue: ${span.hue}`,
          title: span.label,
        },
      }).range(span.from, span.to),
    );
  }
  return Decoration.set(ranges, true);
}

function placed(
  doc: Text,
  incoming: readonly SuggestionSpan[],
  current: readonly SuggestionSpan[],
  reported: ReadonlyMap<string, Reported>,
): readonly SuggestionSpan[] {
  const kept = new Map(current.map((span) => [span.id, span]));
  return incoming.map((span) => {
    const before = reported.get(span.id);
    const mine = kept.get(span.id);
    if (mine && mine.kind === span.kind && before?.from === span.from && before.to === span.to) {
      return { ...span, from: mine.from, to: mine.to };
    }
    return clampSpan(doc, span);
  });
}

const suggestionField = StateField.define<SuggestionField>({
  create: () => ({ spans: NO_SPANS, reported: new Map(), active: null, decorations: Decoration.none }),
  update(value, transaction) {
    let { spans, reported, active } = value;
    let changed = false;
    const mapped = transaction.docChanged && spans.length > 0;
    if (mapped) spans = spans.map((span) => mapSpan(span, transaction.changes));
    for (const effect of transaction.effects) {
      if (effect.is(setSpans)) {
        spans = placed(transaction.state.doc, effect.value, spans, reported);
        reported = new Map(effect.value.map((span) => [span.id, { from: span.from, to: span.to }]));
        changed = true;
      } else if (effect.is(setActive)) {
        active = effect.value;
        changed = true;
      }
    }
    if (changed) return { spans, reported, active, decorations: decorationsOf(spans, active) };
    if (!mapped) return value;
    return { spans, reported, active, decorations: value.decorations.map(transaction.changes) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

function idAt(target: EventTarget | null): string | null {
  const element = target instanceof Element ? target.closest("[data-suggestion-id]") : null;
  return element?.getAttribute("data-suggestion-id") || null;
}

interface Pushed {
  spans: readonly SuggestionSpan[];
  active: string | null;
}

function suggestionSync(source: EditorSuggestionsSource): Extension {
  return ViewPlugin.define(
    (view) => {
      let last: Pushed | null = null;
      let scheduled = false;
      let destroyed = false;
      const push = () => {
        const snapshot = source.snapshot();
        const own = snapshot.path !== null && snapshot.path === source.documentPath();
        const next: Pushed = { spans: own ? snapshot.spans : NO_SPANS, active: snapshot.active };
        const effects: StateEffect<unknown>[] = [];
        if (last?.spans !== next.spans) effects.push(setSpans.of(next.spans));
        if (last?.active !== next.active) effects.push(setActive.of(next.active));
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
      return {
        hovered: null as string | null,
        destroy: () => {
          destroyed = true;
          unsubscribe();
        },
      };
    },
    {
      eventHandlers: {
        mouseover(event) {
          const id = idAt(event.target);
          if (id === this.hovered) return;
          this.hovered = id;
          source.hover(id);
        },
        mouseleave() {
          if (this.hovered === null) return;
          this.hovered = null;
          source.hover(null);
        },
        click(event, view) {
          if (event.button !== 0 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
          if (!view.state.selection.main.empty) return;
          const id = idAt(event.target);
          if (id) source.open(id);
        },
      },
    },
  );
}

export function editorSuggestions(source: EditorSuggestionsSource): Extension {
  return [suggestionField, suggestionSync(source), EditorView.baseTheme(SUGGESTION_STYLES)];
}

export function suggestionSpansIn(state: EditorState): readonly SuggestionSpan[] {
  return state.field(suggestionField, false)?.spans ?? NO_SPANS;
}

export function revealSuggestion(view: EditorView, id: string): boolean {
  const span = suggestionSpansIn(view.state).find((candidate) => candidate.id === id);
  if (!span) return false;
  scrollEditorPositionLocally(view, span.from);
  return true;
}
