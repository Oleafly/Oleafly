// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import type { NotesHighlightColor } from "@/lib/notes-appearance";
import { destroyKbEditors, kbEditor, kbMarkdown, kbNote, placeCursor, positionOf, pressKey, selectText, typeInto } from "./tests/kb-editor-fixtures";
import { highlightColor, highlightEnd } from "./note-highlight";

const initialPrefs = useNotesPrefsStore.getState();

afterEach(() => {
  destroyKbEditors();
  useNotesPrefsStore.setState(initialPrefs, true);
});

function highlightedLetters(editor: ReturnType<typeof kbEditor>): string[] {
  const letters: string[] = [];
  editor.state.doc.descendants((node) => {
    const mark = node.isText ? node.marks.find((candidate) => candidate.type.name === "highlight") : undefined;
    for (const letter of (node.text ?? "").replace(/\s/gu, "")) letters.push(`${letter}:${mark ? (mark.attrs.color ?? "yellow") : "none"}`);
  });
  return letters;
}

function colors(editor: ReturnType<typeof kbEditor>): string[] {
  const found: string[] = [];
  editor.state.doc.descendants((node) => {
    const mark = node.isText ? node.marks.find((candidate) => candidate.type.name === "highlight") : undefined;
    if (mark) found.push(`${node.text}:${mark.attrs.color ?? "yellow"}`);
  });
  return found;
}

describe("highlight syntax", () => {
  it.each([
    ["==a==", 0, 3],
    ["== a==", 0, -1],
    ["==a ==", 0, -1],
    ["===a==", 0, -1],
    ["==a===", 0, -1],
    ["==a `==` b==", 0, 10],
    ["==a `` ` `` b==", 0, 13],
    ["==a \\== b==", 0, 9],
    ["==a `x", 0, -1],
    ["x", 0, -1],
    ["==", 0, -1],
    ["==ab", 0, -1],
  ])("finds the end of %j", (text, start, end) => {
    expect(highlightEnd(text, start, text.length)).toBe(end);
  });

  it("parses nested marks inside a highlight and leaves comparisons as text", () => {
    const editor = kbEditor("a ==b **c**== d and x == y");
    const marked: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === "highlight")) marked.push(`${node.text}:${node.marks.length}`);
    });
    expect(marked).toEqual(["b :1", "c:2"]);
    expect(kbMarkdown(editor)).toBe("a ==b **c**== d and x == y");
  });

  it("highlights typed ==text== and toggles with Mod+Shift+H", () => {
    const editor = kbEditor("start");
    placeCursor(editor, "start", 5);
    typeInto(editor, " ==hot==");
    expect(kbMarkdown(editor)).toBe("start ==hot==");
    const plain = kbEditor("word");
    plain.commands.selectAll();
    expect(pressKey(plain, "h", { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(kbMarkdown(plain)).toBe("==word==");
    expect(plain.commands.toggleHighlight()).toBe(true);
    expect(kbMarkdown(plain)).toBe("word");
  });

  it("highlights pasted ==text==", () => {
    const editor = kbEditor("x");
    editor.commands.insertContent("see ==this== now");
    expect(kbMarkdown(editor)).toContain("==this==");
  });
});

describe("highlight colours", () => {
  it("accepts only the palette and treats yellow as the plain highlight", () => {
    expect(highlightColor("green")).toBe("green");
    expect(highlightColor("yellow")).toBeNull();
    expect(highlightColor("teal")).toBeNull();
    expect(highlightColor(undefined)).toBeNull();
  });

  it("reads several colours in one note and writes them back unchanged", () => {
    const source = 'a ==plain== b <mark data-color="green">go **now**</mark> c <mark data-color="red">stop</mark>';
    const editor = kbEditor(source);
    expect(colors(editor)).toEqual(["plain:yellow", "go :green", "now:green", "stop:red"]);
    expect(kbMarkdown(editor)).toBe(source);
  });

  it("keeps a mark tag with a colour outside the palette as written", () => {
    const source = 'x <mark data-color="teal">y</mark> z';
    const editor = kbEditor(source);
    expect(colors(editor)).toEqual([]);
    expect(kbMarkdown(editor)).toBe(source);
  });

  it("colours a selection, remembers the colour for Mod+Shift+H, and clears any colour", () => {
    const editor = kbEditor("one two three");
    selectText(editor, "one");
    editor.commands.toggleHighlight("blue");
    expect(kbMarkdown(editor)).toBe('<mark data-color="blue">one</mark> two three');
    expect(useNotesPrefsStore.getState().highlightColor).toBe("blue");
    selectText(editor, "two");
    expect(pressKey(editor, "h", { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(colors(editor)).toEqual(["one:blue", "two:blue"]);
    selectText(editor, "one");
    editor.commands.toggleHighlight("pink");
    expect(colors(editor)).toEqual(["one:pink", "two:blue"]);
    editor.commands.toggleHighlight("pink");
    expect(colors(editor)).toEqual(["two:blue"]);
    selectText(editor, "two");
    editor.commands.unsetHighlight();
    expect(kbMarkdown(editor)).toBe("one two three");
  });

  it("puts the plain highlight back with yellow", () => {
    const editor = kbEditor('<mark data-color="green">word</mark>');
    selectText(editor, "word");
    editor.commands.toggleHighlight("yellow");
    expect(kbMarkdown(editor)).toBe("==word==");
  });
});

describe("saving highlights next to links, spaces and other marks", () => {
  function highlightAndSave(source: string, first: string, last: string, color: NotesHighlightColor): string {
    const note = kbNote(source);
    const from = positionOf(note.editor, first);
    note.editor.commands.setTextSelection({ from, to: positionOf(note.editor, last) + last.length });
    note.editor.commands.toggleHighlight(color);
    const saved = note.save();
    const reopened = kbEditor(saved);
    expect(kbMarkdown(reopened)).toBe(saved);
    expect(highlightedLetters(reopened)).toEqual(highlightedLetters(note.editor));
    return saved;
  }

  const paper = "Intro text.\n\nSee the paper at [arXiv](https://arxiv.org/abs/1) for details.";

  it.each<[NotesHighlightColor, string, string, string, string, string]>([
    ["yellow", "around a link", paper, "the paper", "details", "Intro text.\n\nSee ==the paper at== [==arXiv==](https://arxiv.org/abs/1) ==for details==."],
    [
      "red",
      "around a link",
      paper,
      "the paper",
      "details",
      'Intro text.\n\nSee <mark data-color="red">the paper at </mark>[<mark data-color="red">arXiv</mark>](https://arxiv.org/abs/1)<mark data-color="red"> for details</mark>.',
    ],
    ["yellow", "into a link", "x a [l](https://e.com) y", "a", "l", "x ==a== [==l==](https://e.com) y"],
    ["red", "into a link", "x a [l](https://e.com) y", "a", "l", 'x <mark data-color="red">a </mark>[<mark data-color="red">l</mark>](https://e.com) y'],
    ["yellow", "out of a link", "x [l](https://e.com) a y", "l", " a", "x [==l==](https://e.com) ==a== y"],
    ["purple", "out of a link", "x [l](https://e.com) a y", "l", " a", 'x [<mark data-color="purple">l</mark>](https://e.com)<mark data-color="purple"> a</mark> y'],
    ["yellow", "between spaces", "one two three", " two ", " two ", "one ==two== three"],
    ["green", "between spaces", "one two three", " two ", " two ", 'one <mark data-color="green">two</mark> three'],
    ["yellow", "across bold", "one **two** three", "e", "thr", "on==e **two** thr==ee"],
    ["pink", "across bold", "one **two** three", "e", "thr", 'on<mark data-color="pink">e **two** thr</mark>ee'],
    ["yellow", "into bold", "one **two** three", "one", "tw", "==one **tw**==**o** three"],
    ["orange", "into bold", "one **two** three", "one", "tw", '<mark data-color="orange">one **tw**</mark>**o** three'],
    ["yellow", "out of italic", "one *two* three", "wo", "three", "one *t==wo==* ==three=="],
    ["blue", "out of italic", "one *two* three", "wo", "three", 'one *t<mark data-color="blue">wo</mark>*<mark data-color="blue"> three</mark>'],
  ])("writes a %s highlight %s and reopens it the same", (color, _where, source, first, last, saved) => {
    expect(highlightAndSave(source, first, last, color)).toBe(saved);
  });

  it("keeps every highlight of a note with links in several paragraphs", () => {
    const source = "[a](https://e.com) b\n\nc [d](https://e.com)";
    expect(highlightAndSave(source, "a", "d", "yellow")).toBe("[==a==](https://e.com) ==b==\n\n==c== [==d==](https://e.com)");
    expect(highlightAndSave(source, "a", "d", "green")).toBe(
      '[<mark data-color="green">a</mark>](https://e.com)<mark data-color="green"> b</mark>\n\n<mark data-color="green">c </mark>[<mark data-color="green">d</mark>](https://e.com)',
    );
  });
});
