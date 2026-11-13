import { Mark, markInputRule, markPasteRule, mergeAttributes } from "@tiptap/core";
import type { Mark as ProseMirrorMark } from "@tiptap/pm/model";
import { backtickRunEnd, codeSpanEnd } from "@/lib/code-fences";
import { NOTES_HIGHLIGHT_COLORS, type NotesHighlightColor } from "@/lib/notes-appearance";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import type { MarkdownIt, MdInlineState } from "./note-markdown-it";

const EQUALS = 0x3d;
const SPACE = /\s/u;
const INPUT = /(?:^|\s)(==(?!\s)([^=]+?)(?<!\s)==)$/u;
const PASTE = /(?:^|\s)(==(?!\s)([^=]+?)(?<!\s)==)/gu;
const OPEN_TAG = /^<mark data-color="([a-z]+)">/u;
const DEFAULT_HIGHLIGHT: NotesHighlightColor = "yellow";

export const HIGHLIGHT_CLOSE_TAG = "</mark>";

export function highlightColor(value: unknown): NotesHighlightColor | null {
  const color = NOTES_HIGHLIGHT_COLORS.find((candidate) => candidate === value);
  return color && color !== DEFAULT_HIGHLIGHT ? color : null;
}

export function highlightOf(mark: Pick<ProseMirrorMark, "attrs">): NotesHighlightColor {
  return highlightColor(mark.attrs.color) ?? DEFAULT_HIGHLIGHT;
}

export function highlightTag(src: string): { color: NotesHighlightColor; length: number } | null {
  const open = OPEN_TAG.exec(src);
  const color = highlightColor(open?.[1]);
  return open && color ? { color, length: open[0].length } : null;
}

export function highlightEnd(src: string, start: number, max: number): number {
  if (src.codePointAt(start) !== EQUALS || src.codePointAt(start + 1) !== EQUALS) return -1;
  const first = src[start + 2];
  if (first === undefined || start + 2 >= max || first === "=" || SPACE.test(first)) return -1;
  let cursor = start + 2;
  while (cursor < max) {
    const char = src[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === "`") {
      cursor = codeSpanEnd(src, cursor, max) ?? backtickRunEnd(src, cursor, max);
      continue;
    }
    if (char === "=" && src[cursor + 1] === "=" && cursor + 1 < max) {
      if (src[cursor + 2] === "=" || SPACE.test(src[cursor - 1])) return -1;
      return cursor;
    }
    cursor++;
  }
  return -1;
}

function markInline(state: MdInlineState, from: number, to: number, markup: string, color: NotesHighlightColor | null): void {
  const open = state.push("mark_open", "mark", 1);
  open.markup = markup;
  if (color) open.attrSet("data-color", color);
  const max = state.posMax;
  state.pos = from;
  state.posMax = to;
  state.md.inline.tokenize(state);
  state.posMax = max;
  state.push("mark_close", "mark", -1).markup = markup;
}

function highlightRule(state: MdInlineState, silent: boolean): boolean {
  const start = state.pos;
  const close = highlightEnd(state.src, start, state.posMax);
  if (close < 0) return false;
  if (!silent) markInline(state, start + 2, close, "==", null);
  state.pos = close + 2;
  return true;
}

function coloredHighlightRule(state: MdInlineState, silent: boolean): boolean {
  const start = state.pos;
  if (!state.src.startsWith("<mark ", start)) return false;
  const open = highlightTag(state.src.slice(start, state.posMax));
  if (!open) return false;
  const inner = start + open.length;
  const close = state.src.indexOf(HIGHLIGHT_CLOSE_TAG, inner);
  if (close <= inner || close + HIGHLIGHT_CLOSE_TAG.length > state.posMax) return false;
  if (!silent) markInline(state, inner, close, "html", open.color);
  state.pos = close + HIGHLIGHT_CLOSE_TAG.length;
  return true;
}

const withHighlight = new WeakSet<MarkdownIt>();

function setupHighlight(md: MarkdownIt): void {
  if (withHighlight.has(md)) return;
  withHighlight.add(md);
  md.inline.ruler.before("emphasis", "note_highlight", highlightRule);
  md.inline.ruler.before("html_inline", "note_highlight_color", coloredHighlightRule);
}

function lastHighlight(): NotesHighlightColor | null {
  return highlightColor(useNotesPrefsStore.getState().highlightColor);
}

export const NoteHighlight = Mark.create({
  name: "highlight",

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element: HTMLElement) => highlightColor(element.getAttribute("data-color")),
        renderHTML: (attributes: Record<string, unknown>) => {
          const color = highlightColor(attributes.color);
          return color ? { "data-color": color } : {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "mark" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes, { class: "note-highlight" }), 0];
  },

  addCommands() {
    return {
      toggleHighlight:
        (color) =>
        ({ commands }) => {
          const chosen = color === undefined ? lastHighlight() : highlightColor(color);
          if (color !== undefined) useNotesPrefsStore.getState().set("highlightColor", color);
          return commands.toggleMark(this.name, { color: chosen });
        },
      unsetHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name, { extendEmptyMarkRange: true }),
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-Shift-h": () => this.editor.commands.toggleHighlight() };
  },

  addInputRules() {
    return [markInputRule({ find: INPUT, type: this.type })];
  },

  addPasteRules() {
    return [markPasteRule({ find: PASTE, type: this.type })];
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state: unknown, mark: ProseMirrorMark) => {
            const color = highlightColor(mark.attrs.color);
            return color ? `<mark data-color="${color}">` : "==";
          },
          close: (_state: unknown, mark: ProseMirrorMark) => (highlightColor(mark.attrs.color) ? HIGHLIGHT_CLOSE_TAG : "=="),
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: { setup: setupHighlight },
      },
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    noteHighlight: {
      toggleHighlight: (color?: NotesHighlightColor) => ReturnType;
      unsetHighlight: () => ReturnType;
    };
  }
}
