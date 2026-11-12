// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteText, destroyKbEditors, kbEditor, kbMarkdown, positionOf, typeBefore } from "./tests/kb-editor-fixtures";
import {
  ACTIVE_MATCH_CLASS,
  closeNoteFind,
  findMatches,
  findNextMatch,
  findPattern,
  findPreviousMatch,
  MATCH_CLASS,
  MAX_FIND_MATCHES,
  NoteFind,
  type NoteFindQuery,
  noteFindState,
  replaceAllMatches,
  replaceNextMatch,
  replacementFor,
  setNoteFindQuery,
} from "./note-find";

afterEach(() => {
  destroyKbEditors();
});

function query(search: string, options: Partial<NoteFindQuery> = {}): NoteFindQuery {
  return { search, replace: "", caseSensitive: false, wholeWord: false, regexp: false, ...options };
}

function finding(markdown: string, search: NoteFindQuery) {
  const editor = kbEditor(markdown, { callout: null }, [NoteFind]);
  setNoteFindQuery(editor.view, search);
  return editor;
}

function texts(editor: ReturnType<typeof kbEditor>): string[] {
  return noteFindState(editor.state).matches.map((match) => editor.state.doc.textBetween(match.from, match.to));
}

describe("finding text in a note", () => {
  it("finds every match across blocks, ignoring case unless asked", () => {
    const editor = finding("# Plan\n\nThe plan is a **Plan**.\n\n- plan B\n- other", query("plan"));
    expect(texts(editor)).toEqual(["Plan", "plan", "Plan", "plan"]);
    setNoteFindQuery(editor.view, query("plan", { caseSensitive: true }));
    expect(texts(editor)).toEqual(["plan", "plan"]);
    expect(editor.view.dom.querySelectorAll(`.${MATCH_CLASS}`)).toHaveLength(2);
  });

  it("matches whole words only when asked, Unicode letters included", () => {
    const editor = finding("cat concat cat_x cats café caféine", query("cat", { wholeWord: true }));
    expect(texts(editor)).toEqual(["cat"]);
    setNoteFindQuery(editor.view, query("café", { wholeWord: true }));
    expect(texts(editor)).toEqual(["café"]);
    setNoteFindQuery(editor.view, query(" con", { wholeWord: true }));
    expect(texts(editor)).toEqual([]);
    setNoteFindQuery(editor.view, query(" concat", { wholeWord: true }));
    expect(texts(editor)).toEqual([" concat"]);
  });

  it("takes regular expressions, reports invalid ones and skips empty matches", () => {
    const editor = finding("a1 b22 c333", query("\\d+", { regexp: true }));
    expect(texts(editor)).toEqual(["1", "22", "333"]);
    setNoteFindQuery(editor.view, query("x*", { regexp: true }));
    expect(noteFindState(editor.state)).toMatchObject({ valid: true, matches: [] });
    setNoteFindQuery(editor.view, query("(", { regexp: true }));
    expect(noteFindState(editor.state)).toMatchObject({ valid: false, matches: [] });
    expect(findPattern(query("a.b"))?.test("a.b")).toBe(true);
    expect(findPattern(query("a.b"))?.test("axb")).toBe(false);
    expect(findPattern(query(""))).toBeNull();
  });

  it("never matches across an inline atom such as math", () => {
    const editor = finding("before $x$ after", query("e . a", { regexp: true }));
    expect(texts(editor)).toEqual([]);
    setNoteFindQuery(editor.view, query("after"));
    expect(texts(editor)).toEqual(["after"]);
  });

  it("clears its marks when the query is emptied or closed", () => {
    const editor = finding("one two one", query("one"));
    expect(texts(editor)).toHaveLength(2);
    setNoteFindQuery(editor.view, query(""));
    expect(noteFindState(editor.state).query).toBeNull();
    expect(editor.view.dom.querySelector(`.${MATCH_CLASS}`)).toBeNull();
    setNoteFindQuery(editor.view, query("two"));
    setNoteFindQuery(editor.view, null);
    expect(noteFindState(editor.state).matches).toEqual([]);
  });

  it.each<[string, (editor: Editor) => void]>([
    ["typing a match", (editor) => editor.commands.insertContentAt(positionOf(editor, "gamma"), "beta ")],
    ["deleting a match", (editor) => deleteText(editor, "beta one")],
    ["splitting a block", (editor) => editor.chain().setTextSelection(positionOf(editor, "two")).splitBlock().run()],
    ["joining blocks", (editor) => editor.chain().setTextSelection(positionOf(editor, "gamma")).joinBackward().run()],
    ["removing a whole block", (editor) => editor.commands.deleteRange({ from: positionOf(editor, "alpha") - 1, to: positionOf(editor, "gamma") - 1 })],
    ["undoing", (editor) => {
      deleteText(editor, "beta two");
      editor.commands.undo();
    }],
  ])("follows edits while open: %s", (_name, edit) => {
    const editor = finding("alpha beta one\n\nbeta two\n\ngamma beta", query("beta"));
    findNextMatch(editor.view);
    edit(editor);
    const state = noteFindState(editor.state);
    expect(state.matches).toEqual(findMatches(editor.state.doc, query("beta")).matches);
    expect(editor.view.dom.querySelectorAll(`.${MATCH_CLASS}`)).toHaveLength(state.matches.length);
  });

  it("rescans only the blocks an edit touched", () => {
    const blocks = Array.from({ length: 300 }, (_, index) => `needle ${index}`).join("\n\n");
    const editor = finding(blocks, query("needle"));
    const exec = vi.spyOn(RegExp.prototype, "exec");
    typeBefore(editor, "needle 150", "needle ");
    const scans = exec.mock.contexts.filter((pattern) => (pattern as RegExp).source === "needle").length;
    exec.mockRestore();
    expect(noteFindState(editor.state).matches).toHaveLength(301);
    expect(scans).toBeLessThan(10);
  });
});

describe("moving between matches", () => {
  it("leaves the selection alone while stepping and selects the current match on close", () => {
    const editor = finding("one two one", query("one"));
    const before = editor.state.selection;
    findNextMatch(editor.view);
    findNextMatch(editor.view);
    expect(editor.state.selection.eq(before)).toBe(true);
    expect(noteFindState(editor.state).active).toBe(1);
    closeNoteFind(editor.view);
    expect(noteFindState(editor.state).query).toBeNull();
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe("one");
    expect(editor.state.selection.from).toBe(9);
    closeNoteFind(editor.view);
    expect(editor.state.selection.from).toBe(9);
  });

  it("keeps the current match through edits elsewhere and through a query change", () => {
    const editor = finding("one two one", query("one"));
    findNextMatch(editor.view);
    findNextMatch(editor.view);
    editor.view.dispatch(editor.state.tr.insertText("zero ", 1));
    expect(noteFindState(editor.state).active).toBe(1);
    expect(texts(editor)).toEqual(["one", "one"]);
    setNoteFindQuery(editor.view, query("one", { caseSensitive: true }));
    expect(noteFindState(editor.state).active).toBe(1);
    setNoteFindQuery(editor.view, query("two"));
    expect(noteFindState(editor.state).active).toBe(-1);
  });

  it("steps forward and back from the caret, wrapping at the ends, and marks the current one", () => {
    const editor = finding("one two one two one", query("one"));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)));
    const first = findNextMatch(editor.view);
    expect(first && editor.state.doc.textBetween(first.from, first.to)).toBe("one");
    expect(noteFindState(editor.state).active).toBe(1);
    expect(editor.view.dom.querySelectorAll(`.${ACTIVE_MATCH_CLASS}`)).toHaveLength(1);
    findNextMatch(editor.view);
    expect(noteFindState(editor.state).active).toBe(2);
    findNextMatch(editor.view);
    expect(noteFindState(editor.state).active).toBe(0);
    findPreviousMatch(editor.view);
    expect(noteFindState(editor.state).active).toBe(2);
    findPreviousMatch(editor.view);
    expect(noteFindState(editor.state).active).toBe(1);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    expect(noteFindState(editor.state).active).toBe(-1);
  });

  it("does nothing without matches", () => {
    const editor = finding("nothing here", query("absent"));
    expect(findNextMatch(editor.view)).toBeNull();
    expect(findPreviousMatch(editor.view)).toBeNull();
    expect(replaceNextMatch(editor.view, false)).toBeNull();
    expect(replaceAllMatches(editor.view, false)).toBe(0);
  });
});

describe("replacing matches", () => {
  it("selects the next match first, then replaces the current one and moves on", () => {
    const editor = finding("red apple, red car", query("red", { replace: "blue" }));
    replaceNextMatch(editor.view, false);
    expect(kbMarkdown(editor)).toBe("red apple, red car");
    expect(noteFindState(editor.state).active).toBe(0);
    replaceNextMatch(editor.view, false);
    expect(kbMarkdown(editor)).toBe("blue apple, red car");
    expect(texts(editor)).toEqual(["red"]);
    expect(noteFindState(editor.state).active).toBe(0);
  });

  it("replaces every match in one undoable step and keeps the marks of each match", () => {
    const editor = finding("Cat and **cat** and CAT", query("cat", { replace: "dog" }));
    expect(replaceAllMatches(editor.view, true)).toBe(3);
    expect(kbMarkdown(editor)).toBe("Dog and **dog** and DOG");
    editor.commands.undo();
    expect(kbMarkdown(editor)).toBe("Cat and **cat** and CAT");
  });

  it("expands groups in a regular expression replacement and reads escapes like the editor", () => {
    const match = { from: 0, to: 0, groups: ["2024-05", "2024", "05"] };
    expect(replacementFor(query("", { regexp: true, replace: "$2/$1 ($&) $$ $9" }), match, false)).toBe("05/2024 (2024-05) $ $9");
    expect(replacementFor(query("", { regexp: true, replace: "$10" }), match, false)).toBe("20240");
    expect(replacementFor(query("", { replace: "a\\tb" }), match, false)).toBe("a\tb");
    expect(replacementFor(query("", { replace: "new" }), { from: 0, to: 0, groups: ["OLD"] }, true)).toBe("NEW");
    const editor = finding("2024-05", query("(\\d+)-(\\d+)", { regexp: true, replace: "$2/$1" }));
    replaceAllMatches(editor.view, false);
    expect(kbMarkdown(editor)).toBe("05/2024");
  });

  it("replaces every match past the display limit", () => {
    const editor = finding("a ".repeat(MAX_FIND_MATCHES + 500).trim(), query("a", { replace: "b" }));
    expect(noteFindState(editor.state).matches).toHaveLength(MAX_FIND_MATCHES);
    expect(replaceAllMatches(editor.view, false)).toBe(MAX_FIND_MATCHES + 500);
    expect(kbMarkdown(editor)).not.toContain("a");
  }, 60_000);

  it("deletes a match when the replacement is empty", () => {
    const editor = finding("keep drop keep", query(" drop"));
    replaceAllMatches(editor.view, false);
    expect(kbMarkdown(editor)).toBe("keep keep");
  });

  it("leaves a read-only note alone", () => {
    const editor = finding("text text", query("text", { replace: "x" }));
    editor.setEditable(false);
    expect(replaceAllMatches(editor.view, false)).toBe(0);
    expect(replaceNextMatch(editor.view, false)).toBeNull();
    expect(kbMarkdown(editor)).toBe("text text");
  });
});
