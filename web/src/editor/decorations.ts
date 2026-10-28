import { type Extension, type Range, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { peerHue } from "@/features/collab/live/peer-hue";
import type { OverlaySnapshot } from "../overlays";

export interface OverlaySelection {
  thread: string | null;
  suggestion: string | null;
}

export interface OverlaySource {
  activePath(): string | null;
  snapshot(path: string | null): OverlaySnapshot | null;
  self(): string | null;
  selected(): OverlaySelection;
  subscribe(listener: () => void): () => void;
  pick?(kind: "thread" | "suggestion", id: string): void;
}

export const DELETED_TEXT_LIMIT = 400;

export const OVERLAY_STYLES = {
  ".cm-suggest-insert": {
    backgroundColor: "hsl(var(--suggest-hue) 85% 55% / 0.24)",
    borderRadius: "2px",
  },
  ".cm-suggest-insert.cm-suggest-active": {
    backgroundColor: "hsl(var(--suggest-hue) 85% 55% / 0.42)",
  },
  ".cm-suggest-delete": {
    color: "hsl(var(--suggest-hue) 65% 36%)",
    backgroundColor: "hsl(var(--suggest-hue) 85% 55% / 0.1)",
    textDecorationLine: "line-through",
    textDecorationThickness: "0.08em",
    borderRadius: "2px",
    whiteSpace: "pre-wrap",
    userSelect: "none",
    cursor: "pointer",
  },
  ".dark & .cm-suggest-delete": {
    color: "hsl(var(--suggest-hue) 75% 74%)",
  },
  ".cm-suggest-delete.cm-suggest-active": {
    backgroundColor: "hsl(var(--suggest-hue) 85% 55% / 0.24)",
  },
  ".cm-comment-range": {
    backgroundColor: "color-mix(in oklch, oklch(0.82 0.16 85) 30%, transparent)",
    borderRadius: "2px",
    cursor: "pointer",
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
};

export function deletedTextLabel(text: string): string {
  return text.length > DELETED_TEXT_LIMIT ? `${text.slice(0, DELETED_TEXT_LIMIT)}…` : text;
}

export class DeletedTextWidget extends WidgetType {
  constructor(
    readonly id: string | null,
    readonly text: string,
    readonly hue: number,
    readonly active: boolean,
  ) {
    super();
  }

  eq(other: DeletedTextWidget): boolean {
    return other.id === this.id && other.text === this.text && other.hue === this.hue && other.active === this.active;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = this.active ? "cm-suggest-delete cm-suggest-active" : "cm-suggest-delete";
    span.style.setProperty("--suggest-hue", String(this.hue));
    span.dataset.suggestion = "delete";
    if (this.id) span.dataset.suggestionId = this.id;
    span.textContent = deletedTextLabel(this.text);
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function clamp(doc: Text, position: number): number {
  return Math.max(0, Math.min(doc.length, Math.trunc(position)));
}

export function buildOverlayDecorations(
  doc: Text,
  snapshot: OverlaySnapshot | null,
  self: string | null,
  selected: OverlaySelection,
): DecorationSet {
  if (!snapshot) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  for (const thread of snapshot.threads) {
    if (thread.resolved) continue;
    const from = clamp(doc, thread.from);
    const to = clamp(doc, thread.to);
    if (to <= from) continue;
    ranges.push(
      Decoration.mark({
        class: selected.thread === thread.id ? "cm-comment-range cm-comment-active" : "cm-comment-range",
        attributes: { "data-thread-id": thread.id },
      }).range(from, to),
    );
  }
  if (snapshot.draft) {
    const from = clamp(doc, snapshot.draft.from);
    const to = clamp(doc, snapshot.draft.to);
    if (to > from) ranges.push(Decoration.mark({ class: "cm-comment-draft" }).range(from, to));
  }
  for (const suggestion of snapshot.suggestions) {
    const hue = peerHue(suggestion.author || "unknown", self);
    const active = suggestion.id !== null && selected.suggestion === suggestion.id;
    if (suggestion.kind === "delete") {
      if (!suggestion.text) continue;
      ranges.push(
        Decoration.widget({
          widget: new DeletedTextWidget(suggestion.id, suggestion.text, hue, active),
          side: -1,
        }).range(clamp(doc, suggestion.from)),
      );
      continue;
    }
    const from = clamp(doc, suggestion.from);
    const to = clamp(doc, suggestion.to);
    if (to <= from) continue;
    const attributes: Record<string, string> = { style: `--suggest-hue: ${hue}`, "data-suggestion": "insert" };
    if (suggestion.id) attributes["data-suggestion-id"] = suggestion.id;
    ranges.push(
      Decoration.mark({
        class: active ? "cm-suggest-insert cm-suggest-active" : "cm-suggest-insert",
        attributes,
      }).range(from, to),
    );
  }
  return Decoration.set(ranges, true);
}

const setOverlay = StateEffect.define<DecorationSet>();

const overlayField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = transaction.docChanged ? value.map(transaction.changes) : value;
    for (const effect of transaction.effects) if (effect.is(setOverlay)) next = effect.value;
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function overlayPlugin(source: OverlaySource) {
  return ViewPlugin.define((view) => {
    let scheduled = false;
    let destroyed = false;
    let shown: string | null = null;
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (destroyed) return;
        shown = source.activePath();
        view.dispatch({
          effects: setOverlay.of(
            buildOverlayDecorations(view.state.doc, source.snapshot(shown), source.self(), source.selected()),
          ),
        });
      });
    };
    const unsubscribe = source.subscribe(refresh);
    refresh();
    return {
      update: (update: ViewUpdate) => {
        if (update.docChanged && source.activePath() !== shown) refresh();
      },
      destroy: () => {
        destroyed = true;
        unsubscribe();
      },
    };
  });
}

function overlayClicks(source: OverlaySource): Extension {
  return EditorView.domEventHandlers({
    click: (event) => {
      if (!source.pick || !(event.target instanceof Element)) return false;
      const suggestion = event.target.closest<HTMLElement>("[data-suggestion-id]");
      const suggestionId = suggestion?.dataset.suggestionId;
      if (suggestionId) {
        source.pick("suggestion", suggestionId);
        return false;
      }
      const thread = event.target.closest<HTMLElement>("[data-thread-id]");
      const threadId = thread?.dataset.threadId;
      if (threadId) source.pick("thread", threadId);
      return false;
    },
  });
}

export function overlayDecorations(source: OverlaySource): Extension {
  return [overlayField, overlayPlugin(source), overlayClicks(source), EditorView.baseTheme(OVERLAY_STYLES)];
}
