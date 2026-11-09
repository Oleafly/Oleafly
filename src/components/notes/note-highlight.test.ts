// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { destroyKbEditors, kbEditor, kbMarkdown, placeCursor, pressKey, typeInto } from "./kb-test-editor";
import { highlightEnd } from "./note-highlight";

afterEach(destroyKbEditors);

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
