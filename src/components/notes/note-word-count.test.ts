// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { destroyKbEditors, kbEditor } from "./kb-test-editor";
import { countedWordStarts } from "@oleafly/editor/prose";
import { noteTextWords, noteWordCount } from "./note-word-count";

afterEach(destroyKbEditors);

const fullCount = (text: string) => countedWordStarts(text).length;

describe("noteWordCount", () => {
  it("counts words the way the rest of the app does, including Chinese and Japanese", () => {
    expect(noteTextWords("")).toBe(0);
    expect(noteTextWords("  one\ttwo\n\nthree  ")).toBe(3);
    expect(noteTextWords("我们测试")).toBe(4);
    expect(noteTextWords("これはテスト")).toBe(6);
    expect(noteTextWords("don't stop - now")).toBe(3);
  });

  it("matches a full text count as the note changes", () => {
    const editor = kbEditor(
      "# Heading words\n\nFirst para with **bold** text.\n\n- one\n- two  three\n\n> quoted words here\n\n| a | b |\n| - | - |\n| c d | e |\n\n```\ncode words\n```",
    );
    expect(noteWordCount(editor)).toBe(fullCount(editor.getText()));
    expect(noteWordCount(editor)).toBe(noteWordCount(editor));
    for (let index = 0; index < 20; index += 1) {
      const at = Math.max(1, Math.floor((editor.state.doc.content.size * (index + 1)) / 22));
      const tr = index % 3 === 0 ? editor.state.tr.insertText(" new words ", at) : editor.state.tr.insertText("x", at);
      editor.view.dispatch(index % 5 === 4 ? editor.state.tr.delete(at, Math.min(at + 4, editor.state.doc.content.size)) : tr);
      expect(noteWordCount(editor)).toBe(fullCount(editor.getText()));
    }
    editor.commands.setHardBreak();
    expect(noteWordCount(editor)).toBe(fullCount(editor.getText()));
  });
});
