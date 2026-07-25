// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { WYSIWYG_EXTENSIONS } from "./schema";

describe("WYSIWYG history", () => {
  let editor: Editor | undefined;

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
  });

  it("supports undo and redo through the production extension set", () => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: WYSIWYG_EXTENSIONS,
      content: "<p>Before</p>",
    });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(" after");

    expect(editor.getText()).toBe("Before after");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe("Before");
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getText()).toBe("Before after");
  });
});
