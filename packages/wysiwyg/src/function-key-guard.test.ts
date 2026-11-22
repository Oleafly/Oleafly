// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { functionKeyTextOffsets, hasFunctionKeyText, onlyFunctionKeyText, withoutFunctionKeyText } from "./function-key-text";
import { WYSIWYG_EXTENSIONS } from "./schema";
import { typeText } from "./test-helpers";

const END = "";
const PAGE_DOWN = "";
const F35 = "";
const APPLE_LOGO = "";

describe("function key text", () => {
  it("knows the AppKit function key range and nothing past it", () => {
    expect(hasFunctionKeyText(`words.${END}`)).toBe(true);
    expect(hasFunctionKeyText("")).toBe(true);
    expect(hasFunctionKeyText("")).toBe(true);
    expect(hasFunctionKeyText("")).toBe(false);
    expect(hasFunctionKeyText(APPLE_LOGO)).toBe(false);
    expect(onlyFunctionKeyText(`${END}${PAGE_DOWN}`)).toBe(true);
    expect(onlyFunctionKeyText(`a${END}`)).toBe(false);
    expect(functionKeyTextOffsets(`a${END}b${F35}`)).toEqual([1, 3]);
    expect(withoutFunctionKeyText(`Say hello in five words.${END}${APPLE_LOGO}`)).toBe(`Say hello in five words.${APPLE_LOGO}`);
  });

  it("knows the Carbon codes the arrow keys carry, and no other control character", () => {
    expect(onlyFunctionKeyText("\u001D\u001D")).toBe(true);
    expect(hasFunctionKeyText("\u001C")).toBe(true);
    expect(hasFunctionKeyText("\u001F")).toBe(true);
    expect(hasFunctionKeyText("\u001B")).toBe(false);
    expect(hasFunctionKeyText("\u0020")).toBe(false);
    expect(hasFunctionKeyText("\t\n")).toBe(false);
    expect(withoutFunctionKeyText("note\u001D\u001C")).toBe("note");
  });
});

describe("FunctionKeyTextGuard", () => {
  let editor: Editor | undefined;

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
  });

  function open(html: string): Editor {
    editor = new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS, content: html });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    return editor;
  }

  it("refuses a typed function key character without touching the note or its history", () => {
    const opened = open("<p>Note</p>");
    const before = opened.state.doc;
    typeText(opened, END);
    expect(opened.state.doc.eq(before)).toBe(true);
    expect(opened.can().undo()).toBe(false);
  });

  it("types the rest of a mixed insertion", () => {
    const opened = open("<p>Note</p>");
    typeText(opened, `!${PAGE_DOWN}?`);
    expect(opened.getText()).toBe("Note!?");
  });

  it("takes function key characters out of text that arrives any other way, as one undo step", () => {
    const opened = open("<p>Note</p>");
    opened.commands.insertContent(`<p>Pasted ${END}line${F35}</p><p>and ${APPLE_LOGO} stays</p>`);
    expect(opened.getText({ blockSeparator: "|" })).toBe(`NotePasted line|and ${APPLE_LOGO} stays`);
    opened.commands.undo();
    expect(opened.getText()).toBe("Note");
  });

  it("leaves the text alone when nothing inserted carries one", () => {
    const opened = open(`<p>Old ${END} text</p>`);
    opened.commands.insertContent("new");
    expect(opened.getText()).toBe(`Old ${END} textnew`);
  });
});
