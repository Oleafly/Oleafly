import { type EditorState, type Extension, StateEffect, StateField, type Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";

export interface RemoteCursor {
  id: string;
  name: string | null;
  hue: number;
  head: number;
  anchor: number;
}

export interface RemoteCursorSource {
  cursors(): readonly RemoteCursor[];
  subscribe(listener: () => void): () => void;
  activity?(view: EditorView): void;
}

export const REMOTE_CURSOR_STYLES = {
  ".cm-remote-selection": {
    backgroundColor: "hsl(var(--remote-hue) 85% 55% / 0.22)",
  },
  ".cm-remote-caret": {
    position: "relative",
    display: "inline",
    boxSizing: "border-box",
    marginLeft: "-1px",
    marginRight: "-1px",
    borderLeft: "1px solid hsl(var(--remote-hue) 70% 45%)",
    borderRight: "1px solid hsl(var(--remote-hue) 70% 45%)",
    pointerEvents: "none",
  },
  ".cm-remote-caret-label": {
    position: "absolute",
    bottom: "100%",
    left: "-1px",
    padding: "0 0.25rem",
    borderRadius: "0.25rem 0.25rem 0.25rem 0",
    backgroundColor: "hsl(var(--remote-hue) 70% 45%)",
    color: "#fff",
    fontSize: "0.6875rem",
    fontStyle: "normal",
    fontWeight: "500",
    lineHeight: "1.4",
    whiteSpace: "nowrap",
    userSelect: "none",
  },
};

const setRemoteCursors = StateEffect.define<readonly RemoteCursor[]>();

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function clampPosition(doc: Text, position: number): number {
  const clamped = Math.max(0, Math.min(doc.length, Number.isFinite(position) ? Math.trunc(position) : 0));
  if (clamped > 0 && clamped < doc.length && isLowSurrogate(doc.sliceString(clamped, clamped + 1).charCodeAt(0))) {
    return clamped - 1;
  }
  return clamped;
}

class CaretWidget extends WidgetType {
  constructor(
    readonly name: string | null,
    readonly hue: number,
  ) {
    super();
  }

  eq(other: CaretWidget): boolean {
    return other.name === this.name && other.hue === this.hue;
  }

  toDOM(): HTMLElement {
    const caret = document.createElement("span");
    caret.className = "cm-remote-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.style.setProperty("--remote-hue", String(this.hue));
    if (this.name) {
      const label = document.createElement("span");
      label.className = "cm-remote-caret-label";
      label.textContent = this.name;
      caret.appendChild(label);
    }
    return caret;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function decorationsFor(cursors: readonly RemoteCursor[]): DecorationSet {
  const ranges = [];
  for (const cursor of cursors) {
    const from = Math.min(cursor.head, cursor.anchor);
    const to = Math.max(cursor.head, cursor.anchor);
    if (from < to) {
      ranges.push(
        Decoration.mark({
          class: "cm-remote-selection",
          attributes: { style: `--remote-hue: ${cursor.hue}` },
        }).range(from, to),
      );
    }
    ranges.push(Decoration.widget({ widget: new CaretWidget(cursor.name, cursor.hue), side: 1 }).range(cursor.head));
  }
  return Decoration.set(ranges, true);
}

interface CursorField {
  cursors: readonly RemoteCursor[];
  reported: ReadonlyMap<string, RemoteCursor>;
  decorations: DecorationSet;
}

const cursorField = StateField.define<CursorField>({
  create: () => ({ cursors: [], reported: new Map(), decorations: Decoration.none }),
  update(value, transaction) {
    let cursors = value.cursors;
    if (transaction.docChanged && cursors.length > 0) {
      cursors = cursors.map((cursor) => ({
        ...cursor,
        head: transaction.changes.mapPos(cursor.head),
        anchor: transaction.changes.mapPos(cursor.anchor),
      }));
    }
    let reported = value.reported;
    for (const effect of transaction.effects) {
      if (!effect.is(setRemoteCursors)) continue;
      const doc = transaction.state.doc;
      const placed = new Map(cursors.map((cursor) => [cursor.id, cursor]));
      cursors = effect.value.map((cursor) => {
        const before = reported.get(cursor.id);
        const kept = placed.get(cursor.id);
        if (kept && before && before.head === cursor.head && before.anchor === cursor.anchor) {
          return { ...cursor, head: kept.head, anchor: kept.anchor };
        }
        return { ...cursor, head: clampPosition(doc, cursor.head), anchor: clampPosition(doc, cursor.anchor) };
      });
      reported = new Map(effect.value.map((cursor) => [cursor.id, cursor]));
    }
    if (cursors === value.cursors) return value;
    return { cursors, reported, decorations: decorationsFor(cursors) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

function cursorPlugin(source: RemoteCursorSource) {
  return ViewPlugin.define((view) => {
    let scheduled = false;
    let destroyed = false;
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (!destroyed) view.dispatch({ effects: setRemoteCursors.of(source.cursors()) });
      });
    };
    const unsubscribe = source.subscribe(refresh);
    refresh();
    return {
      update: (update: ViewUpdate) => {
        if (update.selectionSet || update.docChanged) source.activity?.(update.view);
      },
      destroy: () => {
        destroyed = true;
        unsubscribe();
      },
    };
  });
}

export function remoteCursors(source: RemoteCursorSource): Extension {
  return [cursorField, cursorPlugin(source), EditorView.baseTheme(REMOTE_CURSOR_STYLES)];
}

export function remoteCursorsIn(state: EditorState): readonly RemoteCursor[] {
  return state.field(cursorField, false)?.cursors ?? [];
}
