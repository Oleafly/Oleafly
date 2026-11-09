// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createWysiwygExtensions } from "@oleafly/wysiwyg";
import { frontMatterChange, frontMatterSteps } from "./note-front-matter-step";

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function build(): Editor {
  const editor = new Editor({ element: document.createElement("div"), extensions: createWysiwygExtensions(), content: "<p>Body</p>" });
  editors.push(editor);
  return editor;
}

function seen(editor: Editor): string[][] {
  const changes: string[][] = [];
  editor.on("transaction", ({ transaction }) => {
    for (const step of frontMatterSteps(transaction)) changes.push([step.before, step.after]);
  });
  return changes;
}

describe("front matter changes in the note's history", () => {
  it("records a change that leaves the body alone and undoes and redoes it", () => {
    const editor = build();
    const changes = seen(editor);
    const before = editor.state.doc;
    editor.view.dispatch(frontMatterChange(editor.state.tr, "a: 1", "a: 2", true));
    expect(editor.state.doc).toBe(before);
    editor.commands.undo();
    editor.commands.redo();
    expect(changes).toEqual([
      ["a: 1", "a: 2"],
      ["a: 2", "a: 1"],
      ["a: 1", "a: 2"],
    ]);
  });

  it("keeps a change out of undo when asked", () => {
    const editor = build();
    const changes = seen(editor);
    editor.view.dispatch(frontMatterChange(editor.state.tr, "a: 1", "a: 2", false));
    expect(editor.commands.undo()).toBe(false);
    expect(changes).toEqual([["a: 1", "a: 2"]]);
  });

  it("undoes typing and a front matter change one at a time", () => {
    const editor = build();
    const changes = seen(editor);
    editor.chain().insertContentAt(1, "Draft ").run();
    editor.view.dispatch(frontMatterChange(editor.state.tr, "a: 1", "a: 2", true));
    editor.commands.undo();
    expect(editor.getText()).toBe("Draft Body");
    expect(changes.at(-1)).toEqual(["a: 2", "a: 1"]);
    editor.commands.undo();
    expect(editor.getText()).toBe("Body");
  });
});
