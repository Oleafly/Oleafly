// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerNoteEditor } from "@/lib/open-note-editors";
import { noteEditorHandle } from "@/lib/tests/open-note-editor-fixtures";
import { blockPosition } from "@/components/editor/wysiwyg/reveal";
import { noteBaseExtensions, noteMarkdownExtensions, parseNoteMarkdown } from "./note-markdown";
import { revealNoteLocation } from "./note-reveal";

const SOURCE = "---\ntitle: Plan\nkind: note\n---\n\n# Plan\n\nFirst paragraph.\n\n- one\n- two\n\nLast paragraph.\n";
const KEY = "project-note:paper:notes/Plan.md";

const stops: (() => void)[] = [];
let editor: Editor | null = null;

function open(source = SOURCE): Editor {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: noteBaseExtensions(),
    content: parseNoteMarkdown(source).doc,
  });
  stops.push(registerNoteEditor(KEY, noteEditorHandle({ editor, text: () => source })));
  return editor;
}

function selectedText(view: Editor): string {
  return view.state.selection.$from.parent.textContent;
}

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  editor?.destroy();
  editor = null;
});

describe("revealing a location in a note", () => {
  it("finds the block that holds a source line, past the front matter", () => {
    const view = open();
    expect(blockPosition(view.state.doc, SOURCE, { path: "notes/Plan.md", line: 8 }, noteMarkdownExtensions())).toBe(view.state.doc.child(0).nodeSize);
    expect(blockPosition(view.state.doc, SOURCE, { path: "notes/Plan.md", line: 1 }, noteMarkdownExtensions())).toBe(0);
    expect(blockPosition(view.state.doc, "# Only\n", { path: "notes/Plan.md", line: 1 }, noteMarkdownExtensions())).toBeNull();
  });

  it("selects and scrolls to the block once the editor opens", async () => {
    const abort = new AbortController();
    const scroll = vi.fn();
    const shown = revealNoteLocation(KEY, SOURCE, { path: "notes/Plan.md", line: 13 }, abort.signal, {
      select: true,
      focus: false,
    });
    const view = open();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    try {
      await expect(shown).resolves.toBe(true);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
    expect(selectedText(view)).toBe("Last paragraph.");
    expect(scroll).toHaveBeenCalledWith({ block: "center" });
  });

  it("finds a character offset and leaves the selection alone when asked", async () => {
    const view = open();
    const offset = SOURCE.indexOf("First");
    await expect(
      revealNoteLocation(KEY, SOURCE, { path: "notes/Plan.md", range: { from: offset, to: offset } }, new AbortController().signal, {
        select: false,
        focus: false,
      }),
    ).resolves.toBe(true);
    expect(view.state.selection.from).toBe(1);
  });

  it("still counts the note as shown when its blocks do not line up with the file", async () => {
    const view = open("# Plan\n");
    await expect(
      revealNoteLocation(KEY, SOURCE, { path: "notes/Plan.md", line: 13 }, new AbortController().signal, {
        select: true,
        focus: false,
      }),
    ).resolves.toBe(true);
    expect(view.state.selection.from).toBe(1);
  });

  it("stops when the jump is cancelled before the editor opens", async () => {
    const abort = new AbortController();
    const shown = revealNoteLocation(KEY, SOURCE, { path: "notes/Plan.md", line: 2 }, abort.signal, { select: true, focus: true });
    abort.abort();
    await expect(shown).resolves.toBe(false);
  });
});
