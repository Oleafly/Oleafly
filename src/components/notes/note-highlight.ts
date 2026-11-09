import { Mark, markInputRule, markPasteRule, mergeAttributes } from "@tiptap/core";
import { onceFor, type MarkdownIt, type MdInlineState } from "./note-markdown-it";

const EQUALS = 0x3d;
const SPACE = /\s/u;
const INPUT = /(?:^|\s)(==(?!\s)([^=]+?)(?<!\s)==)$/u;
const PASTE = /(?:^|\s)(==(?!\s)([^=]+?)(?<!\s)==)/gu;

function codeSpanEnd(src: string, start: number, max: number): number {
  let run = 0;
  while (src[start + run] === "`") run++;
  let cursor = start + run;
  while (cursor < max) {
    if (src[cursor] !== "`") {
      cursor++;
      continue;
    }
    let close = 0;
    while (src[cursor + close] === "`") close++;
    if (close === run) return cursor + close;
    cursor += close;
  }
  return start + run;
}

export function highlightEnd(src: string, start: number, max: number): number {
  if (src.charCodeAt(start) !== EQUALS || src.charCodeAt(start + 1) !== EQUALS) return -1;
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
      cursor = codeSpanEnd(src, cursor, max);
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

export function highlightRule(state: MdInlineState, silent: boolean): boolean {
  const start = state.pos;
  const close = highlightEnd(state.src, start, state.posMax);
  if (close < 0) return false;
  if (!silent) {
    state.push("mark_open", "mark", 1).markup = "==";
    const max = state.posMax;
    state.pos = start + 2;
    state.posMax = close;
    state.md.inline.tokenize(state);
    state.posMax = max;
    state.push("mark_close", "mark", -1).markup = "==";
  }
  state.pos = close + 2;
  return true;
}

function setupHighlight(md: MarkdownIt): void {
  onceFor(md, "note_highlight", () => md.inline.ruler.before("emphasis", "note_highlight", highlightRule));
}

export const NoteHighlight = Mark.create({
  name: "highlight",

  parseHTML() {
    return [{ tag: "mark" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes, { class: "note-highlight" }), 0];
  },

  addCommands() {
    return {
      toggleHighlight:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-Shift-h": () => this.editor.commands.toggleMark(this.name) };
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
        serialize: { open: "==", close: "==", mixable: true, expelEnclosingWhitespace: true },
        parse: { setup: setupHighlight },
      },
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    noteHighlight: {
      toggleHighlight: () => ReturnType;
    };
  }
}
