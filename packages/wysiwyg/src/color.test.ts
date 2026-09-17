// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { WYSIWYG_EXTENSIONS } from "./schema";

let editors: Editor[] = [];

function mount(content: JSONContent | string): Editor {
  const editor = new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS, content });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

describe("colour marks", () => {
  it("renders known specifications with an inline style and unknown ones unstyled", () => {
    const editor = mount({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a", marks: [{ type: "textColor", attrs: { color: "red!30" } }] },
            { type: "text", text: "b", marks: [{ type: "colorBox", attrs: { color: "[HTML]{00FF00}" } }] },
            { type: "text", text: "c", marks: [{ type: "textColor", attrs: { color: "mystery" } }] },
          ],
        },
      ],
    });
    const html = editor.getHTML();
    const spans = editor.view.dom.querySelectorAll<HTMLElement>("span");
    expect(spans[0].dataset.textColor).toBe("red!30");
    expect(spans[0].style.color).toBe("rgb(255, 179, 179)");
    expect(spans[1].dataset.colorBox).toBe("[HTML]{00FF00}");
    expect(spans[1].style.backgroundColor).toBe("rgb(0, 255, 0)");
    expect(html).toContain('<span data-text-color="mystery">c</span>');
    const reparsed = mount(html);
    expect(reparsed.getJSON()).toEqual(editor.getJSON());
  });
});
