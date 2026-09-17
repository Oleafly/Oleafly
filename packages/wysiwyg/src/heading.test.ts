// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { parseLatexBody } from "./latex/parse";
import { serializeLatexBody } from "./latex/serialize";
import { parseMarkdownBody } from "./markdown/parse";
import { serializeMarkdownBody } from "./markdown/serialize";
import { WYSIWYG_EXTENSIONS } from "./schema";

let editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

describe("LatexHeadingAttributes", () => {
  it("renders the sectioning attrs as data attributes and parses them back", () => {
    const doc = parseLatexBody("\\chapter*[Short]{Long}\n");
    const editor = new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS, content: doc });
    editors.push(editor);
    const html = editor.getHTML();
    expect(html).toContain('<h1 data-command="chapter" data-starred="true" data-short-title="Short">Long</h1>');
    const reparsed = new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS, content: html });
    editors.push(reparsed);
    expect(reparsed.getJSON().content?.[0].attrs).toEqual({ level: 1, command: "chapter", starred: true, shortTitle: "Short" });
  });

  it("leaves markdown headings untouched", () => {
    const { doc } = parseMarkdownBody("# Title\n\n#### Deep\n");
    expect(doc.content?.[0].attrs).toEqual({ level: 1, command: null, starred: false, shortTitle: null });
    expect(doc.content?.[1].attrs?.level).toBe(4);
    expect(serializeMarkdownBody(doc)).toBe("# Title\n\n#### Deep");
  });

  it("serializes from the level when the toolbar changes it under a stale command", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: WYSIWYG_EXTENSIONS,
      content: parseLatexBody("\\chapter{C}\n"),
    });
    editors.push(editor);
    editor.commands.setTextSelection(1);
    editor.commands.toggleHeading({ level: 2 });
    const json = editor.getJSON() as JSONContent;
    expect(json.content?.[0].attrs).toEqual({ level: 2, command: "chapter", starred: false, shortTitle: null });
    expect(serializeLatexBody(json)).toBe("\\subsection{C}\n");
  });
});
