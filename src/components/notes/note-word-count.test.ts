// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { destroyKbEditors, kbEditor } from "./tests/kb-editor-fixtures";
import { countedWordStarts } from "@oleafly/editor/prose";
import { noteStats, noteTextStats, noteTextWords, noteWordCount, readingMinutes } from "./note-word-count";

const counted = vi.hoisted(() => ({ text: [] as string[] }));

vi.mock("@oleafly/editor/prose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oleafly/editor/prose")>();
  return {
    ...actual,
    countedWordStarts: (text: string) => {
      counted.text.push(text);
      return actual.countedWordStarts(text);
    },
  };
});

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
      expect(noteStats(editor)).toEqual(noteTextStats(editor.getText()));
    }
    editor.commands.setHardBreak();
    expect(noteWordCount(editor)).toBe(fullCount(editor.getText()));
    expect(noteStats(editor)).toEqual(noteTextStats(editor.getText()));
  });
});

describe("noteStats", () => {
  it("counts characters without line breaks and the lines that have text", () => {
    expect(noteTextStats("")).toEqual({ words: 0, characters: 0, lines: 0 });
    expect(noteTextStats("one two\n\n  \nthree")).toEqual({ words: 3, characters: 12, lines: 2 });
    expect(noteTextStats("我们 🧪")).toEqual({ words: 2, characters: 4, lines: 1 });
  });

  it("adds up the blocks of a note and keeps the answer for each version", () => {
    const editor = kbEditor("# Plan\n\nFirst line  \nsecond line\n\n- one\n- two\n\n```\na\nb\n```");
    const first = noteStats(editor);
    expect(first).toEqual({ words: 9, characters: 33, lines: 7 });
    expect(noteStats(editor)).toBe(first);
    editor.commands.insertContentAt(1, "New ");
    expect(noteStats(editor)).toEqual({ words: 10, characters: 37, lines: 7 });
    expect(noteWordCount(editor)).toBe(10);
  });

  it("counts again only the list item or table cell that changed", () => {
    const items = Array.from({ length: 40 }, (_, index) => `- item ${index} words`).join("\n");
    const editor = kbEditor(`${items}\n\n| a | b |\n| - | - |\n| c d | e |`);
    noteStats(editor);
    editor.view.dispatch(editor.state.tr.insertText("more ", 3));
    counted.text = [];
    const listEdit = noteStats(editor);
    expect(counted.text).toEqual(["more item 0 words"]);
    expect(listEdit).toEqual(noteTextStats(editor.getText()));
    let cell = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "c d") cell = pos;
    });
    editor.view.dispatch(editor.state.tr.insertText("x ", cell));
    counted.text = [];
    const cellEdit = noteStats(editor);
    expect(counted.text).toEqual(["x c d"]);
    expect(cellEdit).toEqual(noteTextStats(editor.getText()));
  });

  it("turns words into minutes at the reading pace", () => {
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(114)).toBe(0);
    expect(readingMinutes(115)).toBe(1);
    expect(readingMinutes(230)).toBe(1);
    expect(readingMinutes(1150)).toBe(5);
  });
});
