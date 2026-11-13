// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { afterEach, describe, expect, it } from "vitest";
import { NoteUndoMemory, restoreUndo, startUndoMemory, UNDO_ENTRY_LIMIT, UNDO_FOLD, undoRecord } from "./note-undo-memory";
import type { UndoRecord } from "./note-undo-store";
import { destroyKbEditors, kbEditor, kbMarkdown, positionOf } from "./tests/kb-editor-fixtures";

afterEach(destroyKbEditors);

function remembering(markdown: string): Editor {
  return kbEditor(markdown, undefined, [NoteUndoMemory]);
}

function typeAt(editor: Editor, text: string, at: number): void {
  editor.view.dispatch(editor.state.tr.insertText(text, editor.state.doc.content.size - 1).setTime(at));
}

function recorded(editor: Editor): UndoRecord {
  const record = undoRecord(editor);
  if (!record) throw new Error("nothing recorded");
  return record;
}

const same = (left: ProseMirrorNode, right: ProseMirrorNode) => left.eq(right);

describe("undo kept after closing", () => {
  it("brings back the same undo and redo steps in a reopened note", () => {
    const editor = remembering("Start");
    startUndoMemory(editor);
    typeAt(editor, " one", 1_000);
    typeAt(editor, " two", 1_100);
    typeAt(editor, " three", 9_000);
    editor.commands.undo();
    expect(kbMarkdown(editor)).toBe("Start one two");
    const record = recorded(editor);

    const reopened = remembering(kbMarkdown(editor));
    expect(reopened.can().undo()).toBe(false);
    expect(restoreUndo(reopened, record, same)).toBe(true);
    expect(kbMarkdown(reopened)).toBe("Start one two");
    reopened.commands.redo();
    expect(kbMarkdown(reopened)).toBe("Start one two three");
    reopened.commands.undo();
    reopened.commands.undo();
    expect(kbMarkdown(reopened)).toBe("Start");
    expect(reopened.can().undo()).toBe(false);
  });

  it("keeps recording after a restore, so a second reopening still has every step", () => {
    const editor = remembering("A");
    startUndoMemory(editor);
    typeAt(editor, "b", 1_000);
    const reopened = remembering(kbMarkdown(editor));
    restoreUndo(reopened, recorded(editor), same);
    typeAt(reopened, "c", 9_000);
    const again = remembering(kbMarkdown(reopened));
    expect(restoreUndo(again, recorded(reopened), same)).toBe(true);
    again.commands.undo();
    expect(kbMarkdown(again)).toBe("Ab");
    again.commands.undo();
    expect(kbMarkdown(again)).toBe("A");
  });

  it("leaves a note alone when its text changed somewhere else", () => {
    const editor = remembering("Start");
    startUndoMemory(editor);
    typeAt(editor, " here", 1_000);
    const changed = remembering("Start somewhere else");
    expect(restoreUndo(changed, recorded(editor), same)).toBe(false);
    expect(kbMarkdown(changed)).toBe("Start somewhere else");
    expect(changed.can().undo()).toBe(false);
  });

  it("records nothing until it is started, and changes made without history replay without history", () => {
    const editor = remembering("Base");
    typeAt(editor, " early", 500);
    expect(undoRecord(editor)).toBeNull();
    startUndoMemory(editor);
    editor.view.dispatch(editor.state.tr.insertText(" synced", editor.state.doc.content.size - 1).setMeta("addToHistory", false));
    typeAt(editor, " typed", 9_000);
    const record = recorded(editor);
    expect(record.entries.map((entry) => entry.skip === true)).toEqual([true, false]);
    const reopened = remembering(kbMarkdown(editor));
    expect(restoreUndo(reopened, record, same)).toBe(true);
    reopened.commands.undo();
    expect(kbMarkdown(reopened)).toBe("Base early synced");
    expect(reopened.can().undo()).toBe(false);
  });

  it("leaves the caret where it was when the history comes back", () => {
    const editor = remembering("Start here");
    startUndoMemory(editor);
    typeAt(editor, " one", 1_000);
    const reopened = remembering(kbMarkdown(editor));
    const caret = positionOf(reopened, "here");
    reopened.commands.setTextSelection(caret);
    expect(restoreUndo(reopened, recorded(editor), same)).toBe(true);
    expect(reopened.state.selection.from).toBe(caret);
  });
});

describe("a long editing session", () => {
  it("keeps recording past the entry limit and still brings back the latest steps", () => {
    const editor = remembering("Start");
    startUndoMemory(editor);
    let at = 1_000;
    for (let index = 0; index < UNDO_ENTRY_LIMIT + UNDO_FOLD; index += 1) {
      at += index % 25 === 0 ? 1_000 : 10;
      typeAt(editor, "x", at);
    }
    const before = kbMarkdown(editor);
    typeAt(editor, " last", at + 10_000);
    const record = recorded(editor);
    expect(record.entries.length).toBeLessThanOrEqual(UNDO_ENTRY_LIMIT);
    expect(record.entries.length).toBeGreaterThan(UNDO_ENTRY_LIMIT - 2 * UNDO_FOLD);

    const reopened = remembering(kbMarkdown(editor));
    expect(restoreUndo(reopened, record, same)).toBe(true);
    reopened.commands.undo();
    expect(kbMarkdown(reopened)).toBe(before);
    reopened.commands.redo();
    typeAt(reopened, " more", at + 20_000);
    const again = remembering(kbMarkdown(reopened));
    expect(restoreUndo(again, recorded(reopened), same)).toBe(true);
    again.commands.undo();
    expect(kbMarkdown(again)).toBe(`${before} last`);
  });

  it("keeps recording through typing that never pauses", () => {
    const editor = remembering("Start");
    startUndoMemory(editor);
    for (let index = 0; index < UNDO_ENTRY_LIMIT + 3 * UNDO_FOLD; index += 1) typeAt(editor, "y", 1_000 + index * 10);
    const record = recorded(editor);
    expect(record.entries.length).toBeLessThanOrEqual(UNDO_ENTRY_LIMIT);
    const reopened = remembering(kbMarkdown(editor));
    expect(restoreUndo(reopened, record, same)).toBe(true);
    expect(reopened.can().undo()).toBe(true);
  });

  it("replays an undo of an edit that was folded into the kept text", () => {
    const editor = remembering("Start");
    startUndoMemory(editor);
    typeAt(editor, " old", 1_000);
    for (let index = 0; index < UNDO_ENTRY_LIMIT + UNDO_FOLD; index += 1) {
      editor.view.dispatch(editor.state.tr.insertText("z", editor.state.doc.content.size - 1).setTime(5_000 + index * 10).setMeta("addToHistory", false));
    }
    editor.commands.undo();
    expect(kbMarkdown(editor).startsWith("Startz")).toBe(true);
    const record = recorded(editor);
    expect(record.entries.at(-1)?.undo).toBe(true);
    const reopened = remembering(kbMarkdown(editor));
    expect(restoreUndo(reopened, record, same)).toBe(true);
    expect(kbMarkdown(reopened)).toBe(kbMarkdown(editor));
  });
});
