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

const LABEL_SATURATION = 70;
const LABEL_LIGHTNESS = 45;
const MIN_LABEL_CONTRAST = 4.5;

function channel(value: number): number {
  return value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

// WCAG relative luminance of an HSL colour (hue in degrees, the rest 0 to 100).
export function hslLuminance(hue: number, saturation: number, lightness: number): number {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const h = (((hue % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const sectors = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ];
  const [r, g, b] = sectors[Math.floor(h) % 6];
  const m = l - chroma / 2;
  return 0.2126 * channel(r + m) + 0.7152 * channel(g + m) + 0.0722 * channel(b + m);
}

export function contrastWithWhite(luminance: number): number {
  return 1.05 / (luminance + 0.05);
}

const labelLightnessByHue = new Map<number, number>();

// White name labels need 4.5:1. Yellows, greens and cyans are too light at
// the caret's lightness, so their labels get the lightest shade that is dark
// enough. Most hues keep the caret's own shade.
export function labelLightness(hue: number): number {
  const key = Math.round(hue) % 360;
  const known = labelLightnessByHue.get(key);
  if (known !== undefined) return known;
  let lightness = LABEL_LIGHTNESS;
  while (lightness > 10 && contrastWithWhite(hslLuminance(key, LABEL_SATURATION, lightness)) < MIN_LABEL_CONTRAST) {
    lightness -= 1;
  }
  labelLightnessByHue.set(key, lightness);
  return lightness;
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
  // The label hangs above its own line from inside an inline caret. WebKit
  // repaints only the line box when CodeMirror moves the widget, so without
  // a layer of its own the old label stays on screen and the line above
  // paints over the new one, until something else forces a repaint.
  ".cm-remote-caret-label": {
    position: "absolute",
    bottom: "100%",
    left: "-1px",
    willChange: "transform",
    padding: "0 0.25rem",
    borderRadius: "0.25rem 0.25rem 0.25rem 0",
    backgroundColor: `hsl(var(--remote-hue) ${LABEL_SATURATION}% var(--remote-label-lightness, ${LABEL_LIGHTNESS}%))`,
    color: "#fff",
    fontSize: "0.6875rem",
    fontStyle: "normal",
    fontWeight: "500",
    lineHeight: "1.4",
    whiteSpace: "nowrap",
    userSelect: "none",
  },
  ".cm-remote-flash": {
    backgroundColor: "hsl(var(--remote-hue) 85% 55% / 0.18)",
  },
};

export const REMOTE_FLASH_MS = 1_200;

const setRemoteCursors = StateEffect.define<readonly RemoteCursor[]>();
const setRemoteFlash = StateEffect.define<string | null>();

function isLowSurrogate(code: number | undefined): boolean {
  return code !== undefined && code >= 0xdc00 && code <= 0xdfff;
}

function clampPosition(doc: Text, position: number): number {
  const clamped = Math.max(0, Math.min(doc.length, Number.isFinite(position) ? Math.trunc(position) : 0));
  if (clamped > 0 && clamped < doc.length && isLowSurrogate(doc.sliceString(clamped, clamped + 1).codePointAt(0))) {
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
      label.style.setProperty("--remote-label-lightness", `${labelLightness(this.hue)}%`);
      label.textContent = this.name;
      caret.appendChild(label);
    }
    return caret;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function decorationsFor(doc: Text, cursors: readonly RemoteCursor[], flash: string | null): DecorationSet {
  const ranges = [];
  for (const cursor of cursors) {
    if (cursor.id === flash) {
      ranges.push(
        Decoration.line({
          class: "cm-remote-flash",
          attributes: { style: `--remote-hue: ${cursor.hue}` },
        }).range(doc.lineAt(cursor.head).from),
      );
    }
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
  flash: string | null;
  decorations: DecorationSet;
}

const cursorField = StateField.define<CursorField>({
  create: () => ({ cursors: [], reported: new Map(), flash: null, decorations: Decoration.none }),
  update(value, transaction) {
    let cursors = value.cursors;
    let flash = value.flash;
    if (transaction.docChanged && cursors.length > 0) {
      cursors = cursors.map((cursor) => ({
        ...cursor,
        head: transaction.changes.mapPos(cursor.head),
        anchor: transaction.changes.mapPos(cursor.anchor),
      }));
    }
    let reported = value.reported;
    for (const effect of transaction.effects) {
      if (effect.is(setRemoteFlash)) flash = effect.value;
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
    if (cursors === value.cursors && flash === value.flash) return value;
    return { cursors, reported, flash, decorations: decorationsFor(transaction.state.doc, cursors, flash) };
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

export function flashRemoteCursor(view: EditorView, id: string): boolean {
  if (!remoteCursorsIn(view.state).some((cursor) => cursor.id === id)) return false;
  view.dispatch({ effects: setRemoteFlash.of(id) });
  setTimeout(() => {
    if (view.state.field(cursorField, false)?.flash === id) view.dispatch({ effects: setRemoteFlash.of(null) });
  }, REMOTE_FLASH_MS);
  return true;
}
